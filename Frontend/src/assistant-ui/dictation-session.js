export const idleDictation = {phase:'idle', transcript:'', seconds:0, error:'',recoverable:false};
export const activeDictation = state => ['starting','recording','stopping'].includes(state.phase);

export function appendDictation(draft, transcript) {
  const text=transcript.trim();
  if (!text) return draft;
  return `${draft}${draft && !/\s$/.test(draft) ? '\n' : ''}${text}`;
}

// Consume assistant-ui's DictationAdapter without committing its partial results
// into the application's controlled draft. Cancel must leave that draft intact.
export class DictationSession {
  constructor({createSession, onState, onCommit, now=()=>Date.now(), schedule=(fn,ms)=>setInterval(fn,ms), unschedule=id=>clearInterval(id)}) {
    Object.assign(this,{createSession,onState,onCommit,now,schedule,unschedule});
    this.state=idleDictation;
    this.session=null;
    this.cleanups=[];
  }
  publish(patch) {
    this.state={...this.state,...patch};
    this.onState(this.state);
  }
  start(draft) {
    if (this.session) return;
    this.base=draft;
    this.final='';
    this.partial='';
    this.started=this.now();
    this.publish({...idleDictation,phase:'starting'});
    let session;
    try { session=this.createSession(); }
    catch { this.publish({phase:'error',error:'无法启动语音输入，请检查麦克风权限后重试。'}); return; }
    this.session=session;
    this.cleanups=[session.onSpeech(result=>{
      if (this.session!==session) return;
      if (result.isFinal!==false) {this.final+=result.transcript;this.partial='';}
      else this.partial=result.transcript;
      this.publish({transcript:this.final+this.partial,recoverable:!!this.final.trim()});
    }),session.onSpeechEnd(()=>{if(this.session===session)this.check();})];
    this.timer=this.schedule(()=>this.check(),100);
    this.check();
  }
  check() {
    const session=this.session;
    if (!session) return;
    const seconds=Math.floor((this.now()-this.started)/1000);
    const status=session.status;
    if (status.type==='ended') {
      this.release(status.reason!=='stopped');
      if (status.reason==='stopped' && this.final.trim()) this.commit();
      else if (status.reason==='cancelled') this.publish({phase:'error',transcript:this.final,error:'语音输入已中断，请重试；原输入已保留。'});
      else this.publish({phase:'error',transcript:this.final,error:status.reason==='error'
        ? '语音识别失败，请检查麦克风权限和网络后重试。'
        : '没有识别到完整语音，请靠近麦克风后重试。'});
      return;
    }
    if (this.state.phase==='starting' && seconds>=15) {
      this.release(true);
      this.publish({phase:'error',error:'语音输入未启动，请检查麦克风权限后重试。'});
      return;
    }
    if (this.state.phase!=='stopping' && seconds>=120) {void this.stop();return;}
    const phase=this.state.phase==='stopping'?'stopping':status.type==='running'?'recording':'starting';
    if (phase!==this.state.phase || seconds!==this.state.seconds) this.publish({phase,seconds});
  }
  async stop() {
    const session=this.session;
    if (!session || this.state.phase==='stopping') return;
    this.publish({phase:'stopping'});
    try {await session.stop();}
    catch {
      if(this.session!==session)return;
      this.release(true);
      this.publish({phase:'error',error:'无法完成语音识别，请重试；原输入已保留。'});
      return;
    }
    if(this.session===session)this.check();
  }
  commit() {
    const text=appendDictation(this.base,this.final);
    if(text.length>4000){this.publish({phase:'error',error:'合并后的消息超过4000字，请先缩短原输入后重新听写。'});return;}
    this.publish(idleDictation);
    this.onCommit(text);
  }
  keep(draft=this.base) {
    if(this.state.phase==='error' && this.final.trim()){this.base=draft;this.commit();}
  }
  release(abort=false) {
    const session=this.session;
    this.session=null;
    this.unschedule(this.timer);
    this.cleanups.forEach(cleanup=>cleanup());
    this.cleanups=[];
    if(abort)try{session?.cancel();}catch{ /* A browser may already have closed the microphone. */ }
  }
  cancel() {this.release(true);this.publish(idleDictation);}
  dispose() {this.release(true);}
}
