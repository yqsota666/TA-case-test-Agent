export function createAccountModelHttpHandler({accountModelQuotas,accountAuth,allowedOrigin}) {
 return async(request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(!['/api/account/usage'].includes(url.pathname))return false;
  const send=(status,value)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(value));};
  try {
   const cookie=String(request.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('case_session='));
   let token;try{token=cookie&&decodeURIComponent(cookie.slice(13));}catch{}
   const current=await accountAuth.current(token);
   if(request.headers['x-case-account']&&request.headers['x-case-account']!==current.user.id)throw Object.assign(new Error('账户已切换，请重新连接'),{status:409,code:'ACCOUNT_CHANGED'});
   if(request.method!=='GET'){send(405,{error:'METHOD_NOT_ALLOWED'});return true;}
   send(200,await accountModelQuotas.usage(token));
  }catch(e){send(e.status??500,{error:e.status?e.code:'INTERNAL_ERROR',message:e.status?e.message:'额度暂时不可用，请稍后重试'});}
  return true;
 };
}
