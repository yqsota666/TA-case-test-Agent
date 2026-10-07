const icons={plan:'<path d="M8 3h8l4 4v14H4V3h4Z"/><path d="M14 3v5h6M8 12h8M8 16h6"/>',expected:'<path d="M9 4h6M9 3h6v4H9zM8 5H5v17h14V5h-3M8 12l2 2 5-5M8 18h8"/>',files:'<path d="M3 6h6l2 2h10v12H3zM8 13l4 4 4-4M12 10v7"/>',flow:'<circle cx="5" cy="5" r="3"/><circle cx="19" cy="12" r="3"/><circle cx="5" cy="19" r="3"/><path d="M8 5h4v7h4M8 19h4v-7"/>',upload:'<path d="M12 16V3M7 8l5-5 5 5M3 16v5h18v-5"/>',check:'<path d="m5 12 4 4L19 6"/>'};
const svg=(type,size=22)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[type]||icons.plan}</svg>`;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human=value=>escape(String(value??'').replace(/CONFIRMED（成功确认）/g,'成功').replace(/CONFIRMED/g,'成功'));
const labels={plan:['测试方案','查看条件与准备数据'],expected:['预期结果','查看各情况的预期'],files:['文件交换','查看申请文件与 TA 回传'],flow:['流程进度','查看完整流程']};
const sources={paper:['借鉴 Cursor 的“回答后进入审阅”方式：卡片只做入口，详情突出差异与用户操作。','https://cursor.com/learn/reviewing-testing'],graphite:['借鉴 Factory 的交付物工作区与 Devin 的 Progress：内容独立承载，状态与细节分层。','https://factory.com/product/desktop'],pearl:['借鉴 Replit 的计划审阅与 Cascade 的折叠进度：轻量入口、清楚分组与柔和层次。','https://docs.replit.com/features/agent/plan-mode']};
const card=(type,state='')=>`<button class="artifact-card ${state}" data-kind="${type}" ${state==='is-disabled'?'disabled':state==='is-loading'?'aria-busy="true" aria-disabled="true"':''}><span class="icon">${state==='is-loading'?'<span class="spinner" aria-hidden="true"></span>':svg(state==='is-success'?'check':type)}</span><span><strong>${labels[type][0]}</strong><span class="card-description">${labels[type][1]}</span></span><span class="arrow" aria-hidden="true">›</span></button>`;
const data=await fetch('/dialog-studies-fixture.json').then(r=>{if(!r.ok)throw new Error('无法加载预览内容，请刷新重试');return r.json()}).catch(e=>{document.querySelector('#objective').textContent=e.message;return {scenarios:[],data:{},steps:[]}});
const previewData=structuredClone(data);
const dialog=document.querySelector('#detail'),body=document.querySelector('#dialog-body'),editor=document.querySelector('#row-editor');let kind='plan',selectedPane='tests',selectedScenario=0,selectedTable='customers',trigger=null,editContext=null,previousOverflow='';
function fixture(){const copy=structuredClone(previewData),mode=document.querySelector('#fixture').value;if(mode==='one')copy.scenarios=copy.scenarios.slice(0,1);if(mode==='two')copy.scenarios=copy.scenarios.slice(0,2);if(mode==='empty'){copy.scenarios=[];copy.data={};copy.objective='暂无方案内容。';}if(mode==='long')copy.scenarios=copy.scenarios.map(x=>({...x,evidence:Array(5).fill(x.evidence).join('\n')}));copy.nonComparison=mode==='non-comparison';return copy;}
function expectedText(text){return `<ul>${String(text||'').split(/[；;\n]/).filter(Boolean).map(s=>`<li>${human(s)}</li>`).join('')}</ul>`;}
function scenarios(p,onlyExpected=false){
 if(!p.scenarios.length)return '<div class="empty">暂无测试项。</div>';
 const condition=s=>`<details class="review-detail"><summary>条件与操作</summary><p>${human(s.setup)}</p><p>${human(s.action)}</p></details><details class="review-detail"><summary>核对依据</summary><p>${human(s.evidence)}</p></details>`;
 const skin=document.body.dataset.skin;
 if(skin==='graphite'){
  selectedScenario=Math.min(selectedScenario,p.scenarios.length-1);const s=p.scenarios[selectedScenario];
  return `<div class="inspection"><div class="item-list" role="group" aria-label="测试项">${p.scenarios.map((item,i)=>`<button data-scenario="${i}" aria-pressed="${i===selectedScenario}">${svg('expected',16)}<span>${human(item.title)}</span><span aria-hidden="true">›</span></button>`).join('')}</div><article class="inspector"><h3>${human(s.title)}</h3><section><h4>预期结果</h4>${expectedText(s.expected)}</section>${onlyExpected?'':`<section><h4>条件与操作</h4><p>${human(s.setup)}</p><p>${human(s.action)}</p></section>`}<details class="review-detail"><summary>核对依据</summary><p>${human(s.evidence)}</p></details></article></div>`;
 }
 if(skin==='pearl')return `<div class="glass-items">${p.scenarios.map((s,i)=>`<details class="glass-item" ${i===0?'open':''}><summary><span class="glass-mark">${svg('expected',20)}</span><span><strong>${human(s.title)}</strong><small>${human(String(s.expected).split(/[；;\n]/)[0])}</small></span><span class="glass-chevron" aria-hidden="true">+</span></summary><div class="glass-item-body">${expectedText(s.expected)}${onlyExpected?'':condition(s)}</div></details>`).join('')}</div>`;
 if(p.nonComparison)return p.scenarios.map(s=>`<article class="document-item"><h3>${human(s.title)}</h3>${expectedText(s.expected)}${onlyExpected?'':condition(s)}</article>`).join('');
 return `<div class="table-wrap comparison" tabindex="0" role="region" aria-label="测试项与预期对照"><table><thead><tr><th>情况</th><th>预期结果</th>${onlyExpected?'':'<th>条件与操作</th>'}</tr></thead><tbody>${p.scenarios.map(s=>`<tr><th scope="row">${human(s.title)}</th><td>${expectedText(s.expected)}</td>${onlyExpected?'':`<td>${condition(s)}</td>`}</tr>`).join('')}</tbody></table></div>`;
}
let flowObserver;
function connectFlow(){
 const flow=body.querySelector('.workflow');if(!flow||!dialog.open)return;
 const columns=getComputedStyle(flow).gridTemplateColumns.split(' ').filter(Boolean).length;
 const nodes=[...flow.querySelectorAll('.node')];
 nodes.forEach((node,i)=>{const row=Math.floor(i/columns),position=i%columns;node.style.gridRow=row+1;node.style.gridColumn=row%2?columns-position:position+1;});
 const bounds=flow.getBoundingClientRect();if(!bounds.width)return;
 const centers=nodes.map(node=>{const r=node.querySelector('.circle').getBoundingClientRect();return {x:r.left-bounds.left+r.width/2,y:r.top-bounds.top+r.height/2,r:r.width/2};});
 const current=nodes.findIndex(node=>node.classList.contains('current'));
 const paths=centers.slice(0,-1).map((a,i)=>{const b=centers[i+1];let d;
  if(Math.abs(a.y-b.y)<2){const direction=b.x>a.x?1:-1;d=`M ${a.x+direction*(a.r+5)} ${a.y} L ${b.x-direction*(b.r+5)} ${b.y}`;}
  else {const side=Math.floor(i/columns)%2?-1:1,edge=a.x+side*(a.r+24),start=a.x+side*(a.r+5),end=b.x+side*(b.r+5);d=`M ${start} ${a.y} L ${edge-side*8} ${a.y} Q ${edge} ${a.y} ${edge} ${a.y+8} L ${edge} ${b.y-8} Q ${edge} ${b.y} ${edge-side*8} ${b.y} L ${end} ${b.y}`;}
  return `<path class="${current>=0&&i+1<=current?'is-complete':'is-future'}" d="${d}"/>`;
 }).join('');
 let lines=flow.querySelector('.flow-connectors');if(!lines){lines=document.createElementNS('http://www.w3.org/2000/svg','svg');lines.setAttribute('class','flow-connectors');lines.setAttribute('aria-hidden','true');flow.prepend(lines);}
 lines.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);lines.innerHTML=paths;
}
function watchFlow(){flowObserver?.disconnect();const flow=body.querySelector('.workflow');if(!flow)return;flowObserver=new ResizeObserver(()=>requestAnimationFrame(connectFlow));flowObserver.observe(flow);requestAnimationFrame(connectFlow);}
const tables={customers:{title:'客户',columns:[['name','名称'],['investorType','客户类型'],['simulatedBalance','模拟余额']]},accounts:{title:'账户',columns:[['customerIndex','所属客户'],['branchCode','开户网点']]},funds:{title:'基金',columns:[['fundCode','基金代码'],['fundName','名称'],['shareClass','份额类别'],['nav','单位净值']]},holdings:{title:'持仓',columns:[['accountIndex','所属账户'],['fundIndex','基金'],['totalVolume','初始份额']]}};
const fieldOptions={investorType:[['1','个人'],['0','机构']]};
function tableValue(row,key,p){if(fieldOptions[key])return fieldOptions[key].find(([value])=>value===String(row[key]))?.[1]??row[key]??'—';if(key==='customerIndex')return p.data.customers?.[row[key]]?.name||'—';if(key==='fundIndex')return p.data.funds?.[row[key]]?.fundName||'—';if(key==='accountIndex')return p.data.customers?.[p.data.accounts?.[row[key]]?.customerIndex]?.name||'—';return row[key]??'—';}
function prepared(p){const table=tables[selectedTable],rows=p.data[selectedTable]||[];return `<section><div class="data-title"><h3>准备数据</h3></div><div class="data-tabs" role="group" aria-label="准备数据表">${Object.entries(tables).map(([key,t])=>`<button data-table="${key}" aria-pressed="${selectedTable===key}">${t.title}</button>`).join('')}</div>${rows.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="${table.title}准备数据"><table><thead><tr>${table.columns.map(([,label])=>`<th>${label}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map((r,i)=>`<tr>${table.columns.map(([key])=>`<td>${escape(tableValue(r,key,p))}</td>`).join('')}<td><button class="row-edit" data-edit="${i}" aria-label="修改${table.title}第${i+1}行">修改</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">无需准备初始'+table.title+'记录。</div>'}</section>`;}
const date=s=>s?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:'';
function exchange(p,compact=false){return `<section id="exchange"><h3>${compact?'文件交换安排':'申请文件'}</h3>${p.steps.filter(s=>compact||s.direction==='SEND').map(s=>`<div class="file-row"><span class="file-type">${escape(s.type)}</span><div><strong>${s.type==='01'?'开户申请':s.type==='03'?'交易申请':'TA 回传'}</strong><span class="date">${escape(date(s.date))}</span></div>${compact?'':`<button disabled title="视觉预览没有原始文件">下载</button>`}</div>`).join('')||'<div class="empty">暂无申请文件。</div>'}</section>${compact?'':`<section><h3>TA 返回文件</h3><div class="dropzone">${svg('upload',30)}<span>拖入 TA 返回文件，或点击选择</span><small>视觉预览 · 不接收或解析文件</small></div></section>`}`;}
function workflow(p){return `<section><div class="workflow" aria-label="只读流程快照">${(p.workflow?.labels||[]).map((label,i)=>`<div class="node ${i<p.workflow.labels.indexOf(p.workflow.current)?'done':label===p.workflow.current?'current':''}"><div class="circle">${svg(i<p.workflow.labels.indexOf(p.workflow.current)?'check':label===p.workflow.current?'expected':'plan',22)}</div><span>${escape(label)}</span></div>`).join('')}</div><p class="preview-notice">流程状态来自本轮联调记录。此处是视觉预览，不推进任何节点。</p></section>`;}
function render(){
 flowObserver?.disconnect();const p=fixture(),skin=document.body.dataset.skin,nav=document.querySelector('#detail-navigation');
 const panes=[['tests','测试项','plan'],['data','准备数据','expected'],['exchange','文件安排','files']];
 if(kind==='plan'){
  nav.hidden=false;
  nav.innerHTML=panes.map(([key,title,icon])=>`<button data-pane="${key}" aria-pressed="${selectedPane===key}">${svg(icon,17)}<span>${title}</span></button>`).join('');
  const tests=`<section id="tests"><h3>测试项</h3>${scenarios(p)}</section>`;
  const preparedHtml=prepared(p).replace('<section>','<section id="data">');
  if(skin==='graphite')body.innerHTML=`<div class="workspace-context"><p>${human(p.objective)}</p></div>${selectedPane==='data'?preparedHtml:selectedPane==='exchange'?exchange(p,true):tests}`;
  else if(skin==='pearl')body.innerHTML=`<p class="objective">${human(p.objective)}</p>${selectedPane==='data'?preparedHtml:selectedPane==='exchange'?exchange(p,true):tests}`;
  else body.innerHTML=`<p class="objective">${human(p.objective)}</p>${tests}${preparedHtml}${exchange(p,true)}`;
 }else{
  nav.hidden=true;nav.innerHTML='';
  body.innerHTML=kind==='expected'?`<section><h3>预期结果</h3>${scenarios(p,true)}</section>`:kind==='files'?exchange(p):workflow(p);
 }
 nav.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>{
  selectedPane=b.dataset.pane;
  if(skin==='paper'){nav.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));body.querySelector('#'+selectedPane)?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
  else{render();body.scrollTop=0;nav.querySelector(`[data-pane="${selectedPane}"]`)?.focus();}
 });
 watchFlow();body.querySelectorAll('[data-table]').forEach(b=>b.onclick=()=>{const scroll=body.scrollTop;selectedTable=b.dataset.table;render();body.scrollTop=scroll;body.querySelector(`[data-table="${selectedTable}"]`)?.focus({preventScroll:true});});
 body.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>{selectedScenario=Number(b.dataset.scenario);render();body.querySelector(`[data-scenario="${selectedScenario}"]`)?.focus({preventScroll:true});});
 body.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(Number(b.dataset.edit),b));
}
function openEditor(index,element){
 const p=fixture(),table=tables[selectedTable],row=p.data[selectedTable][index];if(!row)return;
 editContext={table:selectedTable,index,trigger:element,scrollTop:body.scrollTop};
 document.querySelector('#edit-title').textContent='修改'+table.title;
 const related={customerIndex:'customers',accountIndex:'accounts',fundIndex:'funds'};
 document.querySelector('#edit-form').innerHTML=table.columns.map(([key,label])=>{
  const group=related[key],rows=group?p.data[group]:null;
  const options=fieldOptions[key]??(rows?.length?rows.map((_,i)=>[i,tableValue({[key]:i},key,p)]):null);
  const control=options?`<select id="edit-${escape(key)}" name="${escape(key)}">${options.map(([value,text])=>`<option value="${escape(value)}" ${String(row[key])===String(value)?'selected':''}>${escape(text)}</option>`).join('')}</select>`:`<input id="edit-${escape(key)}" name="${escape(key)}" type="text" value="${escape(row[key]??'')}" autocomplete="off"/>`;
  return `<label for="edit-${escape(key)}">${escape(label)}${control}</label>`;
 }).join('');
 editor.showModal();document.querySelector('#edit-form').querySelector('input,select')?.focus();
}
function closeEditor(saved=false,returnFocus=true){
 const context=editContext;if(!context)return;editor.close();editContext=null;
 if(saved){render();body.scrollTop=context.scrollTop;}
 if(returnFocus&&dialog.open){const target=saved?body.querySelector(`[data-edit="${context.index}"]`):context.trigger;target?.focus({preventScroll:true});}
}
document.querySelector('#edit-form').onsubmit=event=>{
 event.preventDefault();if(!editContext)return;
 const form=new FormData(event.currentTarget),row=previewData.data[editContext.table][editContext.index];
 for(const [key]of tables[editContext.table].columns){const value=String(form.get(key)??'');row[key]=['customerIndex','accountIndex','fundIndex'].includes(key)?Number(value):typeof row[key]==='number'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value;}
 closeEditor(true);
};
document.querySelector('#edit-close').onclick=()=>closeEditor();document.querySelector('#edit-cancel').onclick=()=>closeEditor();editor.addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
function open(type,element){kind=type;selectedPane='tests';selectedScenario=0;trigger=element;document.querySelector('#dialog-title').textContent=labels[type][0];document.querySelector('#dialog-icon').innerHTML=svg(type);render();previousOverflow=document.body.style.overflow;dialog.showModal();body.scrollTop=0;requestAnimationFrame(connectFlow);document.body.style.overflow='hidden';}
function close(){if(editor.open)closeEditor(false,false);flowObserver?.disconnect();dialog.close();document.body.style.overflow=previousOverflow;trigger?.focus();}
document.querySelector('#cards').innerHTML=Object.keys(labels).map(k=>card(k)).join('');document.querySelector('#cards').addEventListener('click',e=>{const b=e.target.closest('[data-kind]');if(b)open(b.dataset.kind,b)});document.querySelector('#close').onclick=close;document.querySelector('#dismiss').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}});document.querySelector('#fixture').onchange=()=>{document.querySelector('#objective').textContent=fixture().objective;if(dialog.open)render()};
function skin(value){if(!sources[value])value='paper';document.body.dataset.skin=value;document.querySelectorAll('nav [data-skin]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.skin===value));document.querySelector('#source-description').textContent=sources[value][0];document.querySelector('#source-link').href=sources[value][1];const u=new URL(location.href);u.searchParams.set('skin',value);history.replaceState(null,'',u);document.querySelector('#cards').innerHTML=Object.keys(labels).map(k=>card(k)).join('');if(dialog.open){selectedPane='tests';render();}}
document.querySelectorAll('nav [data-skin]').forEach(b=>b.onclick=()=>skin(b.dataset.skin));skin(new URLSearchParams(location.search).get('skin'));document.querySelector('#objective').textContent=data.objective||'';
const states=[['默认',''],['悬停','is-hover'],['键盘聚焦','is-focus'],['按下','is-active'],['禁用','is-disabled'],['加载','is-loading'],['错误','is-error'],['完成','is-success']];document.querySelector('#state-grid').innerHTML=states.map(([label,state])=>`<div class="state-cell"><small>${label}</small>${card('plan',state)}<p class="error-slot">${state==='is-error'?'无法加载内容，请刷新重试。':''}</p></div>`).join('');document.querySelector('#state-grid').addEventListener('click',e=>{const b=e.target.closest('[data-kind]');if(b&&!b.classList.contains('is-loading'))open('plan',b)});document.querySelector('#show-states').onclick=()=>{document.querySelector('#states').hidden=!document.querySelector('#states').hidden};
