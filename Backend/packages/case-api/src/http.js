import { createServer } from 'node:http';
import { DataEditSchema } from '../../case-agent/src/index.js';
import { parseDataFile } from '../../platform-protocol/src/index.js';

const taResetPath=/^\/api\/exchange\/channels\/([1-9]\d*)\/ta-reset(?:\/(confirm))?$/i;
const chatCollectionPath=/^\/api\/chats(?:\/([0-9a-f-]{36})\/cases)?$/i;
const lifecyclePath=/^\/api\/chats\/([0-9a-f-]{36})\/lifecycle(?:\/(close|retest|new-run))?$/i;
const pathPattern = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/(discussion|plan|plan\/confirm|data|data\/execute|data\/review|data\/confirm|application-preparation)$/i;
const applicationPath = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/applications$/i;
const bindingPath = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/ta-bindings$/i;
const batchPath = /^\/api\/chats\/([0-9a-f-]{36})\/batches(?:\/([0-9a-f-]{36})\/generate)?$/i;
const filesPath = /^\/api\/chats\/([0-9a-f-]{36})\/files(?:\/([1-9]\d*))?$/i;
const supplementPath = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/exchange-plan\/confirm$/i;
const confirmationPath = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/return-confirmation(?:\/(delivery|apply|account))?$/i;
const resultPath = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/result-review(?:\/(evaluate|confirm))?$/i;
const holdingsPath = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/holdings-return(?:\/(parse|apply))?$/i;
const parsingPath = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/return-parsing(?:\/(02|04))?$/i;

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function cookieToken(header) {
  const cookie = String(header ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith('case_session='));
  if (!cookie) return null;
  try { return decodeURIComponent(cookie.slice('case_session='.length)); }
  catch { return null; }
}

async function jsonBody(request, limit = 256 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) {
      const error = new Error('请求内容过长');
      error.code = 'REQUEST_TOO_LARGE'; error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('请求须为 JSON');
    error.code = 'INVALID_JSON'; error.status = 400;
    throw error;
  }
}

