import React, {useEffect, useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Copy, Check, LoaderCircle} from 'lucide-react';

export function formatDuration(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分 ${seconds % 60}秒`;
}

export function MessageBody({message, text, children}) {
  const [copyState, setCopyState] = useState('default');
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const content = [text, message.continuation].filter(Boolean).join('\n\n');
  if (message.role === 'user') return <p>{content}</p>;
  const duration = formatDuration(message.durationMs);
  const date = message.createdAt ? new Date(message.createdAt) : null;
  const validDate = date && Number.isFinite(date.getTime());
  const copy = async () => {
    if (!content || copyState === 'loading') return;
    clearTimeout(resetTimer.current);
    setCopyState('loading');
    try {
      await navigator.clipboard.writeText(content);
      setCopyState('success');
      resetTimer.current = setTimeout(() => setCopyState('default'), 2200);
    } catch { setCopyState('error'); }
  };
  return <>
    <div className="cw-reply-heading">{validDate && <time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>{date.toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time>}{duration && <span>用时 {duration}</span>}</div>
    <div className="cw-reply-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({children, href}) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({alt}) => <span>{alt}</span>,
      table: ({children}) => <div className="cw-reply-table"><table>{children}</table></div>,
    }}>{content}</ReactMarkdown></div>
    {children}
    <footer className="cw-reply-tools">
      <button type="button" className="cw-reply-copy" data-state={copyState} onClick={copy} disabled={!content || copyState==='loading'} aria-label={copyState==='success'?'已复制回答':'复制回答'} title={copyState==='success'?'已复制':'复制回答'}>
        {copyState==='success'?<Check size={16}/>:copyState==='loading'?<LoaderCircle size={16}/>:<Copy size={16}/>}
      </button>

      <span role="status" className={copyState==='error'?'cw-copy-error':'cw-sr-only'}>{copyState==='error'?'复制失败，请选择文字后复制。':copyState==='success'?'已复制回答':''}</span>
    </footer>
  </>;
}
