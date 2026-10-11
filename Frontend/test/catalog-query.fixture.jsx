import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GlobalDataCatalog} from '../src/global-data-catalog.jsx';
import {GlobalFileCatalog} from '../src/global-file-catalog.jsx';
import {setAccountStorageOwner} from '../src/account-storage.js';
import '../src/base.css';
import '../src/case-workbench.css';
import '../src/defense-themes.css';
import '../src/liquid-home.css';

setAccountStorageOwner('catalog-synthetic-fixture');
document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'liquid';
function Fixture() {
  const [page,setPage]=useState(new URLSearchParams(location.search).get('page')||'data');
  const related=(target,project,ids,batch,type)=>{const url=new URL(location.href);url.searchParams.set('catalogCases',ids.join(','));if(batch){url.searchParams.set('catalogBatch',batch);if(type)url.searchParams.set('catalogType',type);else url.searchParams.delete('catalogType');}else{url.searchParams.delete('catalogBatch');url.searchParams.delete('catalogType');}if(project)url.searchParams.set('catalogProject',project);else url.searchParams.delete('catalogProject');url.searchParams.set('dataTable','applications');url.searchParams.set('page',target);history.replaceState(null,'',url);setPage(target);};
  return <div className="cw-shell cw-catalog-view"><main className="cw-main"><div className="gc-topbar"><span>合成搜索验收</span><button onClick={()=>setPage('data')}>数据页</button><button onClick={()=>setPage('files')}>文件页</button></div>{page==='data'?<GlobalDataCatalog onOpenFiles={(project,ids,batch,type)=>related('files',project,ids,batch,type)}/>:<GlobalFileCatalog onOpenData={(project,ids,batch,type)=>related('data',project,ids,batch,type)}/>}</main></div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
