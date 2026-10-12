import React from 'react';
import {createRoot} from 'react-dom/client';
import {CaseWorkbench} from '../src/case-workbench.jsx';
import {ThemeProvider, initialTheme} from '../src/theme-picker.jsx';
import {setAccountStorageOwner} from '../src/account-storage.js';
import '../src/base.css';
import '../src/defense-themes.css';
import '../src/message-body.css';
import '../src/spectral-components.css';
import '../src/compact-workbench.css';
import '../src/liquid-home.css';

const params = new URLSearchParams(location.search);
setAccountStorageOwner('assistant-ui-fixture');
const mode = params.get('mode') || 'normal';
params.set('chatId', 'fixture-project');
params.set('caseId', params.get('caseId') || 'comparison');
history.replaceState(null, '', `${location.pathname}?${params}`);
const table = count => `| 情况 | 输入字段 | 预期 |\n| --- | --- | --- |\n${Array.from({length: count}, (_, i) => `| 情况 ${i + 1} | ${i % 2 ? '状态' : '编码'} | 根据已提供规则核对 |`).join('\n')}`;
const longAnswer = `## 字段对比\n\n${table(2)}\n\n### 增加对比情况\n\n${table(4)}\n\n### 需要补充的信息\n\n预期业务规则尚未提供，保留为待补充，不生成判断。\n\n${Array.from({length: 15}, (_, i) => `说明 ${i + 1}：${'这是用于验证长回答排版与滚动的合成说明。'.repeat(8)}`).join('\n\n')}\n\n~~~text\n${'UNBROKEN_TOKEN_'.repeat(50)}\n~~~\n\n<script>这段内容应显示为文本或被忽略，不执行。</script>\n\n[组件官方文档](https://www.assistant-ui.com/)`;
const histories = {
  empty: [],
  comparison: [{role: 'user', content: '合成验收：比较不同数量与不同字段。'}, {role: 'assistant', content: longAnswer}],
  readonly: [{role: 'user', content: '合成验收：只读取当前状态，不构造数据。'}, {role: 'assistant', content: '当前状态尚未提供，请补充需要读取的记录标识。\n\n这是独立读取任务，无需对比表格。'}],
};
const cases = Object.keys(histories).map(public_id => ({public_id, title: public_id === 'comparison' ? '字段对比验收' : public_id === 'empty' ? '空白对话验收' : '只读任务验收', status: 'DISCUSSING'}));
const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
let pending = mode === 'recovered' ? {caseId:'readonly',userInput:'合成验收：恢复上次未完成的输入。',kind:'DISCUSS',turnNumber:1,images:[]} : null;
const fixturePlan={status:'PENDING_CONFIRMATION',versionNumber:1,sourceTurnNumber:1,proposal:{objective:'合成验收：字段变化及独立读取',preconditions:['以用户提供的字段约束为依据，业务预期尚待核对。'],openQuestions:[],scenarios:Array.from({length:Number(params.get('rows'))||4},(_,i)=>({title:`字段情况 ${i+1}`,setup:`${i%2?'状态':'编码'}变化，其余条件一致`,action:'读取并比较指定字段',expected:'按已提供规则核对。'+('长说明用于验证自动换行。'.repeat(i===1?30:0)),evidence:'合成验收规则文本，仅用于界面检查。'})),exchangePlan:{status:'NOT_REQUIRED',steps:[],openQuestions:[]}}};
let stage=mode==='plan'?'CONFIRM_PLAN_DATA':'DISCUSSION';
const exchange=params.get('exchange');
if(exchange){
  fixturePlan.proposal.contract={version:4};
  fixturePlan.proposal.exchangePlan.status=exchange==='not-required'?'NOT_REQUIRED':'READY';
  fixturePlan.status=exchange==='unconfirmed'?'PENDING_CONFIRMATION':'LOCKED';
  stage=exchange==='unconfirmed'?'CONFIRM_PLAN_DATA':'FILE_EXCHANGE';
  histories.readonly=[{role:'user',content:'合成验收：整理方案。'},{role:'assistant',kind:'PROPOSE_PLAN',content:'方案已整理。请先核对并确认。'},{role:'user',content:'下一步是什么？'},{role:'assistant',content:'请根据当前确认状态继续。'}];
}
// Every API response here is synthetic; this entry never forwards a business request.
window.fetch = async (url, options = {}) => {
  if (!String(url).startsWith('/live-api')) throw new Error('验收页不连接外部接口');
  const path = String(url).slice('/live-api'.length);
  if (path === '/chats') return response({chats: [{public_id: 'fixture-project', title: '合成组件验收', status: 'ACTIVE'}]});
  if (path === '/chats/fixture-project/cases') {
    if (options.method === 'POST') {
      const publicId = `new-fixture-${cases.length}`;
      histories[publicId] = [];
      cases.push({public_id: publicId, title: '空白新对话验收', status: 'DISCUSSING'});
      return response({publicId});
    }
    return response({cases});
  }
  const caseId = path.split('/')[4];
  const endpoint = path.split('/').slice(5).join('/');
  if (endpoint === 'discussion' && options.method === 'POST') {
    if (mode === 'failure') return response({message: '合成失败：讨论服务暂时不可用，请重试原输入。'}, 503);
    const {userInput} = JSON.parse(options.body);
    pending = {caseId, userInput};
    if (options.headers?.Accept === 'text/event-stream') return new Response('event: result\ndata: {}\n\n', {headers: {'Content-Type': 'text/event-stream'}});
    return response({});
  }
  if (endpoint === 'workflow/resume') {
    await new Promise(resolve => setTimeout(resolve, 1200));
    if (pending) histories[pending.caseId].push({role: 'user', content: pending.userInput}, {role: 'assistant', content: '合成回复：消息已收到，原输入只提交一次。'});
    pending = null;
    return response({});
  }
  if (endpoint === 'discussion') return response({turns: histories[caseId] || [], pending:pending?.caseId===caseId?pending:null});
  if(endpoint==='plan/confirm'){const body=JSON.parse(options.body);if(body.versionNumber!==fixturePlan.versionNumber)return response({message:'方案已更新'},409);if(body.section==='DATA'&&stage==='CONFIRM_PLAN_DATA')stage='CONFIRM_EXPECTATIONS';else if(body.section==='EXPECTATIONS'&&stage==='CONFIRM_EXPECTATIONS'){stage='PREPARE_DATA';fixturePlan.status='LOCKED';}else return response({message:'确认顺序不正确'},409);return response({});}
  if(endpoint==='plan')return response(mode==='plan'?fixturePlan:null);
  if(endpoint==='data')return response(exchange&&exchange!=='unconfirmed'?{status:'VALIDATED',reviewStatus:'CONFIRMED'}:{status:'NOT_STARTED',reviewStatus:'NOT_STARTED',revision:0,customers:[],accounts:[],funds:[],holdings:[]});
  if (endpoint === 'workflow') return response({stage, waiting: ['DISCUSS']});
  return response({message: '该合成验收页未提供此业务接口'}, 404);
};
const initial = initialTheme();
document.documentElement.dataset.theme = initial;
createRoot(document.getElementById('root')).render(<ThemeProvider initial={initial}><CaseWorkbench accountControl={<span>合成组件验收</span>}/></ThemeProvider>);
