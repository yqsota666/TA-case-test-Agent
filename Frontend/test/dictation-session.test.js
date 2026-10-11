import test from 'node:test';
import assert from 'node:assert/strict';
import {DictationSession,appendDictation,activeDictation} from '../src/assistant-ui/dictation-session.js';

function setup() {
  let clock=0,tick,stops=0,cancels=0;
  const speech=new Set(),end=new Set(),commits=[];
  const adapter={status:{type:'starting'},onSpeech:fn=>{speech.add(fn);return()=>speech.delete(fn);},onSpeechEnd:fn=>{end.add(fn);return()=>end.delete(fn);},stop:async()=>{stops++;},cancel:()=>{cancels++;}};
  const controller=new DictationSession({createSession:()=>adapter,onState:()=>{},onCommit:text=>commits.push(text),now:()=>clock,schedule:fn=>{tick=fn;return 1;},unschedule:()=>{tick=null;}});
  return {controller,adapter,commits,say:(transcript,isFinal)=>speech.forEach(fn=>fn({transcript,isFinal})),
    advance:ms=>{clock+=ms;tick?.();},finish:reason=>{adapter.status={type:'ended',reason};end.forEach(fn=>fn({transcript:''}));tick?.();},
    counts:()=>({stops,cancels}),listeners:()=>speech.size,queued:()=>[...speech]};
}
test('partial replacements stay out of the draft; final segments append once after completion',()=>{
  const h=setup();h.controller.start('原始条件');
  h.adapter.status={type:'running'};h.advance(100);
  assert.equal(h.controller.state.phase,'recording');
  h.say('申',false);h.say('申购',false);h.say('申购1000元。',true);h.say('明天',false);h.say('',false);
  assert.equal(h.controller.state.transcript,'申购1000元。');assert.deepEqual(h.commits,[]);
  h.finish('stopped');assert.deepEqual(h.commits,['原始条件\n申购1000元。']);assert.equal(h.listeners(),0);
  h.advance(200);assert.equal(h.commits.length,1);
});
test('cancel and disposal reject late results and completion, preserving the draft',()=>{
  for(const action of ['cancel','dispose']){
    const h=setup();h.controller.start('原输入');const [late]=h.queued();h.say('待丢弃',true);
    h.controller[action]();late({transcript:'迟到结果',isFinal:true});h.finish('stopped');
    assert.deepEqual(h.commits,[]);assert.equal(h.counts().cancels,1);assert.equal(h.listeners(),0);
  }
});
test('failed recognition retains only final text for explicit recovery',()=>{
  const h=setup();h.controller.start('条件');h.say('已确认识别',true);h.say('不可靠临时文字',false);h.finish('error');
  assert.equal(h.controller.state.phase,'error');assert.equal(h.controller.state.transcript,'已确认识别');
  assert.deepEqual(h.commits,[]);h.controller.keep('用户修改后的条件');assert.deepEqual(h.commits,['用户修改后的条件\n已确认识别']);assert.equal(h.counts().cancels,1);
});
test('silence, permission/start failure and interrupted stop show failure rather than success',()=>{
  const h=setup();h.controller.start('条件');h.say('只有临时结果',false);h.finish('stopped');assert.equal(h.controller.state.phase,'error');assert.deepEqual(h.commits,[]);
  h.controller.createSession=()=>{throw new Error('permission denied');};h.controller.start('条件');assert.match(h.controller.state.error,/权限/);
  const interrupted=setup();interrupted.controller.start('条件');interrupted.finish('cancelled');assert.equal(interrupted.controller.state.phase,'error');
});
test('startup timeout cancels the microphone and maximum duration stops once',async()=>{
  const h=setup();h.controller.start('');h.advance(15000);assert.equal(h.counts().cancels,1);assert.equal(h.controller.state.phase,'error');
  const long=setup();long.controller.start('');long.adapter.status={type:'running'};long.advance(100);long.advance(120000);long.advance(1000);
  assert.equal(long.counts().stops,1);assert.equal(long.controller.state.phase,'stopping');await long.controller.stop();assert.equal(long.counts().stops,1);
  long.finish('stopped');assert.equal(activeDictation(long.controller.state),false);
});
test('stop failure and cancelling while stop is pending cannot commit',async()=>{
  const h=setup();h.controller.start('保留');h.adapter.stop=async()=>{throw new Error('closed');};await h.controller.stop();assert.equal(h.controller.state.phase,'error');assert.equal(h.counts().cancels,1);assert.deepEqual(h.commits,[]);
  const pending=setup();let resolve;pending.adapter.stop=()=>new Promise(done=>{resolve=done;});pending.controller.start('原文');pending.say('识别',true);
  const stopping=pending.controller.stop();pending.controller.cancel();pending.finish('stopped');resolve();await stopping;assert.deepEqual(pending.commits,[]);
});
test('message limit never silently truncates the original or transcribed text',()=>{
  const h=setup();h.controller.start('长'.repeat(3999));h.say('新内容',true);h.finish('stopped');assert.equal(h.controller.state.phase,'error');assert.match(h.controller.state.error,/4000/);assert.deepEqual(h.commits,[]);
  assert.equal(appendDictation('原文\n',' 新文字 '),'原文\n新文字');assert.equal(appendDictation('','内容'),'内容');assert.equal(appendDictation('原文',' '),'原文');
});
