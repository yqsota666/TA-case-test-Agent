import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CaseAssistant} from '../src/case-assistant.jsx';
import {Composer} from '../src/assistant-ui/chat-kit.jsx';
import {ThemeProvider} from '../src/theme-picker.jsx';
import '../src/base.css';
import '../src/case-workbench.css';
import '../src/defense-themes.css';
import '../src/liquid-home.css';
import '../src/case-assistant.css';

const mode=new URLSearchParams(location.search).get('mode')||'normal';
let recognition;
// This fixture exercises the installed assistant-ui adapter using browser events.
// No microphone, audio upload, model, or business API is used.
class SyntheticRecognition extends EventTarget {
  constructor(){super();recognition=this;this.results=[];}
  emit(type,properties={}){this.dispatchEvent(Object.assign(new Event(type),properties));}
  start(){setTimeout(()=>{if(mode==='denied'){this.emit('error',{error:'not-allowed',message:'synthetic denial'});this.emit('end');}else this.emit('start');},0);}
  result(text,final=false){this.results=[{0:{transcript:text},isFinal:final}];this.emit('result',{results:this.results,resultIndex:0});}
  stop(){this.result('合成听写：比较订单状态，金额1000元。',true);this.emit('end');}
  abort(){this.emit('error',{error:'aborted'});this.emit('end');}
}
window.SpeechRecognition=mode==='unsupported'?undefined:SyntheticRecognition;
window.webkitSpeechRecognition=undefined;
document.documentElement.dataset.theme='liquid';
function Fixture(){
  const [draft,setDraft]=useState('原有条件：同一日期。'),[disabled,setDisabled]=useState(false),[sent,setSent]=useState(''),[id,setId]=useState(1);
  const ref=useRef(null);
  return <ThemeProvider initial="liquid"><div className="cw-shell cw-liquid-home" style={{display:'flex',flexDirection:'column',height:'100dvh',padding:20,boxSizing:'border-box'}}>
    <p>合成语音验收，不使用麦克风或业务接口</p>
    <nav style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button onClick={()=>recognition?.result('合成临时文字',false)}>产生临时识别</button>
      <button onClick={()=>recognition?.result('长说明'.repeat(200),false)}>产生长文本</button>
      <button onClick={()=>{recognition?.result('已识别完整内容。',true);recognition?.emit('error',{error:'network',message:'synthetic network'});recognition?.emit('end');}}>产生网络失败</button>
      <button onClick={()=>setDisabled(v=>!v)}>切换只读</button>
      <button onClick={()=>{setId(v=>v+1);setDraft('另一个Case原文');}}>切换Case</button>
    </nav>
    <p role="status">已发送：{sent||'无'}</p>
    <div style={{marginTop:'auto'}}><CaseAssistant key={id} messages={[]} draft={draft} disabled={disabled} onSend={setSent}>
      <div className="cw-composer-frame"><Composer ref={ref} value={draft} onChange={event=>setDraft(event.target.value)} disabled={disabled}/></div>
    </CaseAssistant></div>
  </div></ThemeProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
