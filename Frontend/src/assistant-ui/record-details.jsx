import React from 'react';
export function RecordDetails({items,editLabel,onEdit}) {
  return <div className="cw-record-details">{onEdit&&<button type="button" className="cw-row-edit" aria-label={editLabel} onClick={onEdit}>修改</button>}<dl>{items.map(([label,value],index)=><div key={index}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}</dl></div>;
}
