import test from 'node:test';
import assert from 'node:assert/strict';
import {numericQuoteBindings,hasNumericFieldExpectation} from '../src/numeric-expectations.js';

test('binds the explicit calculated result without borrowing NAV or fee inputs',()=>{
 const quote='确认金额为2000.00元，确认份额按净值1.00000000且前收费0计算为2000.00份。';
 assert.deepEqual(numericQuoteBindings(quote),[{field:'confirmedAmount',value:'2000.00',operator:'eq'},{field:'confirmedVolume',value:'2000.00',operator:'eq'}]);
 for(const value of ['1','0'])assert.equal(hasNumericFieldExpectation('confirmedVolume',value,quote),false);
 assert.equal(hasNumericFieldExpectation('confirmedAmount','2000','确认金额按规则折算为2000.00元。'),true);
});
test('does not infer a calculated result from an expression or uncertain or negated text',()=>{
 for(const quote of ['确认份额按净值1.00000000和金额2000.00元计算。','确认份额按规则计算为2000.00元。','确认份额按不确定的净值计算为2000.00份。','确认份额按规则计算为2000.00份吗？','不是确认份额按规则计算为2000.00份。','确认份额按规则，确认金额计算为2000.00元。','确认份额2000/1份。']){
  assert.equal(hasNumericFieldExpectation('confirmedVolume','2000',quote),false,quote);
 }
});
