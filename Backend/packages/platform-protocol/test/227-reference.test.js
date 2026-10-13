import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {buildDataFile,parseDataFile} from '../src/codec.js';
import {buildDeliveryPackage} from '../src/delivery-package.js';
import {channelDeliveryProfile} from '../../platform-store/src/delivery-profile.js';

const fixture=new URL('./fixtures/227-reference-20241119/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',fixture),'utf8'));
const profile={...channelDeliveryProfile({protocol_version:'22',distributor_code:'227',ta_code:'27'}),includeEmpty43:false,directoryLayout:'distributor/date'};
const wire={creator:'227',receiver:'27',date:'20260817',version:'22'};
function originals(){return ['01','03'].map(fileType=>({fileName:`OFD_227_27_${wire.date}_${fileType}.TXT`,
 rawBytes:buildDataFile({...wire,fileType,records:[],summaryNo:profile.summaryNo,sender:profile.sender,recipient:profile.recipient,fieldNamesCase:profile.fieldNamesCase,trailingCrlf:profile.trailingCrlf})}));}
function unpack(rawBytes){
 const directory=mkdtempSync(join(tmpdir(),'227-reference-'));
 try{
  const path=join(directory,'20260817.zip');writeFileSync(path,rawBytes);
  const json=JSON.parse(execFileSync('/usr/bin/python3',['-c','import zipfile,sys,json,base64;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))',path],{encoding:'utf8'}));
  return Object.fromEntries(Object.entries(json).map(([name,bytes])=>[name,Buffer.from(bytes,'base64')]));
 }finally{rmSync(directory,{recursive:true});}
}
test('227 production profile matches all seven independent local reference envelopes byte for byte',()=>{
 const delivery=buildDeliveryPackage(originals(),profile),files=unpack(delivery.rawBytes);
 assert.equal(delivery.fileName,'20260817.zip');
 const expectedNames=manifest.files.map(({fileName})=>'227/20260817/'+fileName.replaceAll('20241119',wire.date));
 assert.deepEqual(Object.keys(files).sort(),expectedNames.sort());
 for(const item of manifest.files){
  const reference=readFileSync(new URL(item.fileName,fixture));
  assert.equal(createHash('sha256').update(reference).digest('hex'),item.fixtureSha256);
  const expected=Buffer.from(reference.toString('ascii').replaceAll('20241119',wire.date),'ascii');
  assert.deepEqual(files['227/20260817/'+item.fileName.replaceAll('20241119',wire.date)],expected,item.fileName);
  if(item.fileName.startsWith('OFD_'))assert.equal(parseDataFile(reference).records.length,0);
 }
});
test('227 local reference detects omitted AML index, filename sequence and wrong header defaults',()=>{
 const expectedNames=manifest.files.map(({fileName})=>'227/20260817/'+fileName.replaceAll('20241119',wire.date)).sort();
 const missing=buildDeliveryPackage(originals(),{...profile,aml:false});assert.notDeepEqual(missing.fileNames.sort(),expectedNames);
 const sequence=buildDeliveryPackage(originals(),{...profile,dataSequence:true});assert.notDeepEqual(sequence.fileNames.sort(),expectedNames);
 const changed=unpack(buildDeliveryPackage(originals(),{...profile,summaryNo:1}).rawBytes);
 const expected=readFileSync(new URL('OFD_227_27_20241119_R1.TXT',fixture)).toString('ascii').replaceAll('20241119',wire.date);
 assert.notEqual(changed['227/20260817/OFD_227_27_20260817_R1.TXT'].toString('ascii'),expected);
});
