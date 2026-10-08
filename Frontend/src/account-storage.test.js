import test from 'node:test';
import assert from 'node:assert/strict';
import {accountStorageKey,setAccountStorageOwner} from './account-storage.js';
test('browser drafts are keyed by authenticated account and inaccessible after logout',()=>{
 setAccountStorageOwner(null);assert.throws(accountStorageKey,/未登录/);
 setAccountStorageOwner('account-a');const a=accountStorageKey();
 setAccountStorageOwner('account-b');const b=accountStorageKey();assert.notEqual(a,b);
 assert.equal(b,'case-agent-live-workbench:account-b');
 setAccountStorageOwner('account-a');assert.equal(accountStorageKey(),a);
 setAccountStorageOwner(null);assert.throws(accountStorageKey,/未登录/);
});
