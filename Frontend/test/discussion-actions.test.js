import assert from 'node:assert/strict';
import test from 'node:test';
import {discussionAction} from '../src/discussion-actions.js';
test('all ordinary chat goes to server intent routing irrespective of wording or number of replies',()=>{
 for(const text of ['请整理方案','继续','那你现在可以生成吗','不要生成方案','如何生成方案？','金额改成3000然后整理'])assert.equal(discussionAction({text,waiting:['DISCUSS','PROPOSE_PLAN'],messages:[]}), 'DISCUSS');
});
