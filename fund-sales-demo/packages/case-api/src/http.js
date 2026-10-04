import { createServer } from 'node:http';

const pathPattern = /^\/api\/chats\/([0-9a-f-]{36})\/cases\/([0-9a-f-]{36})\/discussion$/i;

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function cookieToken(header) {
  const cookie = String(header ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith('case_session='));
  return cookie ? decodeURIComponent(cookie.slice('case_session='.length)) : null;
}

async function jsonBody(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 5000) {
      const error = new Error('请求内容过长');
      error.code = 'REQUEST_TOO_LARGE'; error.status = 413;
      throw error;
    }
  }
  try { return JSON.parse(text); }
  catch {
    const error = new Error('请求须为 JSON');
    error.code = 'INVALID_JSON'; error.status = 400;
    throw error;
  }
}

export function createCaseHttpHandler({ repository, discussionService, allowedOrigin }) {
  if (!repository || !discussionService || !allowedOrigin) throw new TypeError('API dependencies required');
  return async (request, response) => {
    const match = pathPattern.exec(new URL(request.url, 'http://localhost').pathname);
    if (!match || !['GET', 'POST'].includes(request.method)) {
      send(response, 404, { error: 'NOT_FOUND' }); return;
    }
    try {
      const token = cookieToken(request.headers.cookie);
      if (!token) { send(response, 401, { error: 'UNAUTHENTICATED' }); return; }
      const [chatPublicId, casePublicId] = match.slice(1);
      if (request.method === 'GET') {
        send(response, 200, await repository.readCaseDiscussion(token, chatPublicId, casePublicId));
        return;
      }
      if (request.headers.origin !== allowedOrigin) {
        send(response, 403, { error: 'INVALID_ORIGIN' }); return;
      }
      if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) {
        send(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' }); return;
      }
      const body = await jsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== 1 || typeof body.userInput !== 'string') {
        send(response, 400, { error: 'INVALID_INPUT' }); return;
      }
      send(response, 200, await discussionService.discuss({ token, chatPublicId, casePublicId,
        userInput: body.userInput }));
    } catch (error) {
      send(response, Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ?
        error.status : 500, { error: error.status ? error.code : 'INTERNAL_ERROR' });
    }
  };
}

export function createCaseHttpServer(dependencies) {
  return createServer(createCaseHttpHandler(dependencies));
}
