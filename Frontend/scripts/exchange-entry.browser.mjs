import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900}});
const base=process.env.SCROLL_TEST_URL||'http://127.0.0.1:5210',errors=[];
page.on('pageerror',error=>errors.push(error.message));
mkdirSync('.context/catalog-design/exchange',{recursive:true});
try{
  for(const exchange of ['unconfirmed','confirmed','not-required']){
    await page.goto(`${base}/test/assistant-ui.html?theme=liquid&mode=plan&caseId=readonly&exchange=${exchange}`);
    await page.getByText('请根据当前确认状态继续。',{exact:true}).waitFor();
    const card=page.locator('.cw-conversation').getByRole('button',{name:/文件交换/});
    assert.equal(await card.count(),exchange==='confirmed'?1:0);
    if(exchange==='confirmed'){
      const order=await page.locator('.cw-messages').innerText();
      assert.ok(order.indexOf('文件交换')<order.indexOf('下一步是什么？'),'entry belongs to the plan response before the subsequent question');
      assert.equal(await page.locator('.cw-messages > button').filter({hasText:'文件交换'}).count(),0);
    }
    await page.screenshot({path:`.context/catalog-design/exchange/${exchange}.png`});
  }
  assert.deepEqual(errors,[]);console.log('PASS: unconfirmed/no-file plans hide exchange; confirmed entry stays with its plan before later chat messages');
}finally{await browser.close();}
