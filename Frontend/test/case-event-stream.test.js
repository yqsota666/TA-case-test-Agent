import test from 'node:test';
import assert from 'node:assert/strict';
import {readCaseEventStream} from '../src/case-event-stream.js';
const stream=text=>new ReadableStream({start(controller){for(const byte of new TextEncoder().encode(text))controller.enqueue(new Uint8Array([byte]));controller.close();}});
test('split UTF-8, CRLF, comments and multiline data are parsed without losing characters',async()=>{
  const events=[];
  const result=await readCaseEventStream(stream(': heartbeat\r\n\r\nevent: delta\r\ndata: {"text":"中文"}\r\n\r\nevent: result\ndata: {\ndata: "reply":"中文"}\n\n'),(name,value)=>events.push([name,value]));
  assert.deepEqual(result,{reply:'中文'});assert.deepEqual(events,[['delta',{text:'中文'}],['result',{reply:'中文'}]]);
});
test('EOF and explicit errors never count as successful replies',async()=>{
  await assert.rejects(readCaseEventStream(stream('event: delta\ndata: {"text":"部分"}\n\n')),{code:'STREAM_INCOMPLETE'});
  await assert.rejects(readCaseEventStream(stream('event: error\ndata: {"error":"MODEL_UNAVAILABLE","message":"稍后重试","status":503}\n\n')),{code:'MODEL_UNAVAILABLE',status:503});
});

test('the HTTP client removes rejected streamed text on repair reset',async t=>{
 const {requestCaseStream}=await import('../src/live-case-api.js');
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async()=>new Response(stream('event: delta\ndata: {"text":"错误旧答"}\n\nevent: reset\ndata: {}\n\nevent: delta\ndata: {"text":"正确新答"}\n\nevent: result\ndata: {"reply":"正确新答"}\n\n'),{headers:{'Content-Type':'text/event-stream'}});
 let text='',resets=0;
 const result=await requestCaseStream('/case/discussion',{}, {onDelta:delta=>text+=delta,onReset:()=>{text='';resets++;}});
 assert.equal(resets,1);assert.equal(text,result.reply);assert.equal(text,'正确新答');
});
