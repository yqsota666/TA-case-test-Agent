export async function readCaseEventStream(body,onEvent=()=>{}) {
  const reader=body.getReader(),decoder=new TextDecoder();
  let buffer='',result,finished=false;
  try{
    while(!finished){
      const {value,done}=await reader.read();
      buffer+=decoder.decode(value,{stream:!done});
      let match;
      while((match=/\r?\n\r?\n/.exec(buffer))){
        const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
        const lines=frame.split(/\r?\n/);
        const name=lines.find(line=>line.startsWith('event:'))?.slice(6).trim();
        const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
        if(!data)continue;
        const payload=JSON.parse(data);
        if(name==='error')throw Object.assign(new Error(payload.message||'回复中断，请重试原输入'),{code:payload.error,status:payload.status});
        onEvent(name,payload);
        if(name==='result'){result=payload;finished=true;break;}
      }
      if(done)break;
    }
    if(!finished)throw Object.assign(new Error('回复连接中断，请重试原输入'),{code:'STREAM_INCOMPLETE'});
    return result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
