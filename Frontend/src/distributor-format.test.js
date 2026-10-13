import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryFilePreview,deliveryFormatSummary,editableDeliveryProfile} from './distributor-format.js';
const profile={aml:true,includeEmptyR1:true,dataSequence:false,trailingCrlf:true,directoryLayout:'distributor/date',indexSuffixes:{OFI:'',OFX:''}};
test('file examples reflect the saved distributor, optional files, suffixes and directory',()=>{
 const identity={distributor_code:'227',ta_code:'27'};
 const files=deliveryFilePreview(identity,profile);assert.equal(files.length,7);
 assert.equal(files[0].fileName,'227/{业务日期}/OFI_227_27_{业务日期}.TXT');
 const other=deliveryFilePreview({distributor_code:'005',ta_code:'99'},{...profile,aml:false,includeEmptyR1:false,dataSequence:true,directoryLayout:'flat',indexSuffixes:{OFI:'-CUSTOM',OFX:''}});
 assert.equal(other.length,3);assert.equal(other[0].fileName,'OFI_005_99_{业务日期}-CUSTOM.TXT');assert.ok(other[1].fileName.endsWith('_01_001.TXT'));
 assert.deepEqual(deliveryFilePreview(identity,null),[]);
});
test('format summary and editable default retain independent profile values',()=>{
 assert.equal(deliveryFormatSummary(profile),'01/03/R1 + OFX/X1/X3 · 无序号');
 assert.equal(deliveryFormatSummary({...profile,aml:false,includeEmptyR1:false,dataSequence:true}),'01/03 · 带序号');
 const edit=editableDeliveryProfile(profile);assert.equal(edit.summaryNo,1);edit.indexSuffixes.OFI='-CHANGED';assert.equal(profile.indexSuffixes.OFI,'');
});

test('protocol version labels use human readable versions without guessing unsupported formats',async()=>{
 const {protocolVersionLabel}=await import('./distributor-format.js');
 assert.equal(protocolVersionLabel('22'),'2.2');assert.equal(protocolVersionLabel('21'),'2.1');assert.equal(protocolVersionLabel('20'),'20');
});

test('accepted channel profile previews OFG and empty 43 inside its date directory',()=>{
 const nine={...profile,includeEmpty43:true,directoryLayout:'date',indexSuffixes:{OFI:'',OFX:'',OFG:'-CUSTOM'}};
 const files=deliveryFilePreview({distributor_code:'227',ta_code:'27'},nine);
 assert.equal(files.length,9);assert.ok(files.every(f=>f.fileName.startsWith('{业务日期}/')));
 assert.equal(files.find(f=>f.type==='OFG').fileName,'{业务日期}/OFG_227_27_{业务日期}-CUSTOM.TXT');
 assert.equal(files.find(f=>f.type==='43').fileName,'{业务日期}/OFD_227_27_{业务日期}_43.TXT');
 assert.equal(deliveryFormatSummary(nine),'01/03/R1 + OFX/X1/X3 + OFG/43 · 无序号');
});
