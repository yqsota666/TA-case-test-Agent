import {randomUUID} from 'node:crypto';
import {authenticateSession, storeError} from './index.js';

export function modelBudgetConfig(env=process.env) {
  const integer=(name,value)=>{
    const result=Number(env[name]??value);
    if(!Number.isSafeInteger(result)||result<1||result>1e9)throw new Error(`${name} 必须是正整数`);
    return result;
  };
  return {userDaily:integer('MODEL_USER_DAILY_TOKENS',500000),workspaceDaily:integer('MODEL_WORKSPACE_DAILY_TOKENS',2000000),
    globalDaily:integer('MODEL_GLOBAL_DAILY_TOKENS',10000000),userConcurrent:integer('MODEL_USER_CONCURRENT',2),
    workspaceConcurrent:integer('MODEL_WORKSPACE_CONCURRENT',4),globalConcurrent:integer('MODEL_GLOBAL_CONCURRENT',8),
    userPerMinute:integer('MODEL_USER_CALLS_PER_MINUTE',30),globalPerMinute:integer('MODEL_GLOBAL_CALLS_PER_MINUTE',120)};
}

export function normalizeModelUsage(usage) {
  const valid=n=>Number.isSafeInteger(n)&&n>=0;
  if(!usage || !valid(usage.prompt_tokens) || !valid(usage.completion_tokens))return null;
  const sum=usage.prompt_tokens+usage.completion_tokens;
  if(!Number.isSafeInteger(sum) || usage.total_tokens!==undefined && (!valid(usage.total_tokens)||usage.total_tokens<sum))return null;
  return {input:usage.prompt_tokens,output:usage.completion_tokens,total:usage.total_tokens??sum};
}

export function createModelConsumptionRepository({transaction,config=modelBudgetConfig()}) {
  const scopes=auth=>[['global',config.globalDaily],[`user:${auth.user_id}`,config.userDaily],
    [`workspace:${auth.workspace_id}`,config.workspaceDaily]].sort(([a],[b])=>a.localeCompare(b));
  return {
    reserve:(token,{model,purpose,reservedTokens})=>transaction(async db=>{
      if(!Number.isSafeInteger(reservedTokens)||reservedTokens<1||reservedTokens>1e7)throw storeError('MODEL_INPUT_TOO_LARGE',413,'模型输入过长，请缩小材料后重试');
      const auth=await authenticateSession(db,token);
      await db.execute("INSERT INTO model_budget_buckets(bucket_key,budget_day) VALUES ('mutex','2000-01-01') ON DUPLICATE KEY UPDATE booked_tokens=booked_tokens");
      await db.execute("SELECT booked_tokens FROM model_budget_buckets WHERE bucket_key='mutex' AND budget_day='2000-01-01' FOR UPDATE");
      const [[clock]]=await db.execute(`SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),'%Y-%m-%d') AS budget_day`);
      const day=String(clock.budget_day);
      const buckets=scopes(auth);
      for(const [key,limit] of buckets) {
        await db.execute(`INSERT IGNORE INTO model_budget_buckets(bucket_key,budget_day) VALUES (?,?)`,[key,day]);
        const [[bucket]]=await db.execute(`SELECT booked_tokens FROM model_budget_buckets WHERE bucket_key=? AND budget_day=? FOR UPDATE`,[key,day]);
        if(Number(bucket.booked_tokens)+reservedTokens>limit)throw storeError('MODEL_BUDGET_EXHAUSTED',429,'今日 AI 使用额度不足，请明天再试或联系管理员调整额度');
      }
      // The global bucket lock serializes claims across API processes; no lock spans the provider call.
      const [recent]=await db.execute(`SELECT workspace_id,user_id,status,expires_at>NOW(3) AS active,
        created_at>DATE_SUB(NOW(3),INTERVAL 1 MINUTE) AS recent
        FROM model_consumption WHERE created_at>DATE_SUB(NOW(3),INTERVAL 5 MINUTE) FOR UPDATE`);
      const active=recent.filter(row=>row.status==='RESERVED' && Number(row.active)===1);
      const minute=recent.filter(row=>Number(row.recent)===1);
      const activity={global_active:active.length,workspace_active:active.filter(row=>String(row.workspace_id)===String(auth.workspace_id)).length,
        user_active:active.filter(row=>String(row.user_id)===String(auth.user_id)).length,
        global_rate:minute.length,user_rate:minute.filter(row=>String(row.user_id)===String(auth.user_id)).length};
      if(Number(activity.global_active)>=config.globalConcurrent || Number(activity.workspace_active)>=config.workspaceConcurrent || Number(activity.user_active)>=config.userConcurrent)
        throw storeError('MODEL_CONCURRENCY_LIMIT',429,'AI 正在处理其他请求，请稍后重试');
      if(Number(activity.global_rate)>=config.globalPerMinute || Number(activity.user_rate)>=config.userPerMinute)
        throw storeError('MODEL_RATE_LIMIT',429,'AI 请求过于频繁，请稍后重试');
      const id=randomUUID();
      await db.execute(`INSERT INTO model_consumption(id,workspace_id,user_id,budget_day,model,purpose,reserved_tokens,expires_at)
        VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 180 SECOND))`,[id,auth.workspace_id,auth.user_id,day,model,purpose,reservedTokens]);
      for(const [key] of buckets)await db.execute(`UPDATE model_budget_buckets SET booked_tokens=booked_tokens+? WHERE bucket_key=? AND budget_day=?`,[reservedTokens,key,day]);
      return {id};
    }),
    settle:(id,usage)=>transaction(async db=>{
      // Read scope first, then lock buckets in the same order as reserve to avoid lock inversion.
      const [[scope]]=await db.execute('SELECT workspace_id,user_id,budget_day FROM model_consumption WHERE id=?',[id]);
      if(!scope)throw storeError('MODEL_RESERVATION_NOT_FOUND',500,'模型用量记录缺失');
      const buckets=scopes(scope);
      for(const [key] of buckets)await db.execute('SELECT booked_tokens FROM model_budget_buckets WHERE bucket_key=? AND budget_day=? FOR UPDATE',[key,scope.budget_day]);
      const [[row]]=await db.execute('SELECT status,reserved_tokens FROM model_consumption WHERE id=? FOR UPDATE',[id]);
      if(row.status!=='RESERVED')return {replayed:true};
      const normalized=normalizeModelUsage(usage);
      const charged=normalized?.total??Number(row.reserved_tokens);
      const difference=charged-Number(row.reserved_tokens);
      for(const [key] of buckets)await db.execute('UPDATE model_budget_buckets SET booked_tokens=booked_tokens+? WHERE bucket_key=? AND budget_day=?',[difference,key,scope.budget_day]);
      await db.execute(`UPDATE model_consumption SET status=?,charged_tokens=?,input_tokens=?,output_tokens=?,usage_json=?,settled_at=NOW(3) WHERE id=?`,
        [normalized?'SETTLED':'UNCERTAIN',charged,normalized?.input??null,normalized?.output??null,normalized?JSON.stringify(usage):null,id]);
      return {chargedTokens:charged,status:normalized?'SETTLED':'UNCERTAIN'};
    }),
  };
}
