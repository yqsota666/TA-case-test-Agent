import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildDataFile, parseDataFile, parseIndexFile} from '../src/codec.js';
import {buildDeliveryPackage, normalizeDeliveryProfile} from '../src/delivery-package.js';
import {channelDeliveryProfile} from '../../platform-store/src/delivery-profile.js';
import {compileApplicationIntents} from '../../case-agent/src/application-preparation.js';
const fixture=new URL('./fixtures/227-accepted-20260818/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',fixture),'utf8'));
const channel={id:'1',distributorCode:'227',taCode:'27',protocolVersion:'22'};
const profile=channelDeliveryProfile({protocol_version:'22',distributor_code:'227',ta_code:'27'});
function unpack(result){
 const dir=mkdtempSync(join(tmpdir(),'227-accepted-'));
 try{const path=join(dir,result.fileName);writeFileSync(path,result.rawBytes);
  const data=JSON.parse(execFileSync('/usr/bin/python3',['-c','import zipfile,sys,json,base64;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))',path],{encoding:'utf8'}));
  return Object.fromEntries(Object.entries(data).map(([n,b])=>[n,Buffer.from(b,'base64')]));
 }finally{rmSync(dir,{recursive:true});}
}
function source(date,records=[]){return ['01','03'].map(fileType=>({fileName:`OFD_227_27_${date}_${fileType}.TXT`,
 rawBytes:buildDataFile({creator:'227',receiver:'27',version:'22',date,fileType,records:records.filter(r=>r.fileType===fileType).map(r=>r.record),...profile})}));}

test('227 default delivers nine independent accepted envelopes byte for byte, with only the business date replaced',()=>{
 for(const date of ['20260818','20261103']){
  const result=buildDeliveryPackage(source(date),profile),files=unpack(result);
  assert.equal(result.fileName,date+'.zip');assert.equal(result.manifest.length,9);
  assert.deepEqual(Object.keys(files).sort(),manifest.files.map(f=>date+'/'+f.fileName.replaceAll('20260818',date)).sort());
  for(const item of manifest.files){
   const reference=readFileSync(new URL(item.fileName,fixture));
   assert.equal(createHash('sha256').update(reference).digest('hex'),item.fixtureSha256);
   const expected=Buffer.from(reference.toString('ascii').replaceAll('20260818',date),'ascii');
   assert.deepEqual(files[date+'/'+item.fileName.replaceAll('20260818',date)],expected,item.fileName);
  }
 }
});
test('agent compiler preserves all accounts and exact opening/purchase/AML links for variable cohort sizes',()=>{
 for(const count of [1,3,10]){
  const data={customers:Array.from({length:count},(_,i)=>({id:String(i+1),name:'陈思远',investor_type:'1'})),
   accounts:Array.from({length:count},(_,i)=>({id:String(i+1),customer_id:String(i+1),account_no:`SYN${i}`})),funds:[{id:'1',fund_code:'270008',share_class:'0'}]};
  const intents=data.accounts.flatMap(a=>[
   {key:'open'+a.id,fileType:'01',businessCode:'001',accountId:a.id,fundId:null,targetFundId:null,businessDate:'20260818',fields:{CertificateType:'0',CertificateNo:'SYNID'+a.id,TransactionTime:'090000'}},
   {key:'buy'+a.id,fileType:'03',businessCode:'022',accountId:a.id,fundId:'1',targetFundId:null,businessDate:'20260818',fields:{ApplicationAmount:'100.00',CurrencyType:'156',ChargeType:'0',TransactionTime:'100000'}}]);
  const compiled=compileApplicationIntents({intents,data,channel,bindings:[],casePublicId:'synthetic-case',unassignedTaAccounts:new Set(data.accounts.map(a=>a.id))});
  assert.deepEqual(compiled.questions,[]);assert.deepEqual(compiled.waiting,[]);assert.equal(compiled.records.length,2*count);
  const files=unpack(buildDeliveryPackage(source('20260818',compiled.records),profile));
  const read=type=>parseDataFile(files[`20260818/OFD_227_27_20260818_${type}.TXT`]).records;
  const opens=read('01'),trades=read('03'),aml=read('X1');
  for(const records of [opens,trades,aml])assert.equal(records.length,count);
  assert.equal(new Set([...opens,...trades,...aml].map(r=>r.AppSheetSerialNo)).size,3*count);
  for(const opening of opens){
   const trade=trades.find(r=>r.TransactionAccountID===opening.TransactionAccountID),x=aml.find(r=>r.OriginalAppSheetNo===opening.AppSheetSerialNo);
   assert.equal(trade.OriginalAppSheetNo,opening.AppSheetSerialNo);assert.equal(trade.OriginalAppDate,opening.TransactionDate);assert.equal(trade.TAAccountID,null);
   assert.equal(trade.ApplicationAmount,'100.00');assert.equal(x.CertificateNo,opening.CertificateNo);assert.equal(x.OriginalAppDate,opening.TransactionDate);
  }
  for(const [kind,types] of [['OFI',['01','03','R1']],['OFX',['X1','X3']]])assert.deepEqual(parseIndexFile(files[`20260818/${kind}_227_27_20260818.TXT`]).fileNames,types.map(t=>`OFD_227_27_20260818_${t}.TXT`));
 }
});
test('empty contract companions are opt-in per channel; unsupported versions and malformed policies fail',()=>{
 assert.throws(()=>normalizeDeliveryProfile({includeEmpty43:'yes'}),/开关/);
 assert.throws(()=>normalizeDeliveryProfile({includeEmpty43:true},'21'),/协议版本/);
 assert.throws(()=>normalizeDeliveryProfile({indexSuffixes:{OFG:'../'}}),/后缀/);
 for(const code of ['005','926'])assert.equal(channelDeliveryProfile({protocol_version:'22',distributor_code:code,ta_code:'27'}).includeEmpty43,false);
 const legacy=channelDeliveryProfile({protocol_version:'22',distributor_code:'227',ta_code:'27'}, {...profile,includeEmpty43:false,directoryLayout:'distributor/date'});
 const old=buildDeliveryPackage(source('20260818'),legacy);assert.equal(old.manifest.length,7);assert.ok(old.fileNames.every(n=>n.startsWith('227/20260818/')));
 const renamed=buildDeliveryPackage(source('20260818'),{...profile,indexSuffixes:{OFG:'-TEST'}});assert.ok(renamed.fileNames.includes('20260818/OFG_227_27_20260818-TEST.TXT'));
});
