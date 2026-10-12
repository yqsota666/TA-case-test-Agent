import React,{useState} from 'react';
// Adapted from OpenStatus DataTableFilterCheckbox (MIT, openstatus.LICENSE).
// The catalog owns server filtering; no TanStack table provider is required here.
export function CatalogFacetOptions({label,options,value,onChange}) {
  const [search,setSearch]=useState('');
  const visible=options.filter(option=>`${option.label||option.value} ${option.value}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="gc-facet-options">
    <input aria-label={`搜索${label}候选`} placeholder={`搜索${label}`} value={search} onChange={event=>setSearch(event.target.value)}/>
    <div className="gc-facet-list">
      {visible.map(option=><label key={option.value}>
        <input type="checkbox" checked={value.includes(option.value)} onChange={event=>onChange(event.target.checked?[...value,option.value]:value.filter(item=>item!==option.value))}/>
        <span>{option.label||option.value}</span><small>{option.count??''}</small>
      </label>)}
      {!visible.length&&<p>没有匹配的候选项</p>}
    </div>
  </div>;
}
