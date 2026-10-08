import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFundMarketDefaults,withFundMarketDefaults} from '../src/fund-market-defaults.js';

test('截图行情保留精度、空白及基金规模与客户持仓的区别',()=>{
  const config=loadFundMarketDefaults();
  assert.deepEqual(config.funds.map(f=>f.fundCode),['005107','270007','270008','270048']);
  const fund=config.funds[1];
  assert.equal(fund.yesterdayNav,'1.1000');
  assert.equal(fund.accumulativeNav,'1.00000000');
  assert.equal(fund.yesterdayTotalShares,'480000.00');
  assert.equal(fund.yesterdayTotalNav,'528000.00');
  assert.equal(fund.totalFundShares,'0.00');
  for(const f of config.funds){
    assert.equal(f.reviewOperator,null);
    assert.equal(f.sevenDayLiquidAssets,null);
    assert.equal(f.shareClass,null);
  }
});

test('用户与已有方案原值完整保留，默认数据单独注入，跨Case不累积',async()=>{
  const calls=[],complete=withFundMarketDefaults(async r=>{calls.push(r);return 'ok';},loadFundMarketDefaults());
  const first={system:'原规则',user:'本Case用270007，净值2.00000000，日期20261009'};
  await complete(first);
  await complete({system:'规则',user:'本Case用其他基金999999，不构造持仓'});
  assert.equal(first.user,'本Case用270007，净值2.00000000，日期20261009');
  assert.equal(JSON.parse(calls[0].user).input,first.user);
  assert.equal(JSON.parse(calls[1].user).input,'本Case用其他基金999999，不构造持仓');
  assert.match(calls[0].system,/用户明确的基金、净值、日期与其他条件优先/);
  assert.match(calls[0].system,/不是客户持仓/);
});

test('多轮、修复轮注入最后用户消息，历史与模型输出不改写',async()=>{
  let actual;
  const complete=withFundMarketDefaults(async r=>{actual=r;},loadFundMarketDefaults());
  const messages=[{role:'user',content:'历史输入'},{role:'assistant',content:'历史回复'},{role:'user',content:'只修正JSON'}];
  await complete({system:'规则',messages});
  assert.deepEqual(actual.messages.slice(0,2),messages.slice(0,2));
  assert.equal(JSON.parse(actual.messages[2].content).input,'只修正JSON');
  assert.equal(messages[2].content,'只修正JSON');
});

test('配置错日期或重复基金拒绝启动，不带错误默认值继续运行',()=>{
  const config=loadFundMarketDefaults();
  assert.throws(()=>withFundMarketDefaults(()=>{}, {...config,navDate:'20260230'}));
  assert.throws(()=>withFundMarketDefaults(()=>{}, {...config,funds:[config.funds[0],config.funds[0]]}));
});
