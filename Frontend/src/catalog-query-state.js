import {accountStorageOwner} from './account-storage.js';

export const emptyFilters=()=>({combinator:'and',rules:[]});
export function catalogStorageKey(resource) {return `case-agent-catalog:${accountStorageOwner()}:${resource}`;}
export function readCatalogState(storage,key,fallback) {
  try {const value=JSON.parse(storage.getItem(key));return value&&typeof value==='object'&&!Array.isArray(value)?value:fallback;}catch{return fallback;}
}
export function writeCatalogState(storage,key,value) {try{storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
export function validCatalogFilters(node,depth=0) {
  if(!node||typeof node!=='object'||Array.isArray(node)||depth>3)return false;
  if(Object.hasOwn(node,'rules'))return ['and','or'].includes(node.combinator)&&Array.isArray(node.rules)&&node.rules.length<=30&&node.rules.every(rule=>validCatalogFilters(rule,depth+1));
  return typeof node.field==='string'&&typeof node.operator==='string'&&(node.value===undefined||typeof node.value==='string'||typeof node.value==='number'||Array.isArray(node.value)&&node.value.every(value=>['string','number'].includes(typeof value)));
}
export function initialCatalogQuery(resource,storage=sessionStorage) {
  const fallback={source:'draft',q:'',filters:emptyFilters(),sort:[]};
  const stored=readCatalogState(storage,catalogStorageKey(resource),fallback);
  const query={...fallback,...stored};
  if(!['draft','formal'].includes(query.source))query.source='draft';
  if(typeof query.q!=='string')query.q='';
  if(!query.filters?.rules||!validCatalogFilters(query.filters))query.filters=emptyFilters();
  if(!Array.isArray(query.sort))query.sort=[];
  const params=new URLSearchParams(location.search),ids=params.get('catalogCases')?.split(',').filter(Boolean);
  if(ids?.length)query.filters={combinator:'and',rules:[{field:'caseId',operator:'in',value:ids}]};
  if(params.get('catalogProject'))query.filters={combinator:'and',rules:[...query.filters.rules,{field:'chatId',operator:'eq',value:params.get('catalogProject')}]};
  if(params.get('catalogBatch'))query.filters={combinator:'and',rules:[...query.filters.rules,{field:'batchId',operator:'eq',value:params.get('catalogBatch')},...(params.get('catalogType')?[{field:resource==='files'?'fileType':'file_type',operator:'eq',value:params.get('catalogType')}]:[])]};
  return query;
}
export function catalogParams(query,offset=0) {
  return new URLSearchParams({source:query.source,q:query.q,filters:JSON.stringify(query.filters),sort:JSON.stringify(query.sort),offset:String(offset),limit:'100',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
}
export function removeCatalogScope() {
  const url=new URL(location.href);for(const key of ['catalogCases','catalogProject','catalogBatch','catalogType'])url.searchParams.delete(key);history.replaceState(null,'',url);
}
