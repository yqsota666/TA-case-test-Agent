const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SCROLL_TEST_URL||'http://127.0.0.1:5231';
import assert from 'node:assert/strict';
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
for(const [width,height] of [[1440,900],[390,844],[844,320]]){
 await p.setViewportSize({width,height});await p.goto(`${base}/test/assistant-ui.html?theme=liquid&palette=contrast&caseId=comparison`);await p.locator('.aui-md').waitFor();await p.waitForTimeout(250);const view=p.locator('.cw-conversation'),button=p.getByRole('button',{name:'回到最新消息',exact:true});
 const distance=()=>view.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop);
 for(let i=0;i<5;i++){await view.evaluate(e=>e.scrollTop=0);await button.waitFor();await button.click();await p.waitForTimeout(100);assert.ok(await distance()<=1);assert.equal(await button.count(),0);}
 for(const near of [1,6,20,32,63]){await view.evaluate((e,n)=>e.scrollTop=e.scrollHeight-e.clientHeight-n,near);await p.waitForTimeout(70);assert.equal(await button.count(),0,`near-bottom ${near}px stays hidden`);}
 await view.evaluate(e=>e.scrollTop=e.scrollHeight-e.clientHeight-90);await button.waitFor();for(const n of [63,55,36]){await view.evaluate((e,n)=>e.scrollTop=e.scrollHeight-e.clientHeight-n,n);await p.waitForTimeout(60);assert.equal(await button.count(),1,'hysteresis holds visible');}
 await button.focus();await p.keyboard.press('Enter');await p.waitForTimeout(100);assert.ok(await distance()<=1);assert.equal(await p.evaluate(()=>document.activeElement.className),'cw-conversation');
 await view.evaluate(e=>e.scrollTop=0);await button.waitFor();await p.setViewportSize({width,height:height+40});await p.waitForTimeout(100);await button.click();await p.waitForTimeout(80);assert.ok(await distance()<=1);
 assert.equal(await p.evaluate(()=>scrollY),0);console.log('PASS repeated/near-bottom/keyboard/resize',width,height);
}
await p.goto(`${base}/test/assistant-ui.html?theme=liquid&palette=contrast&caseId=readonly`);await p.locator('.aui-md').waitFor();await p.waitForTimeout(100);assert.equal(await p.getByRole('button',{name:'回到最新消息',exact:true}).count(),0);assert.deepEqual(errors,[]);await b.close();
