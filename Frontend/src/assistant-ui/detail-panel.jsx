import React, {useEffect,useRef,useState} from 'react';
import {CanvasSplitDocument,CanvasSplitHeader,CanvasSplitBody} from './canvas-split.jsx';
export function DetailPanel({title,children,onClose}) {
  const ref=useRef(null);
  const [narrow,setNarrow]=useState(()=>matchMedia('(max-width:1100px)').matches);
  useEffect(()=>{
    const previous=document.activeElement;
    const siblings=Array.from(ref.current.closest('.cw-shell').querySelectorAll('.cw-main,.cw-sidebar'));
    const original=siblings.map(element=>element.inert);
    const query=matchMedia('(max-width:1100px)');
    const update=()=>{setNarrow(query.matches);siblings.forEach((element,i)=>{element.inert=query.matches||original[i];});};
    update();ref.current.focus();query.addEventListener('change',update);
    return()=>{query.removeEventListener('change',update);siblings.forEach((element,i)=>{element.inert=original[i];});if(previous?.isConnected)previous.focus();};
  },[]);
  return <CanvasSplitDocument className="aui-detail" role={narrow?'dialog':'region'} aria-modal={narrow||undefined} aria-label={title} tabIndex={-1} ref={ref}
    onKeyDown={event=>{if(event.key==='Escape'&&!event.target.closest('dialog')&&!document.querySelector('dialog[open]')){event.preventDefault();onClose();}}}>
    <CanvasSplitHeader title={title} onClose={onClose}/><CanvasSplitBody>{children}</CanvasSplitBody>
  </CanvasSplitDocument>;
}
