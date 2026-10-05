import { createServer } from 'node:http';
import { DataEditSchema } from '../../case-agent/src/index.js';

const pathPattern = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/(discussion|plan|plan\/confirm|data|data\/execute|data\/review|data\/confirm)$/i;

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

async function jsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) {
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
  reviseData, allowedOrigin }) {
  if (!repository || !discussionService || !confirmPlan || !executeData || !reviseData || !allowedOrigin) {
    throw new TypeError('API dependencies required');
  }
  return async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const catalog = pathname === '/api/data/catalog' && request.method === 'GET';
    const match = pathPattern.exec(pathname);
    if (!catalog && (!match || !['GET', 'POST', 'PATCH'].includes(request.method) ||
        (request.method === 'PATCH' && match?.[3] !== 'data') ||
        (['plan/confirm', 'data/execute', 'data/confirm'].includes(match?.[3]) && request.method !== 'POST') ||
        (match?.[3] === 'data/review' && !['GET', 'POST'].includes(request.method)) ||
        (match?.[3] === 'data' && !['GET', 'PATCH'].includes(request.method)))) {
      send(response, 404, { error: 'NOT_FOUND' }); return;
    }
    try {
      const token = cookieToken(request.headers.cookie);
      if (!token) { send(response, 401, { error: 'UNAUTHENTICATED' }); return; }
      if (catalog) {
        send(response, 200, await repository.generatedDataCatalog(token)); return;
      }
      const [chatPublicId, casePublicId, action] = match.slice(1);
      if (request.method === 'GET') {
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
        (versionRequest ? Object.keys(body).length === 1 &&
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
          versionNumber: body.versionNumber }));
      } else if (action === 'data/execute') {
        send(response, 200, await executeData({ token, chatPublicId, casePublicId,
          versionNumber: body.versionNumber }));
      } else if (action === 'data/confirm') {
        send(response, 200, await repository.confirmGeneratedData(token, chatPublicId, casePublicId,
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
          ...(error.status && String(error.code).startsWith('DATA_') ? { message: error.message } : {}) });
    }
  };
}

export function createCaseHttpServer(dependencies) {
  return createServer(createCaseHttpHandler(dependencies));
}