export function createCaseHttpHandler({ repository, discussionService, confirmPlan, executeData,
  reviseData, exchangeRepository, applicationPreparation, confirmData, returnParsing, returnConfirmation, holdingsReturn, caseResult, exchangePlanSupplement, chatLifecycle, taReset, allowedOrigin }) {
  if (!repository || !discussionService || !confirmPlan || !executeData || !reviseData || !allowedOrigin) {
    throw new TypeError('API dependencies required');
  }
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const reset=taReset && taResetPath.exec(pathname);
    const resetRoute=Boolean(reset && ((!reset[2] && request.method==='GET') || (reset[2] && request.method==='POST')));
    const collection=chatCollectionPath.exec(pathname);
    const collectionRoute=Boolean(collection && ['GET','POST'].includes(request.method));
    const lifecycle=chatLifecycle && lifecyclePath.exec(pathname);
    const lifecycleRoute=Boolean(lifecycle && ((!lifecycle[2] && request.method==='GET') || (lifecycle[2] && request.method==='POST')));
    const catalog = pathname === '/api/data/catalog' && request.method === 'GET';
    const match = pathPattern.exec(pathname);
    const application = applicationPath.exec(pathname);
    const bindings = bindingPath.exec(pathname);
    const batch = batchPath.exec(pathname);
    const files = filesPath.exec(pathname);
    const parsing = parsingPath.exec(pathname);
    const confirmation = confirmationPath.exec(pathname);
    const resultReview=caseResult && resultPath.exec(pathname);
    const resultRoute=Boolean(resultReview && ((!resultReview[3] && request.method==='GET') || (resultReview[3] && request.method==='POST')));
    const holdings = holdingsReturn && holdingsPath.exec(pathname);
    const holdingsRoute = Boolean(holdings && ((!holdings[3] && request.method==='GET') || (holdings[3] && request.method==='POST')));
    const supplement = exchangePlanSupplement && supplementPath.exec(pathname);
    const supplementRoute=Boolean(supplement && request.method==='POST');
    const salesRoute = Boolean(returnConfirmation && pathname === '/api/sales-data' && request.method === 'GET');
    const confirmationRoute = Boolean(returnConfirmation && confirmation &&
      ((!confirmation[3] && request.method === 'GET') || (confirmation[3] && request.method === 'POST')));
    const parsingRoute = Boolean(returnParsing && parsing &&
      ((!parsing[3] && request.method === 'GET') || (parsing[3] && request.method === 'POST')));
    const channels = pathname === '/api/exchange/channels';
    const exchangeRoute = Boolean(exchangeRepository &&
      ((channels && request.method === 'GET') ||
        (bindings && request.method === 'GET') ||
        (application && ['GET', 'POST'].includes(request.method)) ||
        (batch && request.method === 'POST') ||
        (files && request.method === 'GET')));
    if (!resetRoute && !collectionRoute && !lifecycleRoute && !resultRoute && !holdingsRoute && !supplementRoute && !catalog && !salesRoute && !confirmationRoute && !exchangeRoute && !parsingRoute && (!match || !['GET', 'POST', 'PATCH'].includes(request.method) ||
        (request.method === 'PATCH' && match?.[3] !== 'data') ||
        (['plan/confirm', 'data/execute', 'data/confirm'].includes(match?.[3]) && request.method !== 'POST') ||
        (match?.[3] === 'data/review' && !['GET', 'POST'].includes(request.method)) ||
        (match?.[3] === 'data' && !['GET', 'PATCH'].includes(request.method)))) {
      send(response, 404, { error: 'NOT_FOUND' }); return;
    }
    try {
      const token = cookieToken(request.headers.cookie);
      if (!token) { send(response, 401, { error: 'UNAUTHENTICATED' }); return; }
      if(repository.assertCaseWritable && match && request.method==='POST' && ['discussion','plan','data/execute','data/review','application-preparation'].includes(match[3])){
        await repository.assertCaseWritable(token,match[1],match[2],{discussion:['discussion','plan'].includes(match[3])});
      }
      if(resetRoute){
        if(!reset[2]){send(response,200,await taReset.read(token,{channelId:reset[1]}));return;}
        if(request.headers.origin!==allowedOrigin){send(response,403,{error:'INVALID_ORIGIN'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')){send(response,415,{error:'UNSUPPORTED_MEDIA_TYPE'});return;}
        const body=await jsonBody(request);
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==3||!['requestId','reason','confirmation'].every(k=>Object.hasOwn(body,k))){send(response,400,{error:'INVALID_INPUT'});return;}
        send(response,200,await taReset.confirm(token,{channelId:reset[1],...body}));return;
      }
      if(collectionRoute){
        if(request.method==='GET'){send(response,200,collection[1]?await repository.listCases(token,collection[1]):await repository.listChats(token));return;}
        if(request.headers.origin!==allowedOrigin){send(response,403,{error:'INVALID_ORIGIN'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')){send(response,415,{error:'UNSUPPORTED_MEDIA_TYPE'});return;}
        const body=await jsonBody(request);
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'title')){send(response,400,{error:'INVALID_INPUT'});return;}
        send(response,201,collection[1]?await repository.createCase(token,collection[1],body.title):await repository.createChat(token,body.title));return;
      }
      if(lifecycleRoute){
        if(!lifecycle[2]){send(response,200,await chatLifecycle.read(token,{chatPublicId:lifecycle[1]}));return;}
        if(request.headers.origin!==allowedOrigin){send(response,403,{error:'INVALID_ORIGIN'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')){send(response,415,{error:'UNSUPPORTED_MEDIA_TYPE'});return;}
        const body=await jsonBody(request);
        const kind=lifecycle[2];
        const keys=kind==='close'?(body?.mode==='FORCE'?['mode','reason']:['mode']):kind==='retest'?['requestId','casePublicId','reason']:['requestId','reason','confirmPreserveFormalData'];
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==keys.length||!keys.every(k=>Object.hasOwn(body,k))){send(response,400,{error:'INVALID_INPUT'});return;}
        const method=kind==='new-run'?'newRun':kind;
        send(response,200,await chatLifecycle[method](token,{chatPublicId:lifecycle[1],...body}));return;
      }
      if(supplementRoute) {
        if(request.headers.origin!==allowedOrigin){send(response,403,{error:'INVALID_ORIGIN'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')){send(response,415,{error:'UNSUPPORTED_MEDIA_TYPE'});return;}
        const body=await jsonBody(request);
        if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==3 || !['baseVersionNumber','exchangePlan','mappings'].every(key=>Object.hasOwn(body,key))){send(response,400,{error:'INVALID_INPUT'});return;}
        send(response,200,await exchangePlanSupplement.confirm(token,{chatPublicId:supplement[1],casePublicId:supplement[2],...body}));return;
      }
      if(resultRoute){
        const scope={chatPublicId:resultReview[1],casePublicId:resultReview[2]};
        if(request.method==='GET'){send(response,200,await caseResult.read(token,scope));return;}
        if(request.headers.origin!==allowedOrigin){send(response,403,{error:'INVALID_ORIGIN'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')){send(response,415,{error:'UNSUPPORTED_MEDIA_TYPE'});return;}
        const body=await jsonBody(request,4096);const keys=resultReview[3]==='evaluate'?[]:['reviewId','verdict','reason'];
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==keys.length||!keys.every(k=>Object.hasOwn(body,k))){send(response,400,{error:'INVALID_INPUT'});return;}
        send(response,200,await caseResult[resultReview[3]](token,{...scope,...body}));return;
      }
      if (holdingsRoute) {
        const scope={chatPublicId:holdings[1],casePublicId:holdings[2]};
        if(request.method==='GET'){send(response,200,await holdingsReturn.read(token,scope));return;}
        if(request.headers.origin!==allowedOrigin){send(response,403,{error:'INVALID_ORIGIN'});return;}
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')){send(response,415,{error:'UNSUPPORTED_MEDIA_TYPE'});return;}
        const body=await jsonBody(request,holdings[3]==='parse'?12*1024*1024:256*1024);
        const required=holdings[3]==='parse'?['channelId','files']:['parseId'];
        if(!body || typeof body!=='object' || Array.isArray(body) || !required.every(k=>Object.hasOwn(body,k)) ||
          Object.keys(body).some(k=>!required.includes(k) && k!=='exchangeStepId')){send(response,400,{error:'INVALID_INPUT'});return;}
        send(response,200,await holdingsReturn[holdings[3]](token,{...scope,...body}));return;
      }
      if (salesRoute) { send(response, 200, await returnConfirmation.salesData(token)); return; }
      if (confirmationRoute) {
        const scope = { chatPublicId: confirmation[1], casePublicId: confirmation[2] };
        if (request.method === 'GET') { send(response, 200, await returnConfirmation.read(token, scope)); return; }
        if (request.headers.origin !== allowedOrigin) { send(response, 403, { error: 'INVALID_ORIGIN' }); return; }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
          send(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' }); return;
        }
        const body = await jsonBody(request);
        const keys = confirmation[3] === 'apply' ? ['parseId','recordIndexes'] :
          confirmation[3] === 'delivery' ? ['batchPublicId'] : ['accountPublicId'];
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key=>!keys.includes(key) && !((key==='exchangeStepId' && confirmation[3]!=='account') || (key==='exchangeSteps' && confirmation[3]==='delivery'))) ||
            !keys.every(key => Object.hasOwn(body,key))) { send(response, 400, { error: 'INVALID_INPUT' }); return; }
        send(response, 200, await returnConfirmation[confirmation[3] === 'account' ? 'selectAccount' : confirmation[3]](token,{...scope,...body})); return;
      }
      if (parsingRoute) {
        const scope = { chatPublicId: parsing[1], casePublicId: parsing[2] };
        if (request.method === 'GET') {
          send(response, 200, await returnParsing.read(token, scope)); return;
        }
        if (request.headers.origin !== allowedOrigin) { send(response, 403, { error: 'INVALID_ORIGIN' }); return; }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
          send(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' }); return;
        }
        const body = await jsonBody(request, 12 * 1024 * 1024);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key=>!['batchPublicId','files','exchangeStepId'].includes(key)) ||
            !Object.hasOwn(body, 'batchPublicId') || !Object.hasOwn(body, 'files') || !Array.isArray(body.files)) {
          send(response, 400, { error: 'INVALID_INPUT' }); return;
        }
        const result=await returnParsing.parse(token, { ...scope, batchPublicId:body.batchPublicId,
          files:body.files,exchangeStepId:body.exchangeStepId,expectedType:parsing[3] });
        send(response,result.orderError?409:200,result.orderError?{...result,error:result.orderError.error,message:result.orderError.message}:result); return;
      }
      if (exchangeRoute && channels) {
        send(response, 200, await exchangeRepository.listChannels(token)); return;
      }
      if (exchangeRoute && application && request.method === 'GET') {
        send(response, 200, await exchangeRepository.listCaseApplications(token,
          { chatPublicId: application[1], casePublicId: application[2] })); return;
      }
      if (exchangeRoute && bindings) {
        send(response, 200, await exchangeRepository.listCaseBindings(token,
          { chatPublicId: bindings[1], casePublicId: bindings[2] })); return;
      }
      if (exchangeRoute && files) {
        if (!files[2]) { send(response, 200, await exchangeRepository.listOutboundFiles(token, files[1])); return; }
        const file = await exchangeRepository.readOutboundFile(token,
          { chatPublicId: files[1], fileId: files[2] });
        if (new URL(request.url, 'http://localhost').searchParams.get('view') === 'records') {
          const parsed = parseDataFile(file.rawBytes);
          send(response, 200, { fileName: file.fileName, sha256: file.sha256,
            fileType: parsed.fileType, records: parsed.records }); return;
        }
        response.writeHead(200, { 'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${file.fileName}"`,
          'content-length': file.rawBytes.length, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff' });
        response.end(file.rawBytes); return;
      }
      if (catalog) {
        send(response, 200, await repository.generatedDataCatalog(token)); return;
      }
      if (exchangeRoute) {
        if (request.headers.origin !== allowedOrigin) {
          send(response, 403, { error: 'INVALID_ORIGIN' }); return;
        }
        if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) {
          send(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' }); return;
        }
        const body = await jsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          send(response, 400, { error: 'INVALID_INPUT' }); return;
        }
        if (application) {
          const keys = Object.keys(body);
          if (keys.length !== 4 || !['channelId', 'businessDate', 'fileType', 'record']
            .every(key => Object.hasOwn(body, key))) {
            send(response, 400, { error: 'INVALID_INPUT' }); return;
          }
          const data = await repository.generatedData(token, application[1], application[2]);
          if (data.reviewStatus !== 'CONFIRMED') {
            send(response, 409, { error: 'DATA_NOT_CONFIRMED' }); return;
          }
          if(data.planDataFrozen){send(response,409,{error:'PLAN_DATA_FROZEN',message:'申请数据已在Plan中锁定，请使用申请准备按已确认Plan生成'});return;}
          send(response, 200, await exchangeRepository.stageApplication(token, {
            chatPublicId: application[1], casePublicId: application[2],
            sopVersionId: data.planVersionId, ...body }));
        } else if (batch[2]) {
          if (Object.keys(body).length) { send(response, 400, { error: 'INVALID_INPUT' }); return; }
          send(response, 200, await exchangeRepository.generateOutboundFiles(token,
            { chatPublicId: batch[1], batchPublicId: batch[2] }));
        } else {
          if (Object.keys(body).length !== 3 ||
              !['channelId', 'businessDate', 'applicationPublicIds'].every(key => Object.hasOwn(body, key))) {
            send(response, 400, { error: 'INVALID_INPUT' }); return;
          }
          send(response, 200, await exchangeRepository.createOutboundBatch(token,
            { chatPublicId: batch[1], ...body }));
        }
        return;
      }
      const [chatPublicId, casePublicId, action] = match.slice(1);
      if (action === 'application-preparation' && (!applicationPreparation || !['GET','POST'].includes(request.method))) {
        send(response, 404, { error: 'NOT_FOUND' }); return;
      }
      if (request.method === 'GET') {
        if (action === 'application-preparation') {
          send(response, 200, await applicationPreparation.read(token, { chatPublicId, casePublicId })); return;
        }
        send(response, 200, action === 'plan' ?
          await repository.getLatestSopProposal(token, chatPublicId, casePublicId) :
          action === 'data' ? await repository.generatedData(token, chatPublicId, casePublicId) :
            action === 'data/review' ? await repository.dataReviewTurns(token, chatPublicId, casePublicId) :
            await repository.readCaseDiscussion(token, chatPublicId, casePublicId));
        return;
      }
      if (request.headers.origin !== allowedOrigin) {
        send(response, 403, { error: 'INVALID_ORIGIN' }); return;
      }
      if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) {
        send(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' }); return;
      }
      const body = await jsonBody(request);
      if (action === 'application-preparation') {
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !['revision','userInput','channelId'].includes(key)) ||
          (body.revision !== undefined && (!Number.isSafeInteger(body.revision) || body.revision < 0)) ||
          (body.userInput !== undefined && (typeof body.userInput !== 'string' ||
            !body.userInput.trim() || body.userInput.length > 4000)) ||
          (body.channelId !== undefined && !/^[1-9]\d{0,18}$/.test(body.channelId))) {
          send(response, 400, { error: 'INVALID_INPUT' }); return;
        }
        send(response, 200, await applicationPreparation.prepare({ token, chatPublicId, casePublicId,
          ...body, ...(body.userInput ? { userInput: body.userInput.trim() } : {}) })); return;
      }
      if (action === 'data' && request.method === 'PATCH') {
        const edit = DataEditSchema.safeParse(body);
        if (!edit.success) { send(response, 422, { error: 'DATA_EDIT_INVALID', message: '表格内容格式有误' }); return; }
        send(response, 200, await repository.editGeneratedData(token, chatPublicId, casePublicId, edit.data));
        return;
      }
      const versionRequest = ['plan/confirm', 'data/execute'].includes(action);
      const revisionRequest = action === 'data/confirm';
      const reviewRequest = action === 'data/review';
      const validInput = body && typeof body === 'object' && !Array.isArray(body) &&
        (versionRequest ? Object.keys(body).length === (action==='plan/confirm'?2:1) &&
          (action!=='plan/confirm' || ['DATA','EXPECTATIONS'].includes(body.section)) &&
          Number.isSafeInteger(body.versionNumber) && body.versionNumber > 0 :
          revisionRequest ? Object.keys(body).length === 1 &&
            Number.isSafeInteger(body.revision) && body.revision >= 0 :
            reviewRequest ? Object.keys(body).length === 2 &&
              Object.hasOwn(body, 'revision') && Object.hasOwn(body, 'userInput') &&
              Number.isSafeInteger(body.revision) && body.revision >= 0 &&
              typeof body.userInput === 'string' && Boolean(body.userInput.trim()) &&
              body.userInput.length <= 4000 :
              Object.keys(body).length === 1 && typeof body.userInput === 'string' &&
              Boolean(body.userInput.trim()) && body.userInput.length <= 4000);
      if (!validInput) {
        send(response, 400, { error: 'INVALID_INPUT' }); return;
      }
      if (action === 'plan/confirm') {
        send(response, 200, await confirmPlan({ token, chatPublicId, casePublicId,
          versionNumber: body.versionNumber, section: body.section }));
      } else if (action === 'data/execute') {
        send(response, 200, await executeData({ token, chatPublicId, casePublicId,
          versionNumber: body.versionNumber }));
      } else if (action === 'data/confirm') {
        send(response, 200, confirmData ? await confirmData({ token, chatPublicId, casePublicId,
          revision: body.revision }) : await repository.confirmGeneratedData(token, chatPublicId, casePublicId,
          body.revision));
      } else if (action === 'data/review') {
        send(response, 200, await reviseData({ token, chatPublicId, casePublicId,
          revision: body.revision, userInput: body.userInput.trim() }));
      } else {
        const method = action === 'plan' ? 'propose' : 'discuss';
        send(response, 200, await discussionService[method]({ token, chatPublicId, casePublicId,
          userInput: body.userInput }));
      }
    } catch (error) {
      if (['ER_DUP_ENTRY', 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2',
        'ER_CHECK_CONSTRAINT_VIOLATED'].includes(error.code)) {
        send(response, 409, { error: 'DATA_EDIT_CONSTRAINT',
          message: '记录重复，或客户、基金与持有记录的关联不正确。请检查表格内容。' });
        return;
      }
      send(response, Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ?
        error.status : 500, { error: error.status ? error.code : 'INTERNAL_ERROR',
          ...(error.status ? { message: error.message } : {}) });
    }
  };
}

export function createCaseHttpServer(dependencies) {
  return createServer(createCaseHttpHandler(dependencies));
}
