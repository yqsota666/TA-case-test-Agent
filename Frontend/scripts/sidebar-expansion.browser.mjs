const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
const base=process.env.SIDEBAR_TEST_URL||'http://127.0.0.1:5238';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:1440,height:900},{width:1200,height:500}]){
  const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/test/assistant-ui.html?mode=sidebar&caseId=readonly`);await page.locator('.aui-md').waitFor();
  const first=page.locator('.cw-set-toggle').filter({hasText:'合成组件验收'}),other=page.locator('.cw-set-toggle').filter({hasText:'另一个合成项目'});
  const expectExpanded=async(button,value)=>{await page.waitForFunction(({text,value})=>[...document.querySelectorAll('.cw-set-toggle')].find(e=>e.textContent.includes(text))?.getAttribute('aria-expanded')===String(value),{text:await button.innerText(),value});};
  await other.click();await expectExpanded(other,false);
  await page.getByRole('button',{name:'字段对比验收',exact:true}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('caseId')==='comparison');await expectExpanded(other,false);await expectExpanded(first,true);
  await page.getByRole('button',{name:'空白对话验收',exact:true}).click();await page.locator('.cw-empty-guidance').waitFor();await expectExpanded(other,false);
  await page.reload();await page.locator('.cw-empty-guidance').waitFor();await expectExpanded(other,false);
  await other.focus();await other.press('Enter');await expectExpanded(other,true);
  await first.focus();await first.press('Enter');await expectExpanded(first,false);
  await page.getByRole('button',{name:'另一个空白Case',exact:true}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('caseId')==='other-empty');await expectExpanded(first,false);await expectExpanded(other,true);
  await page.reload();await page.locator('.cw-empty-guidance').waitFor();await expectExpanded(first,false);await expectExpanded(other,true);
  assert.deepEqual(errors,[]);console.log('PASS collapse, Case switching, cross-project navigation, keyboard and reload',viewport);await context.close();
 }
}finally{await browser.close();}
