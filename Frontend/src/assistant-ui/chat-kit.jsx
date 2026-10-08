import {QuoteReply} from './quote-reply.jsx';
import React, {forwardRef, useEffect, useMemo, useRef, useState} from 'react';
import {ActionBarPrimitive, ComposerPrimitive, MessagePrimitive, ThreadPrimitive} from '@assistant-ui/react';
import {MarkdownTextPrimitive, useIsMarkdownCodeBlock, unstable_memoizeMarkdownComponents as memoizeMarkdownComponents} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import {ArrowUp, Check, Copy, LoaderCircle} from 'lucide-react';
import {formatDuration} from '../message-body.jsx';
import './chat-kit.css';

// Adapted from assistant-ui's MIT Thread and MarkdownText elements; see docs/assistant-ui接入验收.md.
export function Thread({children, ...props}) {
  return <ThreadPrimitive.Root asChild><main {...props} data-slot="aui-thread-root">{children}</main></ThreadPrimitive.Root>;
}
export const ThreadViewport = forwardRef(function ThreadViewport({children, ...props}, ref) {
  return <ThreadPrimitive.Viewport asChild scrollToBottomOnInitialize={false}><section {...props} ref={ref} data-slot="aui-thread-viewport">{children}</section></ThreadPrimitive.Viewport>;
});
export const ThreadMessages = ThreadPrimitive.Messages;

function CopyButton({text, label='复制回答', primitive=false}) {
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async event => {
    // Catch clipboard failures locally instead of letting an action reject silently.
    event.preventDefault();
    clearTimeout(timer.current);
    setState('copying');
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 2200);
    } catch { setState('error'); }
  };
  const Button = primitive ? ActionBarPrimitive.Copy : 'button';
  return <>
    <Button type="button" className="aui-icon-button" disabled={!text || state==='copying'} onClick={copy}
      aria-label={state==='copied'?'已复制':label} title={state==='copied'?'已复制':label} data-copy-state={state}>
      {state==='copied'?<Check size={16}/>:state==='copying'?<LoaderCircle size={16}/>:<Copy size={16}/>}
    </Button>
    <span role="status" className={state==='error'?'aui-copy-error':'cw-sr-only'}>{state==='error'?'复制失败，请选择文字后复制。':state==='copied'?'已复制':''}</span>
  </>;
}

function CodeHeader({language, code}) {
  return <div className="aui-code-header"><span>{language || '代码'}</span><CopyButton text={code} label="复制代码"/></div>;
}
const markdownComponents = memoizeMarkdownComponents({
  a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer"/>,
  img: ({alt}) => <span>{alt}</span>,
  table: ({node, ...props}) => <div className="aui-md-table-wrapper"><table {...props}/></div>,
  code: function Code({node, className, ...props}) {
    const block = useIsMarkdownCodeBlock();
    return <code className={[className, !block && 'aui-md-inline-code'].filter(Boolean).join(' ')} {...props}/>;
  },
  CodeHeader,
});
export function MarkdownText({displayText}) {
  return <MarkdownTextPrimitive className="aui-md" remarkPlugins={[remarkGfm]} components={markdownComponents}
    skipHtml smooth={false} defer preprocess={displayText === undefined ? undefined : () => displayText}/>;
}
export function MessageActions({text, durationMs, createdAt}) {
  const duration = formatDuration(durationMs);
  const date = createdAt ? new Date(createdAt) : null;
  const validDate = date && Number.isFinite(date.getTime());
  return <div className="aui-message-footer">
    <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="aui-message-actions">
      <CopyButton text={text} primitive/>
    </ActionBarPrimitive.Root>
    <div className="aui-message-meta">{validDate && <time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>{date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</time>}{duration && <span>用时 {duration}</span>}</div>
  </div>;
}
export function ChatMessage({message, text, children, onQuote}) {
  const [selection,setSelection]=useState('');
  const capture=event=>{if(event.target.closest('[data-slot="quote-reply"]'))return;const selected=window.getSelection();setSelection(selected&&!selected.isCollapsed&&event.currentTarget.contains(selected.anchorNode)&&event.currentTarget.contains(selected.focusNode)?selected.toString().trim():'');};
  const content = [text, message.continuation].filter(Boolean).join('\n\n');
  const user = message.role==='user';
  const parts = useMemo(() => ({Text: () => <MarkdownText displayText={content}/>}), [content]);
  return <MessagePrimitive.Root asChild><article className={`cw-message cw-message-${message.role} aui-message aui-message-${message.role}`}
    onPointerUp={user||!onQuote?undefined:capture} onKeyUp={user||!onQuote?undefined:capture}
    data-slot={user?'aui-user-message':'aui-assistant-message'} aria-label={user?'我的消息':'AI 回复'}>
    <div className={user?'aui-user-message-content':'aui-assistant-message-content'}>
      {user ? <p>{content}</p> : <MessagePrimitive.Parts components={parts}/>}
      {children}
    </div>
    {!user && !!selection && onQuote && <QuoteReply toolbarVisible actions={[{key:'quote',label:'引用并追问',icon:'quote'}]} onAction={()=>{onQuote(selection);setSelection('');window.getSelection()?.removeAllRanges();}}/>}
    {!user && <MessageActions text={content} durationMs={message.durationMs} createdAt={message.createdAt}/>}
  </article></MessagePrimitive.Root>;
}
export const Composer = forwardRef(function Composer({value, onChange, onPaste, onAttach, onImageSend, hasImages=false, disabled=false}, ref) {
  return <ComposerPrimitive.Root className="cw-composer aui-composer" data-slot="aui-composer">
    <label className="cw-sr-only" htmlFor="cw-message">输入消息</label>
    <ComposerPrimitive.Input id="cw-message" ref={ref} value={value} onChange={onChange} onPaste={onPaste} onKeyDown={event=>{if(hasImages&&!value.trim()&&event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();if(!disabled)onImageSend?.();}}} placeholder="输入消息…"
      rows={1} maxRows={7} cancelOnEscape={false} addAttachmentOnPaste={false} enterKeyHint="send"/>
    <div className="aui-composer-toolbar">{onAttach&&<button className="cw-attach" type="button" aria-label="添加图片" disabled={disabled} onClick={onAttach}>＋</button>}{hasImages?<button type="button" className="cw-send aui-composer-send" aria-label="发送消息" disabled={disabled} onClick={onImageSend}><ArrowUp size={20}/></button>:<ComposerPrimitive.Send className="cw-send aui-composer-send" aria-label="发送消息" title="发送消息"><ArrowUp size={20}/></ComposerPrimitive.Send>}</div>
  </ComposerPrimitive.Root>;
});
