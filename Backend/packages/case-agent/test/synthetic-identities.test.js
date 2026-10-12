import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticIdentityCandidates,identityCheckDigit} from '../src/synthetic-identities.js';
const plan={exchangePlan:{steps:[{direction:'SEND',businessTime:{kind:'DATE',value:'20260818'}}]}};
test('synthetic personal identity candidates match checksum, dates and sex without changing reviewed inputs',()=>{
 const data={customers:Array.from({length:50},()=>({investorType:'1'}))};
 const original=structuredClone(data),result=syntheticIdentityCandidates(data,plan);
 assert.equal(result.length,50);assert.equal(new Set(result.map(r=>r.fields.CertificateNo)).size,50);
 for(const [index,r] of result.entries()){
  assert.equal(r.customerIndex,index);assert.equal(r.synthetic,true);
  const f=r.fields;assert.match(f.CertificateNo,/^\d{17}[0-9X]$/);
  assert.equal(f.CertificateNo.at(-1),identityCheckDigit(f.CertificateNo.slice(0,17)));
  assert.equal(f.InvestorsBirthday,f.CertificateNo.slice(6,14));
  assert.equal(new Date(f.InvestorsBirthday.replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3')+'T00:00:00Z').toISOString().slice(0,10).replaceAll('-',''),f.InvestorsBirthday);
  assert.ok(Number(f.InvestorsBirthday)<20080818);assert.equal(f.CertValidDate,'20361231');
  assert.equal(f.Sex,Number(f.CertificateNo[16])%2?'1':'2');
 }
 assert.deepEqual(data,original);
});
test('institutions and no-file cases have no personal identity candidates',()=>{
 assert.deepEqual(syntheticIdentityCandidates({customers:[{investorType:'0'}]},plan),[]);
 assert.deepEqual(syntheticIdentityCandidates({customers:[{investorType:'1'}]},{exchangePlan:{steps:[]}}),[]);
 assert.throws(()=>identityCheckDigit('SYNID'),/17位/);
});
