import React from 'react';
export function DetailTabs({id,label,items,value,onChange}) {
  return <div className="cw-detail-tabs" role="tablist" aria-label={label}>{items.map(([key,title],index)=><button type="button" key={key} id={`${id}-tab-${key}`} role="tab" aria-selected={value===key} aria-controls={`${id}-panel-${key}`} tabIndex={value===key?0:-1} onClick={()=>onChange(key)} onKeyDown={event=>{
    const next=event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null;
    if(next===null)return;event.preventDefault();onChange(items[next][0]);event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
  }}>{title}</button>)}</div>;
}
export function DetailTabPanel({id,value,tab,children,className=''}) {
  return <section id={`${id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} hidden={value!==tab} tabIndex={0} className={`cw-detail-tabpanel ${className}`}>{children}</section>;
}
