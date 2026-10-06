import test from 'node:test';
import assert from 'node:assert/strict';
import {hasNumericFieldExpectation,numericQuoteBindings} from '../src/numeric-expectations.js';
test('field grounding supports decimal quantities and rejects partial or unrelated numbers',()=>{
 assert.equal(hasNumericFieldExpectation('confirmedAmount','-100','确认金额−100.00元'),true);
 assert.equal(hasNumericFieldExpectation('confirmedVolume','100','confirmedVolume: 100.00'),true);
 for(const quote of ['场景100基金000100','确认金额基金代码100','确认金额100.123456789','确认金额1e2','确认金额1,000'])assert.equal(hasNumericFieldExpectation('confirmedAmount','100',quote),false,quote);
 assert.deepEqual(numericQuoteBindings('可用持仓90份、冻结10份、总份额100份').map(b=>b.field),['availableVolume','frozenVolume','totalVolume']);
});

test('invalid token tails and negated comparisons cannot backtrack into an apparent quantity',()=>{
 for(const quote of ['确认金额10e2','确认金额100,000','确认金额1e+2','总份额1e-2','确认金额100.1.2','冻结份额不等于10','冻结份额>10','冻结份额<10'])assert.deepEqual(numericQuoteBindings(quote),[],quote);
 for(const quote of ['冻结份额应为10.00份','冻结份额等于10份','冻结份额至少10份','冻结份额不低于10份','冻结份额≥10份'])assert.equal(hasNumericFieldExpectation('frozenVolume','10',quote),true,quote);
});

test('comparison directions belong to the named field; unsupported multipliers and expressions require clarification',()=>{
 const quote='总份额至少100份，可用90份，冻结最多10份';
 assert.equal(hasNumericFieldExpectation('totalVolume','100',quote,'gte'),true);
 assert.equal(hasNumericFieldExpectation('availableVolume','90',quote,'eq'),true);
 assert.equal(hasNumericFieldExpectation('availableVolume','90',quote,'gte'),false);
 assert.equal(hasNumericFieldExpectation('frozenVolume','10',quote,'lte'),true);
 assert.equal(hasNumericFieldExpectation('frozenVolume','10',quote,'eq'),false);
 for(const quote of ['确认金额100万元','总份额100%','总份额1/2','总份额1×100','总份额1 × 100'])assert.deepEqual(numericQuoteBindings(quote),[],quote);
});
