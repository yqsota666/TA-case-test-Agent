import {accountCookie} from './account-auth.js';

export function createAccountHttpHandler({accountAuth,allowedOrigin,secureCookie=false}) {
  const attempts=new Map();
  const send=(response,status,value)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));};
  return async (request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname;
    if(!path.startsWith('/api/auth/'))return false;
    const action=path.slice('/api/auth/'.length);
    if(!accountAuth||!['me','register','login','demo','logout','password'].includes(action)||(action==='me'?request.method!=='GET':request.method!=='POST')){send(response,404,{error:'NOT_FOUND'});return true;}
    const cookie=String(request.headers.cookie??'').split(';').map(value=>value.trim()).find(value=>value.startsWith('case_session='));
    let token;try {token=cookie&&decodeURIComponent(cookie.slice(13));}catch {}
    try {
      if(['logout','password'].includes(action)&&request.headers['x-case-account']){const current=await accountAuth.current(token);if(current.user.id!==request.headers['x-case-account'])throw Object.assign(new Error('账户已切换，请重新连接'),{status:409,code:'ACCOUNT_CHANGED'});}
      if(action==='me'){const current=await accountAuth.current(token);response.setHeader('set-cookie',accountCookie(token,{secure:secureCookie}));send(response,200,current);return true;}
      if(request.headers.origin!==allowedOrigin){send(response,403,{error:'INVALID_ORIGIN',message:'请求来源不正确，请从本网站重新登录'});return true;}
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')){send(response,415,{error:'UNSUPPORTED_MEDIA_TYPE'});return true;}
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>4096)throw Object.assign(new Error('请求内容过长'),{status:413,code:'REQUEST_TOO_LARGE'});chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('请求格式不正确'),{status:400,code:'INVALID_JSON'});}
      if(['register','login','demo'].includes(action)){
        const now=Date.now();
        for(const [key,value] of attempts)if(now-value.started>15*60*1000)attempts.delete(key);
        const key=request.socket.remoteAddress??'unknown';
        const entry=attempts.get(key)??{started:now,count:0};
        if(entry.count>=30)throw Object.assign(new Error('尝试次数过多，请稍后再试'),{status:429,code:'RATE_LIMITED'});
        entry.count++;attempts.set(key,entry);
      } else if(action==='logout'&&(!input||Array.isArray(input)||Object.keys(input).length))throw Object.assign(new Error('请求格式不正确'),{status:400,code:'INVALID_INPUT'});
      const result=action==='logout'?await accountAuth.logout(token):action==='password'?await accountAuth.password(token,input):await accountAuth[action](input);
      response.setHeader('set-cookie',accountCookie(result.token,{secure:secureCookie}));
      send(response,action==='register'?201:200,action==='logout'?result:{user:result.user});
    } catch(error){send(response,error.status??500,{error:error.status?error.code:'INTERNAL_ERROR',message:error.status?error.message:'登录暂时不可用，请稍后重试'});}
    return true;
  };
}
