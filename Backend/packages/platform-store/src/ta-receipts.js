import { authenticateSession, storeError } from './index.js';
import { createReturnParsingRepository } from './return-parsing.js';
import { createHoldingsReturnRepository } from './holdings-return.js';
import { parseReturnFiles } from '../../platform-protocol/src/return-parsing.js';

const types = ['02','04','05'];
const reject = (code, message, status=409) => { throw storeError(code,status,message); };
function validateRoutes(routes) {
  if (!Array.isArray(routes) || routes.length>3 || new Set(routes.map(r=>r?.fileType)).size!==routes.length ||
    routes.some(r=>!r || Array.isArray(r) || typeof r!=='object' || !types.includes(r.fileType) ||
      Object.keys(r).some(k=>!['fileType','batchPublicId','exchangeStepId'].includes(k)) ||
      (r.fileType==='05' && Object.hasOwn(r,'batchPublicId')) ||
      (Object.hasOwn(r,'exchangeStepId') && (typeof r.exchangeStepId!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.exchangeStepId))))) {
    reject('INVALID_INPUT','回传路由无效；每种文件只能指定一个目标批次与Plan步骤',400);
  }
}

// All typed repositories share this transaction; no subset OFI or changed source is generated.
export function createTaReceiptsRepository({transaction}) {
  async function read(token,scope) {
    return transaction(async db=>{
      const inTransaction=action=>action(db);
      const returns=await createReturnParsingRepository({transaction:inTransaction}).read(token,scope);
      const holdings=await createHoldingsReturnRepository({transaction:inTransaction}).read(token,scope);
      return {returns,holdings,supportedTypes:types,formats:['TXT','OFI'],businessApplied:false};
    });
  }
  async function parse(token,input) {
    validateRoutes(input.routes ?? []);
    return transaction(async db=>{
      const auth=await authenticateSession(db,token);
      if(!/^[1-9]\d{0,18}$/.test(String(input.channelId??''))) reject('INVALID_INPUT','通道标识无效',400);
      const [[row]]=await db.execute(`SELECT id,ta_code,distributor_code,protocol_version FROM exchange_channels
        WHERE workspace_id=? AND id=?`,[auth.workspace_id,input.channelId]);
      if(!row)reject('CHANNEL_NOT_FOUND','通道不存在',404);
      const channel={taCode:row.ta_code,distributorCode:row.distributor_code,protocolVersion:row.protocol_version};
      const inTransaction=action=>action(db);
      const returns=createReturnParsingRepository({transaction:inTransaction});
      const holdings=createHoldingsReturnRepository({transaction:inTransaction});
      // Authenticate the Case before processing the potentially expensive upload.
      const available=await returns.read(token,input);
      if(Array.isArray(input.files) && input.files.some(file=>/\.zip$/i.test(file?.fileName??'')))reject('UNSUPPORTED_RECEIPT_FORMAT','请上传解压后的TA原始TXT与完整OFI；此入口不支持ZIP',400);
      const complete=parseReturnFiles(input.files,{expectedType:'MIXED',channel,allowMixed:true});
      const present=types.filter(type=>complete.result.files.some(file=>file.fileType===type));
      if((input.routes??[]).some(route=>!present.includes(route.fileType)))reject('RECEIPT_ROUTE_UNUSED','指定的路由类型没有出现在上传文件中',400);
      const selected=present.map(fileType=>{
        const route=(input.routes??[]).find(r=>r.fileType===fileType)??{fileType};
        if(fileType==='05')return route;
        const candidates=available.steps.filter(s=>s.expectedType===fileType && s.channelId===String(row.id) &&
          (!route.batchPublicId || s.batchPublicId===route.batchPublicId));
        if(candidates.length!==1)reject('RECEIPT_ROUTE_REQUIRED',`无法唯一确定${fileType}对应的申请批次，请明确选择batchPublicId`);
        return {...route,batchPublicId:candidates[0].batchPublicId};
      });
      const results=[];
      for(const route of selected) {
        const args={...input,...route,expectedType:route.fileType};
        const result=route.fileType==='05'
          ? await holdings.parse(token,args,target=>({phase:'PARSED',parsed:parseReturnFiles(input.files,{expectedType:route.fileType,channel:target,allowMixed:true})}))
          : await returns.parse(token,args,target=>({phase:'PARSED',parsed:parseReturnFiles(input.files,{expectedType:route.fileType,channel:target.channel,allowMixed:true})}));
        if(result.orderError)reject(result.orderError.error,result.orderError.message);
        results.push({fileType:route.fileType,...result});
      }
      return {phase:'PARSED',sha256:complete.result.sha256,indexChecked:complete.result.indexChecked,
        packageFiles:complete.result.packageFiles,results,businessApplied:false};
    });
  }
  return Object.freeze({read,parse});
}
