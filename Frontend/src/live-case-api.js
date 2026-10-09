import {accountStorageOwner} from './account-storage.js';
import {readCaseEventStream} from './case-event-stream.js';
export async function requestCaseStream(path,body,{onDelta,signal}={}) {
  const owner=accountStorageOwner();
  const response=await fetch('/live-api'+path,{method:'POST',credentials:'same-origin',cache:'no-store',signal,
    headers:{'Content-Type':'application/json',Accept:'text/event-stream',...(owner?{'X-Case-Account':owner}:{})},body:JSON.stringify(body)});
  const checkOwner=()=>{if(owner!==accountStorageOwner())throw Object.assign(new Error('账户已切换，请重新连接'),{status:409,code:'ACCOUNT_CHANGED'});};
  checkOwner();
  if(!response.ok){
    const value=await response.json();
    if(response.status===401||value.error==='ACCOUNT_CHANGED')window.dispatchEvent(new Event('case-session-expired'));
    throw Object.assign(new Error(value.message||value.error||'请求失败'),{status:response.status,code:value.error});
  }
  if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('服务器没有返回流式回复');
  return readCaseEventStream(response.body,(event,value)=>{checkOwner();if(event==='delta')onDelta?.(value.text);});
}
export async function requestCase(path, body) {
  const owner=accountStorageOwner();
  const response = await fetch('/live-api'+path, {method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(!['/auth/me','/auth/login','/auth/register','/auth/demo'].includes(path)&&owner?{'X-Case-Account':owner}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  if(!path.startsWith('/auth/')&&owner!==accountStorageOwner())throw Object.assign(new Error('账户已切换，请重新连接'),{status:409,code:'ACCOUNT_CHANGED'});
  if(!response.ok){
    if((response.status===401&&!path.startsWith('/auth/'))||value.error==='ACCOUNT_CHANGED')window.dispatchEvent(new Event('case-session-expired'));
    const message=response.status===401&&!path.startsWith('/auth/')?'请重新登录':value.message||value.error||`请求失败 (${response.status})`;
    throw Object.assign(new Error(message),{status:response.status,code:value.error});
  }
  return value;
}
export const casePath=(chatId,caseId)=>`/chats/${chatId}/cases/${caseId}`;
export async function liveSnapshot(chatId,caseId) {
  const {chats}=await requestCase('/chats');
  const projects=await Promise.all(chats.map(async chat=>{
    const {cases}=await requestCase(`/chats/${chat.public_id}/cases`);
    return {id:chat.public_id,name:chat.title,expanded:true,status:chat.status,cases:cases.map(item=>({id:item.public_id,name:item.title,status:item.status}))};
  }));
  const project=projects.find(item=>item.id===chatId);
  const selected=project?.cases.find(item=>item.id===caseId);
  if(!selected)return {projects,project:null,case:null,turns:[]};
  const path=casePath(chatId,caseId);
  const [history,plan,workflow,generatedData]=await Promise.all([requestCase(path+'/discussion'),requestCase(path+'/plan'),requestCase(path+'/workflow'),requestCase(path+'/data')]);
  return {projects,project,case:selected,...history,plan,workflow,generatedData};
}
