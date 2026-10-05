import express from 'express';
import { normalizeEmail,hashPassword,verifyPassword,parseCookies,newSession,sessionTokenHash,SESSION_TTL_MS } from '../auth.js';
import { authenticateSession,mapDatabaseError } from './scope.js';
import { createWorkflowService,metadata,fail } from './workflow-service.js';
import { createCatalogService } from './catalog-service.js';
import {createGlobalCaseService} from '../global-case/service.js';
import {createPlatformUser,createDemoLogin,DEMO_EMAIL} from './demo-account.js';
import {mountAgentRoutes} from '../agent/http.js';

const COOKIE='fund_platform_session';
const cookie=(token,maxAge=Math.floor(SESSION_TTL_MS/1000))=>`${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.PLATFORM_SECURE_COOKIE==='1'?'; Secure':''}`;
const publicUser=u=>({id:u.public_id,name:u.display_name,email:u.email,createdAt:u.created_at});
const token=req=>parseCookies(req.headers.cookie)[COOKIE];
export function createPlatformApp({transaction,archiveRoot,agent}){
  const app=express(),service=createWorkflowService({transaction,archiveRoot,onReturns:agent?.onReturns,onDelivery:agent?.onDelivery}),catalog=createCatalogService({transaction}),globalCases=createGlobalCaseService({transaction,archiveRoot,onReturns:agent?.onReturns,onRetry:agent?.onRetry});
  app.disable('x-powered-by');
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'禁止跨站请求',code:'CROSS_ORIGIN'});
      const origin=req.headers.origin;
      if(origin){try{if(new URL(origin).host!==req.headers.host)return res.status(403).json({error:'请求来源与当前平台不符',code:'CROSS_ORIGIN'});}catch{return res.status(403).json({error:'请求来源无效'});}}
      if(!(req.method==='DELETE'&&!req.headers['content-length']&&!req.headers['transfer-encoding'])
        &&!req.is('application/json'))return res.status(415).json({error:'请使用 JSON 请求'});
    }next();
  });
  app.use(express.json({limit:'24mb'}));
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const auth=async req=>transaction(db=>authenticateSession(db,token(req)));
  const throttle=new Map();
  const limit=req=>{
    const now=Date.now(),key=req.socket.remoteAddress;
    for(const [k,v] of throttle)if(v.until<now)throttle.delete(k);
    const v=throttle.get(key)??{n:0,until:now+60_000};v.n++;throttle.set(key,v);
    if(v.n>20)fail('登录尝试过于频繁，请一分钟后重试','AUTH_RATE_LIMIT',429);
  };
  app.get('/api/health',wrap(async(req,res)=>{await transaction(db=>db.execute('SELECT 1'));res.json({ok:true,database:'sales_platform_v2',transport:'MANUAL'});}));
  app.post('/api/auth/register',wrap(async(req,res)=>{
    limit(req);const {name,password}=req.body,email=normalizeEmail(req.body.email);
    if(typeof name!=='string'||!name.trim()||name.length>80||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190)fail('请填写姓名和有效邮箱');
    if(email===DEMO_EMAIL)fail('此邮箱用于模拟账号','RESERVED_EMAIL',409);
    const passwordHash=await hashPassword(password);
    const result=await transaction(async db=>{
      const [[prior]]=await db.execute('SELECT id FROM platform_users WHERE email=?',[email]);if(prior)fail('这个邮箱已经注册','EMAIL_EXISTS',409);
      const u=await createPlatformUser(db,{name:name.trim(),email,passwordHash}),s=newSession();
      await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',[s.tokenHash,u.userId,s.expiresAt]);
      const [[profile]]=await db.execute('SELECT created_at FROM platform_users WHERE id=?',[u.userId]);
      return {user:{id:u.publicId,name:name.trim(),email,createdAt:profile.created_at},token:s.token};
    });res.set('Set-Cookie',cookie(result.token));res.status(201).json({user:result.user});
  }));
  const demoLogin=createDemoLogin({transaction});
  app.post('/api/auth/demo',wrap(async(req,res)=>{limit(req);const r=await demoLogin();res.set('Set-Cookie',cookie(r.token));res.json({user:r.user});}));
  app.post('/api/auth/login',wrap(async(req,res)=>{
    limit(req);const email=normalizeEmail(req.body.email);
    const [u]=await transaction(async db=>{const [rows]=await db.execute('SELECT * FROM platform_users WHERE email=? AND status=\'ACTIVE\'',[email]);return rows;});
    if(!u||!await verifyPassword(req.body.password,u.password_hash))fail('邮箱或密码不正确','INVALID_LOGIN',401);
    const s=newSession();await transaction(db=>db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',[s.tokenHash,u.id,s.expiresAt]));
    res.set('Set-Cookie',cookie(s.token));res.json({user:publicUser(u)});
  }));
  app.get('/api/auth/me',wrap(async(req,res)=>{
    const a=await auth(req);const [[u]]=await transaction(db=>db.execute('SELECT public_id,display_name,email,created_at FROM platform_users WHERE id=?',[a.user_id]));res.json({user:publicUser(u)});
  }));
  app.post('/api/auth/logout',wrap(async(req,res)=>{
    await transaction(db=>db.execute('DELETE FROM platform_sessions WHERE token_hash=?',[sessionTokenHash(token(req)??'')]));res.set('Set-Cookie',cookie('',0));res.json({ok:true});
  }));
  app.get('/api/metadata',wrap(async(req,res)=>{await auth(req);res.json(metadata);}));
  app.get('/api/v2/chats',wrap(async(req,res)=>res.json(await globalCases.listChats(token(req)))));
  app.post('/api/v2/chats',wrap(async(req,res)=>res.status(201).json(await globalCases.createChat(token(req),req.body))));
  app.post('/api/v2/chats/:chatId/end',wrap(async(req,res)=>res.json(await globalCases.endChat(token(req),req.params.chatId,req.body))));
  app.get('/api/v2/chats/:chatId/cases',wrap(async(req,res)=>res.json(await globalCases.listCases(token(req),req.params.chatId))));
  app.post('/api/v2/chats/:chatId/cases',wrap(async(req,res)=>res.status(201).json(await globalCases.createCase(token(req),req.params.chatId,req.body))));
  app.get('/api/v2/chats/:chatId/progress',wrap(async(req,res)=>res.json(await globalCases.progress(token(req),req.params.chatId))));
  app.get('/api/v2/cases/:caseId',wrap(async(req,res)=>res.json(await globalCases.caseState(token(req),req.params.caseId))));
  app.post('/api/v2/cases/:caseId/sop',wrap(async(req,res)=>res.status(201).json(await globalCases.proposeSop(token(req),req.params.caseId,req.body))));
  app.post('/api/v2/cases/:caseId/sop/:version/approve',wrap(async(req,res)=>res.json(await globalCases.approveSop(token(req),req.params.caseId,req.params.version))));
  app.post('/api/v2/cases/:caseId/verdict',wrap(async(req,res)=>
    res.status(201).json(await globalCases.confirmCaseVerdict(token(req),req.params.caseId,req.body))));
  app.post('/api/v2/cases/:caseId/retry',wrap(async(req,res)=>
    res.status(201).json(await globalCases.requestRetry(token(req),req.params.caseId,req.body))));
  app.get('/api/v2/chats/:chatId/data',wrap(async(req,res)=>res.json(await globalCases.data(token(req),req.params.chatId))));
  app.get('/api/v2/chats/:chatId/data/:kind',wrap(async(req,res)=>res.json(await globalCases.listData(token(req),req.params.chatId,req.params.kind,req.query))));
  for(const kind of ['customers','accounts','funds','targets'])
    app.post(`/api/v2/chats/:chatId/data/${kind}`,wrap(async(req,res)=>res.status(201).json(await globalCases.createData(token(req),req.params.chatId,kind,req.body))));
  for(const kind of ['customers','accounts','funds','targets']){
    app.patch(`/api/v2/chats/:chatId/data/${kind}/:recordId`,wrap(async(req,res)=>res.json(await globalCases.updateData(token(req),req.params.chatId,kind,req.params.recordId,req.body))));
    app.delete(`/api/v2/chats/:chatId/data/${kind}/:recordId`,wrap(async(req,res)=>res.json(await globalCases.deleteData(token(req),req.params.chatId,kind,req.params.recordId))));
  }
  app.post('/api/v2/chats/:chatId/batches/generate',wrap(async(req,res)=>res.status(201).json(await globalCases.generateRound(token(req),req.params.chatId))));
  app.get('/api/v2/chats/:chatId/batches',wrap(async(req,res)=>res.json(await globalCases.listBatches(token(req),req.params.chatId))));
  app.post('/api/v2/returns',wrap(async(req,res)=>res.status(201).json(await globalCases.uploadReturns(token(req),req.body))));
  app.get('/api/v2/batches/:batchId/packages/:packageId/download',wrap(async(req,res)=>{
    const f=await globalCases.download(token(req),req.params.batchId,req.params.packageId);
    res.set('Content-Type','application/zip');res.set('Content-Disposition',`attachment; filename="${f.name}"`);res.send(f.bytes);
  }));
  app.get('/api/v2/batches/:batchId/packages/:packageId',wrap(async(req,res)=>
    res.json(await globalCases.inspectPackage(token(req),req.params.batchId,req.params.packageId))));
  app.post('/api/v2/batches/:batchId/packages/:packageId/deliver',wrap(async(req,res)=>
    res.json(await globalCases.confirmDelivery(token(req),req.params.batchId,req.params.packageId,req.body))));
  app.get('/api/chats',wrap(async(req,res)=>res.json(await service.list(token(req)))));
  app.post('/api/chats',wrap(async(req,res)=>res.status(201).json(await catalog.startChat(token(req),req.body))));
  app.get('/api/catalog/state',wrap(async(req,res)=>res.json(await catalog.state(token(req),req.query))));
  app.post('/api/catalog/customers',wrap(async(req,res)=>res.status(201).json(await catalog.addCustomers(token(req),req.body))));
  app.post('/api/catalog/customers/:customerId',wrap(async(req,res)=>res.json(await catalog.updateCustomer(token(req),req.params.customerId,req.body))));
  app.post('/api/catalog/funds',wrap(async(req,res)=>res.status(201).json(await catalog.addFund(token(req),req.body))));
  app.post('/api/catalog/positions',wrap(async(req,res)=>res.status(201).json(await catalog.addPosition(token(req),req.body))));
  app.post('/api/returns',wrap(async(req,res)=>res.status(201).json(await service.upload(token(req),null,req.body))));
  const base='/api/chats/:chatPublicId/runs/:runPublicId';
  if(agent)mountAgentRoutes(app,{agent,token,wrap,base});
  app.get(`${base}/state`,wrap(async(req,res)=>res.json(await service.state(token(req),req.params,req.query))));
  app.post(`${base}/catalog/import`,wrap(async(req,res)=>res.status(201).json(await catalog.importCustomers(token(req),req.params,req.body))));
  app.post(`${base}/steps`,wrap(async(req,res)=>res.status(201).json(await service.addStep(token(req),req.params,req.body))));
  app.post(`${base}/steps/:stepId/check`,wrap(async(req,res)=>res.json(await service.checkStep(token(req),req.params,req.params.stepId,req.body))));
  for(const [path,method] of [['customers','addCustomers'],['funds','addFund'],['targets','addTarget'],['messages','message'],['applications','createApplication'],['generate','generate'],['returns','upload']])
    app.post(`${base}/${path}`,wrap(async(req,res)=>res.status(201).json(await service[method](token(req),req.params,req.body))));
  app.post(`${base}/packages/:packageId/deliver`,wrap(async(req,res)=>res.json(await service.deliver(token(req),req.params,req.params.packageId,req.body))));
  app.get(`${base}/packages/:packageId`,wrap(async(req,res)=>res.json(await service.inspect(token(req),req.params,req.params.packageId))));
  app.get(`${base}/packages/:packageId/download`,wrap(async(req,res)=>{
    const f=await service.download(token(req),req.params,req.params.packageId);res.set('Content-Type','application/zip');res.set('Content-Disposition',`attachment; filename="${f.name}"`);res.send(f.bytes);
  }));
  app.use((err,req,res,next)=>{
    const e=mapDatabaseError(err);const status=e.status??(e.type==='entity.too.large'?413:500);
    if(status>=500)console.error('platform request failed',{code:e.code||'INTERNAL_ERROR'});
    res.status(status).json({error:status>=500?'处理失败，数据未提交，请重试':e.message,code:e.code||'REQUEST_ERROR'});
  });return app;
}
