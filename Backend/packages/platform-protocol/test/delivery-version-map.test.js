import test from 'node:test';
import assert from 'node:assert/strict';
import {profileForVersion} from '../src/profiles.js';
import {normalizeDeliveryProfile} from '../src/delivery-package.js';
test('delivery defaults and wire definitions share the same protocol version mapping',()=>{
 for(const version of ['21','22']){
  const mapped=profileForVersion(version);assert.equal(mapped.label,version==='22'?'2.2':'2.1');
  assert.deepEqual(normalizeDeliveryProfile({},version),mapped.deliveryDefaults);
  assert.equal(mapped.recordCountWidth,version==='22'?16:8);
 }
 assert.deepEqual(normalizeDeliveryProfile({},'2.2'),normalizeDeliveryProfile({},'22'));
 assert.deepEqual(normalizeDeliveryProfile({},'2.1'),normalizeDeliveryProfile({},'21'));
 assert.equal(normalizeDeliveryProfile({},'22').aml,true);
 assert.equal(normalizeDeliveryProfile({},'21').aml,false);
 assert.throws(()=>normalizeDeliveryProfile({},'20'),/Unsupported protocol/);
 assert.throws(()=>normalizeDeliveryProfile({aml:true},'21'));
 const a=normalizeDeliveryProfile({},'22');a.indexSuffixes.OFI='-TEST';assert.equal(profileForVersion('22').deliveryDefaults.indexSuffixes.OFI,'');
});
