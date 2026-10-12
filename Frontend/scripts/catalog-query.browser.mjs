import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {catalogFixture} from '../../Backend/packages/platform-store/test/catalog-query-fixture.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=await catalogFixture();
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
const base=process.env.CATALOG_TEST_URL||'http://127.0.0.1:5210';
const shots=process.env.CATALOG_SCREENSHOTS;
if(shots)mkdirSync(shots,{recursive:true});
await page.route('**/live-api/**',async route=>{
  const url=new URL(route.request().url());
  const input=route.request().method()==='POST'?JSON.parse(route.request().postData()):Object.fromEntries(url.searchParams);
  try {
    let result;
    if(url.pathname.startsWith('/live-api/data/tables/'))result=await fixture.data.listTable(fixture.token,{...input,table:url.pathname.split('/')[4]});
    else if(url.pathname==='/live-api/files/catalog/search')result=await fixture.files.listFiles(fixture.token,input);
    else throw new Error('合成验收不调用业务写接口');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  }catch(error){await route.fulfill({status:error.status||500,contentType:'application/json',body:JSON.stringify({error:error.code,message:error.message})});}
});
const total=async text=>{await page.locator('.gc-pagination').filter({hasText:text}).waitFor();await page.waitForFunction(()=>!document.querySelector('.gc-table-scroll')?.getAttribute('aria-busy')||document.querySelector('.gc-table-scroll')?.getAttribute('aria-busy')==='false');};
const open=async()=>{await page.getByRole('button',{name:'＋ 更多筛选',exact:true}).click();await page.getByRole('dialog',{name:'高级筛选',exact:true}).waitFor();};
const add=async(field,operator,value,group=page.locator('.gc-query-group').first())=>{
  await group.locator(':scope > .gc-query-add').getByRole('button',{name:'＋添加条件',exact:true}).click();
  const row=group.locator(':scope > .gc-query-rule').last();
  await row.getByLabel('筛选字段',{exact:true}).selectOption(field);
  await row.locator('select').nth(1).selectOption(operator);
  if(Array.isArray(value)){const inputs=row.locator('input');await inputs.nth(0).fill(value[0]);await inputs.nth(1).fill(value[1]);}
  else if(value!==undefined)await row.locator('input,select').last().fill(value);
  return row;
};
const apply=async()=>page.getByRole('button',{name:'应用条件',exact:true}).click();
try {
  await page.goto(base+'/test/catalog-query.html?theme=liquid');await total('/ 125 条');
  if(shots)await page.screenshot({path:shots+'/desktop-default.png'});
  await page.locator('.gc-business-filter').filter({hasText:'项目'}).click();await page.getByRole('checkbox',{name:'合成搜索项目 125',exact:true}).check();await page.getByRole('button',{name:'应用筛选',exact:true}).click();await total('/ 125 条');
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 125 条');
  await page.getByRole('button',{name:'下一页',exact:true}).click();await total('101–125');
  await page.getByRole('button',{name:'排序',exact:true}).click();await page.getByRole('button',{name:'＋添加排序',exact:true}).click();await page.getByLabel('排序字段1').selectOption('simulated_balance');await page.getByRole('button',{name:'应用排序',exact:true}).click();await total('1–100');
  await open();await add('simulated_balance','between',['10','20']);await apply();await total('/ 10 条');
  await page.getByRole('button',{name:/常用查询/}).click();await page.getByLabel('查询名称').fill('余额区间');await page.getByRole('button',{name:'保存查询',exact:true}).click();await page.getByRole('status').filter({hasText:'当前查询已保存'}).waitFor();await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 125 条');
  await page.getByRole('button',{name:/常用查询/}).click();await page.getByRole('button',{name:'余额区间',exact:true}).click();await total('/ 10 条');
  await page.reload();await total('/ 10 条');
  if(shots)await page.screenshot({path:shots+'/desktop-filtered.png'});
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 125 条');await page.getByLabel('快捷搜索').fill('%_');await total('/ 1 条');
  await page.getByRole('button',{name:'申请记录',exact:true}).click();await total('/ 3 条');
  await open();await add('ApplicationAmount','gte','10');await page.getByRole('button',{name:'＋添加分组',exact:true}).first().click();
  const nested=page.locator('.gc-query-group').nth(1);await nested.locator('legend select').selectOption('or');await add('TransactionAccountID','eq','00000000000000001',nested);await add('ApplicationAmount','lt','5',nested);await apply();await total('/ 1 条');
  await open();await page.locator('.gc-query-group').first().locator(':scope > .gc-query-rule').first().locator('input').fill('not-a-number');await apply();await page.getByRole('alert').filter({hasText:'有效数字'}).waitFor();
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 3 条');
  await page.getByRole('button',{name:'账户',exact:true}).click();await total('/ 2 条');await page.getByLabel('数据来源').selectOption('formal');await total('0 条');assert.ok(await page.locator('thead th').count()>3);
  await page.getByRole('button',{name:'文件页',exact:true}).click();await total('/ 2 条');
  await open();await add('caseTitle','eq','合成查询2');await apply();await total('/ 1 条');
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 2 条');
  await open();await add('distributorCode','eq','009');await add('businessDate','eq','2026-08-18');await apply();await total('/ 1 条');
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 2 条');
  await page.locator('tbody tr').filter({hasText:'OFD_QUERY.TXT'}).getByRole('button',{name:'同批申请'}).click();await total('/ 3 条');assert.equal(await page.locator('.gc-condition-chip').count(),4);
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 3 条');
  for(const [width,height] of [[1440,900],[390,844],[844,260]]) {
    await page.setViewportSize({width,height});await open();
    const frame=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
    assert.equal(frame.scrollWidth,width);assert.equal(frame.scrollHeight,height);
    if(shots)await page.screenshot({path:`${shots}/${width}-${height}.png`});
    await page.getByRole('button',{name:'取消',exact:true}).click();
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'文件页',exact:true}).click();await total('/ 2 条');
  await page.locator('.gc-business-filter').filter({hasText:'方向'}).click();
  await page.getByRole('checkbox',{name:'申请文件',exact:true}).check();await page.getByRole('checkbox',{name:'TA回传',exact:true}).check();
  await page.getByRole('button',{name:'应用筛选',exact:true}).click();await total('/ 2 条');
  await page.locator('.gc-business-filter').filter({hasText:'方向'}).click();await page.getByRole('checkbox',{name:'TA回传',exact:true}).uncheck();await page.getByRole('button',{name:'应用筛选',exact:true}).click();await total('/ 1 条');
  await page.locator('.gc-business-filter').filter({hasText:'业务日期'}).click();await page.getByLabel('开始日期',{exact:true}).fill('2026-08-18');await page.getByLabel('结束日期',{exact:true}).fill('2026-08-18');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await total('/ 1 条');
  await page.locator('.gc-condition-chip').getByRole('button',{name:/编辑业务日期/}).click();await page.getByRole('dialog',{name:'高级筛选',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 2 条');
  await open();await add('businessDate','gte','2026-08-18');await add('businessDate','lte','2026-08-18');await apply();await total('/ 1 条');
  await page.locator('.gc-business-filter').filter({hasText:'业务日期'}).click();await page.getByLabel('开始日期',{exact:true}).fill('2026-08-01');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await total('/ 1 条');
  assert.equal(await page.locator('.gc-condition-chip').count(),3,'quick date preserves multiple existing advanced bounds');
  await page.getByRole('button',{name:'清空条件',exact:true}).click();await total('/ 2 条');
  for(const [width,height] of [[390,844],[844,260]]) {
    await page.setViewportSize({width,height});await page.locator('.gc-business-filter').filter({hasText:'业务日期'}).click();
    const bounds=await page.getByRole('button',{name:'应用筛选',exact:true}).boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height);
    if(shots)await page.screenshot({path:`${shots}/date-${width}-${height}.png`});
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('.gc-business-filter').filter({hasText:'业务日期'}).evaluate(element=>element===document.activeElement));
  }
  assert.deepEqual(errors,[]);console.log('PASS browser: real SQL filtering, nested groups, decimals, leading zeros, errors, sources, pagination, saved query/reload, multi-Case file trace, desktop/mobile/short viewport');
}finally{await browser.close();await fixture.close();}
