import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
const base=process.env.CHAT_TEST_URL||process.env.SCROLL_TEST_URL||'http://127.0.0.1:5199';
const evidence=process.env.CHAT_TEST_EVIDENCE||'.context/chat-interaction';
mkdirSync(evidence,{recursive:true});
let page;
const errors=[];

async function open(query='caseId=readonly',viewport={width:1300,height:900}) {
  if(page)await page.close();
  page=await browser.newPage({viewport});page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/test/assistant-ui.html?theme=liquid&${query}`);
  await page.locator('h1').filter({hasText:query.includes('caseId=empty')?'空白对话验收':query.includes('caseId=comparison')?'字段对比验收':'只读任务验收'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.cw-reply-status'));
}

async function install(options={}) {
  await page.evaluate(options=>{
    const original=window.fetch;
    const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    const audit=window.chatAudit={posts:[],resumeStarted:{},resumeFinished:{},confirmStarted:false,confirmFinished:false,blockedCase:null,
      stages:options.stages||{},generatedCase:options.generatedCase,holdResume:options.holdResume||[],holdConfirm:options.holdConfirm||false,
      release:{},turns:{},pending:{},exchangeCase:options.exchangeCase,holdExchangeSnapshot:options.holdExchangeSnapshot};
    window.fetch=async(url,request={})=>{
      const path=String(url);
      if(!path.startsWith('/live-api'))throw new Error('Synthetic Chat regression must not reach external APIs');
      if(audit.exchangeCase&&path==='/live-api/exchange/channels')return response({channels:[{id:1,distributorCode:'SYN',name:'合成通道',taCode:'SYN',environment:'LOCAL'}]});
      const match=path.match(/^\/live-api\/chats\/fixture-project\/cases\/([^/]+)\/(.+)$/);
      if(!match)return original(url,request);
      const [,id,endpoint]=match;
      if(id===audit.exchangeCase){
        if(endpoint==='application-preparation')return response({files:[],revision:1,questions:[]});
        if(endpoint==='return-parsing')return response({steps:[]});
        if(endpoint==='return-confirmation')return response({batches:[],confirmations:[]});
      }
      if(endpoint==='discussion'&&request.method!=='POST'){
        if(id===audit.exchangeCase&&audit.holdExchangeSnapshot&&audit.resumeFinished[id]&&!audit.exchangeSnapshotFinished){audit.exchangeSnapshotStarted=true;await new Promise(resolve=>{audit.release.exchangeSnapshot=resolve;});audit.exchangeSnapshotFinished=true;}
        if(audit.blockedCase===id)throw new Error('合成加载失败，请重新加载');
        const old=await (await original(url,request)).json();
        return response({...old,turns:[...old.turns,...(audit.turns[id]||[])],pending:null});
      }
      if(endpoint==='discussion'&&request.method==='POST'){
        const {userInput}=JSON.parse(request.body);audit.posts.push({id,input:userInput});audit.pending[id]=userInput;
        return new Response('event: result\ndata: {}\n\n',{headers:{'Content-Type':'text/event-stream'}});
      }
      if(endpoint==='workflow/resume'){
        audit.resumeStarted[id]=true;
        if(audit.holdResume.includes(id))await new Promise(resolve=>{audit.release[id]=resolve;});
        const input=audit.pending[id];
        if(input){audit.turns[id]=[...(audit.turns[id]||[]),{role:'user',content:input},{role:'assistant',content:`合成完成：${input}`}];delete audit.pending[id];}
        audit.resumeFinished[id]=true;return response({});
      }
      if(endpoint==='workflow'&&audit.stages[id])return response(audit.stages[id]);
      if(endpoint==='data'&&audit.generatedCase===id)return response({status:'VALIDATED',reviewStatus:'PENDING_REVIEW',revision:1,customers:[],accounts:[],funds:[],holdings:[]});
      if(endpoint==='data/confirm'){
        audit.confirmStarted=true;
        const ok=audit.holdConfirm?await new Promise(resolve=>{audit.release.confirm=resolve;}):true;
        audit.confirmFinished=true;return response(ok?{}:{message:'合成确认失败'},ok?200:503);
      }
      return original(url,request);
    };
  },options);
}
const title=id=>({empty:'空白对话验收',comparison:'字段对比验收',readonly:'只读任务验收'}[id]);
async function select(id) {
  await page.getByRole('button',{name:title(id),exact:true}).click();
  await page.locator('h1').filter({hasText:title(id)}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.cw-reply-status')?.textContent.includes('连接'));
}
async function send(text) {
  await page.locator('#cw-message').fill(text);
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
}
async function current(id) {
  assert.equal(await page.evaluate(()=>new URL(location.href).searchParams.get('caseId')),id);
  assert.ok((await page.locator('h1').innerText()).includes(title(id)),'URL and rendered Case agree');
}
async function enabled() {await page.waitForFunction(()=>!document.querySelector('#cw-message').disabled);}

try {
  await open('caseId=empty');
  await page.addInitScript(()=>{
    let implementation=window.fetch;window.chatInitialBlocked=true;
    Object.defineProperty(window,'fetch',{configurable:true,get:()=>implementation,set:next=>{implementation=(url,options={})=>window.chatInitialBlocked&&String(url).endsWith('/cases/readonly/discussion')&&options.method!=='POST'?Promise.reject(new Error('合成初始加载失败')):next(url,options);}});
  });
  await page.goto(`${base}/test/assistant-ui.html?theme=liquid&caseId=readonly`);
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('#cw-message').isDisabled(),true,'initial snapshot failure cannot enable a cached different Case');
  await page.evaluate(()=>{window.chatInitialBlocked=false;});
  await page.getByRole('button',{name:/重试.*加载|重新加载|重试加载/}).click();
  await page.locator('h1').filter({hasText:title('readonly')}).waitFor();await enabled();await current('readonly');
  console.log('PASS initial load failure blocks cached Case writes and retries the URL target');

  await open();await install();
  await page.evaluate(()=>{window.chatAudit.blockedCase='empty';});
  await page.getByRole('button',{name:title('empty'),exact:true}).click();
  await page.getByRole('alert').filter({hasText:/无法打开所选 Case|合成加载失败/}).waitFor();
  assert.equal(await page.locator('#cw-message').isDisabled(),true,'navigation failure blocks business writes');
  assert.equal(await page.evaluate(()=>window.chatAudit.posts.length),0);
  await page.evaluate(()=>{window.chatAudit.blockedCase=null;});
  await page.getByRole('button',{name:/重试.*加载|重新加载|重试加载/}).click();
  await page.locator('h1').filter({hasText:title('empty')}).waitFor();await enabled();await current('empty');
  await send('合成导航恢复后的输入');await page.waitForFunction(()=>window.chatAudit.posts.length===1);
  assert.equal(await page.evaluate(()=>window.chatAudit.posts[0].id),'empty','recovered send targets the requested Case');
  console.log('PASS navigation error blocks writes; retry loads the intended Case before sending');

  for(const success of [true,false]) {
    await open('mode=plan&caseId=comparison');
    await install({generatedCase:'comparison',holdConfirm:true,stages:{comparison:{stage:'CONFIRM_DRAFT',waiting:['DATA_CONFIRM']}}});
    await select('comparison');await page.getByRole('button',{name:/草稿数据/}).click();
    await page.getByRole('button',{name:'确认草稿',exact:true}).click();
    await page.waitForFunction(()=>window.chatAudit.confirmStarted);await select('readonly');await enabled();
    await page.evaluate(success=>window.chatAudit.release.confirm(success),success);
    await page.waitForFunction(()=>window.chatAudit.confirmFinished);await page.waitForTimeout(200);
    await current('readonly');assert.equal(await page.locator('#cw-message').isDisabled(),false);
    assert.equal(await page.getByRole('alert').filter({hasText:'合成确认失败'}).count(),0,'old confirmation errors stay out of the current Case');
    console.log(`PASS delayed draft confirmation ${success?'success':'failure'} cannot replace the current Case`);
  }

  await open('caseId=empty');await install({holdResume:['empty','readonly']});
  await send('合成 A 慢请求');await page.waitForFunction(()=>window.chatAudit.resumeStarted.empty);
  await select('readonly');await enabled();
  assert.equal(await page.locator('.cw-reply-status').count(),0,'B must not show A running state');
  await send('合成 B 独立请求');await page.waitForFunction(()=>window.chatAudit.resumeStarted.readonly);
  await page.evaluate(()=>window.chatAudit.release.empty());await page.waitForFunction(()=>window.chatAudit.resumeFinished.empty);await page.waitForTimeout(200);
  await current('readonly');assert.equal(await page.locator('#cw-message').isDisabled(),true,'A finally must not stop B running state');
  assert.ok((await page.locator('.cw-reply-status').innerText()).includes('正在回复'));
  await page.evaluate(()=>window.chatAudit.release.readonly());await page.waitForFunction(()=>window.chatAudit.resumeFinished.readonly);await enabled();
  assert.deepEqual(await page.evaluate(()=>window.chatAudit.posts.map(p=>p.id)),['empty','readonly']);
  console.log('PASS Case-specific sending and old completion cannot clear another Case running state');

  await open('mode=plan&caseId=comparison&exchange=confirmed');
  await install({exchangeCase:'comparison',holdExchangeSnapshot:true,stages:{comparison:{stage:'FILE_EXCHANGE',waiting:[{action:'GENERATE_AND_DELIVER',fileType:'01'}]}}});
  await page.getByRole('button',{name:/文件交换/}).click();await page.getByRole('button',{name:'生成可用文件',exact:true}).click();
  await page.waitForFunction(()=>window.chatAudit.exchangeSnapshotStarted);
  await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await select('readonly');
  await page.evaluate(()=>window.chatAudit.release.exchangeSnapshot());await page.waitForFunction(()=>window.chatAudit.exchangeSnapshotFinished);await page.waitForTimeout(200);
  await current('readonly');console.log('PASS file exchange refresh completing after navigation cannot replace the current Case');

  await open();await install();
  for(const [stage,waiting] of [['PREPARE_DATA',['DATA_EXECUTE']],['CONFIRM_DRAFT',['DATA_CONFIRM']],['FILE_EXCHANGE',[{action:'UPLOAD_AND_PARSE',fileType:'02'}]],['EVALUATE_RESULT',['RESULT_EVALUATE']],['CONFIRM_RESULT',['RESULT_CONFIRM']]]) {
    await page.evaluate(({stage,waiting})=>{window.chatAudit.stages.readonly={stage,waiting};},{stage,waiting});
    await select('readonly');assert.equal(await page.locator('#cw-message').isDisabled(),true,`${stage} does not support discussion`);
    assert.equal(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled(),true);
  }
  assert.equal(await page.evaluate(()=>window.chatAudit.posts.length),0);console.log('PASS non-discussion workflow stages disable the Chat send affordance');

  await open('mode=plan&caseId=comparison',{width:390,height:844});
  const artifact=page.locator('[data-slot="artifact-card"]').first();await artifact.click();
  await page.locator('.aui-detail').waitFor();
  const visitedSummaries=new Set();
  for(const key of ['Shift+Tab','Tab','Tab','Shift+Tab',...Array(25).fill('Tab')]) {
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.aui-detail')),true,`${key} stays in mobile detail`);
    const summary=await page.evaluate(()=>document.activeElement.tagName==='SUMMARY'?document.activeElement.textContent:'');if(summary)visitedSummaries.add(summary);
  }
  assert.ok([...visitedSummaries].some(text=>text.includes('准备数据')),'keyboard can reach prepared-data disclosure');
  assert.ok([...visitedSummaries].some(text=>text.includes('执行与文件安排')),'keyboard can reach execution disclosure');
  await page.getByRole('button',{name:'修改字段情况 1',exact:true}).click();
  await page.locator('dialog[open]').waitFor();await page.keyboard.press('Escape');
  await page.locator('dialog[open]').waitFor({state:'detached'});
  assert.equal(await page.locator('.aui-detail').count(),1,'inner editor Escape must preserve the detail');
  await page.keyboard.press('Escape');await page.locator('.aui-detail').waitFor({state:'detached'});
  assert.equal(await artifact.evaluate(element=>document.activeElement===element),true,'closing detail restores focus to its opener');
  assert.equal(await page.locator('.cw-main').evaluate(element=>element.inert),false);
  await artifact.click();await page.getByRole('button',{name:'关闭方案详情',exact:true}).click();
  assert.equal(await artifact.evaluate(element=>document.activeElement===element),true,'close button also restores focus');
  console.log('PASS mobile Tab/Shift+Tab trap, nested editor Escape, detail Escape and close focus restoration');
  assert.deepEqual(errors,[],'no uncaught browser errors');
} catch(error) {
  if(page)await page.screenshot({path:`${evidence}/failure.png`}).catch(()=>{});
  throw error;
} finally {await browser.close();}
