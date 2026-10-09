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
