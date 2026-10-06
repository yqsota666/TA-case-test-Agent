import test from 'node:test';
import assert from 'node:assert/strict';
import {hasNumericFieldExpectation,numericQuoteBindings} from '../src/numeric-expectations.js';
test('field grounding supports decimal quantities and rejects partial or unrelated numbers',()=>{
 assert.equal(hasNumericFieldExpectation('confirmedAmount','-100','确认金额−100.00元'),true);
 assert.equal(hasNumericFieldExpectation('confirmedVolume','100','confirmedVolume: 100.00'),true);
 for(const quote of ['场景100基金000100','确认金额基金代码100','确认金额100.123456789','确认金额1e2','确认金额1,000'])assert.equal(hasNumericFieldExpectation('confirmedAmount','100',quote),false,quote);
 assert.deepEqual(numericQuoteBindings('可用持仓90份、冻结10份、总份额100份').map(b=>b.field),['availableVolume','frozenVolume','totalVolume']);
});
