import React,{useEffect,useRef} from 'react';

export function NameButton({onClick,onRename,onKeyDown,...props}) {
  const clickTimer=useRef(null);
  useEffect(()=>()=>clearTimeout(clickTimer.current),[]);
  const cancelClick=()=>clearTimeout(clickTimer.current);
  return <button {...props} onClick={event=>{
    if(!onRename||event.detail===0){onClick?.(event);return;}
    cancelClick();
    if(event.detail===1)clickTimer.current=setTimeout(()=>onClick?.(),300);
  }} onDoubleClick={event=>{if(onRename){cancelClick();event.preventDefault();onRename();}}}
    onKeyDown={event=>{
      if(onRename&&event.key==='F2'){cancelClick();event.preventDefault();onRename();}
      else onKeyDown?.(event);
    }}/>;
}
