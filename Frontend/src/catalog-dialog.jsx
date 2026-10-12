import React,{useEffect,useId,useRef} from 'react';
import {X} from './ui-icons.jsx';
export function CatalogDialog({title,onClose,children,wide=false}) {
  const ref=useRef(null),titleId=useId();
  useEffect(()=>{
    const dialog=ref.current,previous=document.activeElement;
    dialog.showModal();
    return()=>{dialog.close();if(previous?.isConnected)previous.focus();};
  },[]);
  return <dialog ref={ref} className={`gc-filter-dialog${wide?' is-wide':''}`} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onClose();}}}>
    <header><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭筛选面板" onClick={onClose}><X size={18}/></button></header>
    {children}
  </dialog>;
}
