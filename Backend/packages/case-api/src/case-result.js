import {createCaseResultGraph} from '../../case-agent/src/case-result-graph.js';
import {storeError} from '../../platform-store/src/index.js';
export function createCaseResultService({repository,complete}){
 const active=new Set();
 return {read:repository.read,confirm:repository.confirm,readBusinessOutput:repository.readBusinessOutput,saveBusinessOutput:repository.saveBusinessOutput,async evaluate(token,input){
  const snapshot=await repository.snapshot(token,input);
  const key=input.chatPublicId+':'+input.casePublicId;
  if(active.size>=2 && !active.has(key))throw storeError('RESULT_REVIEW_LIMIT',429,'同时最多处理两个Case判断，请稍后重试');
  if(active.has(key))throw storeError('RESULT_REVIEW_BUSY',409,'正在判断同一组证据，请稍后查看');
  active.add(key);
  try{const state=await createCaseResultGraph({collect:async()=>snapshot,complete}).invoke({});return await repository.save(token,input,state);}
  finally{active.delete(key);}
 }};
}
