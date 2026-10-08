import React, {useEffect,useRef} from 'react';
import {CanvasSplitDocument,CanvasSplitHeader,CanvasSplitBody} from './canvas-split.jsx';
export function DetailPanel({title,children,onClose}) {
  const ref=useRef(null);
  useEffect(()=>{const previous=document.activeElement;ref.current.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  return <CanvasSplitDocument className="aui-detail" role="region" aria-label={title} tabIndex={-1} ref={ref}
    onKeyDown={event=>{if(event.key==='Escape'&&!event.target.closest('dialog')&&!document.querySelector('dialog[open]')){event.preventDefault();onClose();}}}>
    <CanvasSplitHeader title={title} onClose={onClose}/><CanvasSplitBody>{children}</CanvasSplitBody>
  </CanvasSplitDocument>;
}
