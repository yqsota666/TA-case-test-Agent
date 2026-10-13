import React,{useEffect,useMemo,useRef,useState} from 'react';
import {WebSpeechDictationAdapter} from '@assistant-ui/react';
import {Mic,Square,X} from 'lucide-react';
import {DictationSession,activeDictation,idleDictation} from './dictation-session.js';
import './voice-input.css';

export function useVoiceInput({value,onChange,disabled,enabled=true,inputRef}) {
  const [state,setState]=useState(idleDictation);
  const latest=useRef({onChange,inputRef});
  latest.current={onChange,inputRef};
  const supported=typeof window!=='undefined' && window.isSecureContext && WebSpeechDictationAdapter.isSupported();
  const session=useMemo(()=>new DictationSession({
    createSession:()=>new WebSpeechDictationAdapter({language:'zh-CN',continuous:true,interimResults:true}).listen(),
    onState:setState,
    onCommit:text=>{latest.current.onChange({target:{value:text}});latest.current.inputRef.current?.focus();},
  }),[]);
  useEffect(()=>()=>session.dispose(),[session]);
  useEffect(()=>{if(disabled||!enabled)session.cancel();},[disabled,enabled,session]);
  useEffect(()=>{
    const stop=()=>session.cancel();
    const visibility=()=>{if(document.hidden)stop();};
    window.addEventListener('pagehide',stop);
    document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('pagehide',stop);document.removeEventListener('visibilitychange',visibility);};
  },[session]);
  const active=activeDictation(state);
  const start=()=>{
    if(disabled||!enabled)return;
    if(!supported){setState({...idleDictation,phase:'error',error:'当前浏览器不支持语音识别，请用 Chrome、Edge 或 Safari 打开此页面，或使用系统听写。'});return;}
    session.start(value);
  };
  return {state,active,start,stop:()=>session.stop(),cancel:()=>{session.cancel();inputRef.current?.focus();},keep:()=>session.keep(value)};
}

export function VoiceFeedback({voice}) {
  const {state,active}=voice;
  if(!active && state.phase!=='error')return null;
  const label=state.phase==='starting'?'正在启动麦克风…':state.phase==='stopping'?'正在完成识别…':'正在听写';
  return <div className="aui-voice-feedback">
    {active && <div className="aui-voice-status" role="status"><span className="aui-voice-dot" aria-hidden="true"/>{label}<time aria-label={`已用${state.seconds}秒`}>{Math.floor(state.seconds/60)}:{String(state.seconds%60).padStart(2,'0')}</time></div>}
    {state.transcript && <p className="aui-voice-transcript">{state.transcript}</p>}
    {state.phase==='error' && <div className="aui-voice-error" role="alert"><span>{state.error}</span><button type="button" aria-label="关闭语音提示" onClick={voice.cancel}><X size={16}/></button></div>}
  </div>;
}

export function VoiceControls({voice,disabled}) {
  if(voice.active)return <>
    <button type="button" className="aui-voice-cancel" onClick={voice.cancel} aria-label="取消语音输入">取消</button>
    <button type="button" autoFocus className="aui-voice-done" onClick={voice.stop} disabled={voice.state.phase==='stopping'}><Square size={14} aria-hidden="true"/>完成</button>
  </>;
  return <>
    {voice.state.phase==='error' && voice.state.recoverable && <button type="button" className="aui-voice-cancel" disabled={disabled} onClick={voice.keep}>使用已识别文字</button>}
    <button type="button" className="aui-icon-button aui-voice-start" aria-label="语音输入" title="语音输入（中文）" disabled={disabled} onClick={voice.start}><Mic size={20}/></button>
  </>;
}
