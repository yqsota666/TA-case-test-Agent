import React, {useEffect,useRef,useState} from 'react';
import {CanvasSplitDocument,CanvasSplitHeader,CanvasSplitBody} from './canvas-split.jsx';
import {ArrowLeftRight,ClipboardCheck,FileText,Table2} from '../ui-icons.jsx';
import './artifact-detail.css';
export function DetailPanel({title,children,onClose,kind='plan',closeLabel='关闭方案详情'}) {
  const ref=useRef(null);
  const close=useRef(onClose);close.current=onClose;
  const [narrow,setNarrow]=useState(()=>matchMedia('(max-width:1100px)').matches);
  useEffect(()=>{
    const previous=document.activeElement;
    const panel=ref.current;
    const siblings=Array.from(panel.closest('.cw-shell').querySelectorAll('.cw-main,.cw-sidebar,.cw-skip'));
    const original=siblings.map(element=>element.inert);
    const query=matchMedia('(max-width:1100px)');
    const update=()=>{
      setNarrow(query.matches);siblings.forEach((element,i)=>{element.inert=query.matches||original[i];});
      if(query.matches&&!panel.contains(document.activeElement)&&!document.querySelector('dialog[open]'))panel.focus();
    };
    const keys=event=>{
      if(document.querySelector('dialog[open]'))return;
      if(event.key==='Escape'&&(query.matches||panel.contains(event.target))){event.preventDefault();event.stopPropagation();close.current();return;}
      if(!query.matches||event.key!=='Tab')return;
      const items=Array.from(panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[contenteditable="true"],[tabindex]:not([tabindex="-1"])')).filter(el=>el.tabIndex>=0&&!el.closest('[inert]')&&el.getClientRects().length);
      const first=items[0],last=items.at(-1),active=document.activeElement;
      if(!first){event.preventDefault();panel.focus();}
      else if(event.shiftKey&&(active===first||active===panel||!panel.contains(active))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(active===last||active===panel||!panel.contains(active))){event.preventDefault();first.focus();}
    };
    update();panel.focus();query.addEventListener('change',update);document.addEventListener('keydown',keys,true);
    return()=>{query.removeEventListener('change',update);document.removeEventListener('keydown',keys,true);siblings.forEach((element,i)=>{element.inert=original[i];});if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus();};
  },[]);
  return <CanvasSplitDocument className={`aui-detail cw-artifact-detail cw-artifact-detail--${kind}`} role={narrow?'dialog':'region'} aria-modal={narrow||undefined} aria-label={title} tabIndex={-1} ref={ref}>
    <CanvasSplitHeader title={title} icon={{plan:FileText,data:Table2,files:ArrowLeftRight,result:ClipboardCheck}[kind]??FileText} closeLabel={closeLabel} onClose={onClose}/><CanvasSplitBody>{children}</CanvasSplitBody>
  </CanvasSplitDocument>;
}
