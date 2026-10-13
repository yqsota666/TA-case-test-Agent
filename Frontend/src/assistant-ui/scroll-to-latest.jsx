import {useEffect,useState} from 'react';
import {ArrowUp} from '../ui-icons.jsx';

export function ScrollToLatest({viewportRef,active,caseKey}) {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    setVisible(false);
    const viewport=viewportRef.current;
    if(!active||!viewport)return;
    let frame=0;
    const measure=()=>{
      frame=0;
      const remaining=Math.max(0,viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop);
      // Different entry/exit distances keep small layout changes from flashing the button.
      setVisible(previous=>remaining>(previous?24:64));
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);
    observer.observe(viewport);
    if(viewport.firstElementChild)observer.observe(viewport.firstElementChild);
    viewport.addEventListener('scroll',schedule,{passive:true});
    schedule();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();viewport.removeEventListener('scroll',schedule);};
  },[viewportRef,active,caseKey]);
  if(!active||!visible)return null;
  return <button type="button" className="cw-scroll-bottom" aria-label="回到最新消息" title="回到最新消息" onClick={event=>{
    const viewport=viewportRef.current;
    if(!viewport)return;
    viewport.scrollTo({top:viewport.scrollHeight,behavior:'instant'});
    setVisible(false);
    if(event.detail===0)viewport.focus({preventScroll:true});
  }}><ArrowUp size={18}/></button>;
}
