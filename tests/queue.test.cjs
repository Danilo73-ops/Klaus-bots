// JavaScript / queue.test.cjs / Node.js 24 test runner / offline Klaus-bots queue
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Queue}=require('../core/queue.cjs');
const settings={duration:15,resolution:'720p',aspect_ratio:'9:16',generate_audio:true,reasoning_level:'high'};
function fixture(t,count=2) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'klaus-queue-'));
  // Production kernel-lock acquisition is tested through the real Python launcher separately.
  const lockFd=fs.openSync(path.join(folder,'operation.lock'),'w',0o600);
  t.after(()=>{fs.closeSync(lockFd);fs.rmSync(folder,{recursive:true,force:true});});
  const q=new Queue({folder,bot:'fal-flux-max',lockFd});
  const batch={schema:1,bot:'fal-flux-max',parameters:settings,
    jobs:Array.from({length:count},(_,i)=>({id:'job'+(73+i)+'_es_prueba',prompt:'Independent offline fixture '+i}))};
  q.importBatch(batch);
  const id=batch.jobs[0].id;
  function prepared(jobId=id) {
    const job=q.load().jobs[jobId];q.prepare(jobId,{prompt:job.prompt,parameters:job.parameters});
  }
  function accepted(jobId=id) {
    prepared(jobId);const attempt=q.beginSubmit(jobId);q.accepted(jobId,{attemptId:attempt.id,requestId:'request-'+jobId});
    return {attempt,requestId:'request-'+jobId};
  }
  return {q,folder,batch,id,prepared,accepted};
}
test('reimport is idempotent and changed ID cannot replace an existing prompt',t=>{
  const {q,batch,id}=fixture(t);
  const original=fs.readFileSync(q.file);
  assert.equal(q.importBatch(batch).added,0);
  assert.deepEqual(fs.readFileSync(q.file),original);
  const changed=structuredClone(batch);changed.jobs[0].prompt='different';
  assert.throws(()=>q.importBatch(changed),/outro prompt/);
  assert.deepEqual(fs.readFileSync(q.file),original);
  assert.equal(q.load().jobs[id].phase,'pending');
});
test('identical prompt under another ID is refused without a partial import',t=>{
  const {q,batch}=fixture(t);
  const original=fs.readFileSync(q.file);
  const extra=structuredClone(batch);extra.jobs=[{id:'new-job',prompt:'new fixture'},{id:'other-id',prompt:batch.jobs[0].prompt}];
  assert.throws(()=>q.importBatch(extra),/Prompt idêntico/);
  assert.deepEqual(fs.readFileSync(q.file),original);
});
test('prepared requires the full exact prompt and settings',t=>{
  const {q,id}=fixture(t),job=q.load().jobs[id];
  assert.throws(()=>q.prepare(id,{prompt:job.prompt+' ',parameters:settings}),/interface/);
  assert.throws(()=>q.prepare(id,{prompt:job.prompt,parameters:{...settings,aspect_ratio:'auto'}}),/interface/);
  assert.equal(q.load().jobs[id].phase,'pending');
});
test('failure before submission can return to pending; failure after boundary cannot',t=>{
  const {q,id,prepared}=fixture(t);
  prepared();q.failBeforeSubmit(id,'field unavailable');
  assert.equal(q.load().jobs[id].retryable,true);
  prepared();q.beginSubmit(id);
  assert.throws(()=>q.failBeforeSubmit(id,'click timeout'),/proibida/);
  assert.equal(q.load().jobs[id].phase,'submitting');
  assert.equal(q.load().jobs[id].retryable,false);
});
test('interruption after durable submission boundary never permits another send',t=>{
  const {q,id,prepared}=fixture(t);prepared();const attempt=q.beginSubmit(id);
  const resumed=new Queue({folder:q.folder,bot:q.bot,lockFd:q.lockFd});
  assert.equal(resumed.recoverInterruptedSubmit(),1);
  assert.equal(resumed.recoverInterruptedSubmit(),0);
  assert.equal(resumed.load().jobs[id].phase,'uncertain');
  assert.equal(resumed.next(),null);
  assert.throws(()=>resumed.beginSubmit(id),/proibida/);
  resumed.accepted(id,{attemptId:attempt.id,requestId:'found-server-side'});
  assert.equal(resumed.load().jobs[id].phase,'queued');
});
test('request acceptance must belong to the same attempt',t=>{
  const {q,id,prepared}=fixture(t);prepared();q.beginSubmit(id);
  assert.throws(()=>q.accepted(id,{attemptId:'old-attempt',requestId:'stale'}),/não corresponde/);
  assert.equal(q.load().jobs[id].phase,'submitting');
});
test('stale content rejection cannot terminate the current job',t=>{
  const {q,id,prepared}=fixture(t);prepared();q.beginSubmit(id);
  assert.throws(()=>q.rejectContent(id,{attemptId:'old-attempt',message:'material flagged by a content checker'}),/não confirmada/);
  assert.equal(q.load().jobs[id].phase,'submitting');
});
test('confirmed content rejection discards text and releases the next job',t=>{
  const {q,id,prepared,batch}=fixture(t);prepared();const attempt=q.beginSubmit(id);
  q.rejectContent(id,{attemptId:attempt.id,message:'prompt: material flagged by a content checker'});
  assert.equal(q.load().jobs[id].phase,'rejected_content');
  assert.equal(q.load().jobs[id].retryable,false);
  assert.equal(q.load().jobs[id].prompt,undefined);
  assert.equal(q.next().id,batch.jobs[1].id);
  q.importBatch(batch);
  assert.equal(q.load().jobs[id].prompt,undefined);
  assert.throws(()=>q.prepare(id,{prompt:batch.jobs[0].prompt,parameters:settings}),/proibida/);
});
test('active request blocks another prepared job',t=>{
  const {q,id,accepted,prepared,batch}=fixture(t);accepted();
  const other=batch.jobs[1].id;prepared(other);
  assert.throws(()=>q.beginSubmit(other),/ativa ou incerta/);
  assert.equal(q.load().jobs[other].phase,'prepared');
  assert.equal(q.next(),null);
});
test('result from another request is refused',t=>{
  const {q,id,accepted}=fixture(t);accepted();
  assert.throws(()=>q.resultReady(id,{requestId:'stale-request',url:'https://example.org/old.mp4'}),/outra solicitação/);
  assert.equal(q.load().jobs[id].phase,'queued');
});
test('confirmed remote failure permits next job without resubmitting the failed job',t=>{
  const {q,id,accepted,batch}=fixture(t);const {requestId}=accepted();
  q.remoteFailed(id,{requestId,message:'server failed'});
  assert.equal(q.load().jobs[id].retryable,false);
  assert.equal(q.next().id,batch.jobs[1].id);
});
test('invalid MP4 never becomes completed and is preserved',t=>{
  const {q,id,folder,accepted}=fixture(t);const {requestId}=accepted();
  q.resultReady(id,{requestId,url:'https://example.org/current.mp4'});q.downloading(id);
  const file=path.join(folder,'result.mp4');const bytes=Buffer.alloc(60000,37);fs.writeFileSync(file,bytes);
  assert.throws(()=>q.complete(id,{requestId,file}),/FFprobe/);
  assert.equal(q.load().jobs[id].phase,'downloading');
  assert.deepEqual(fs.readFileSync(file),bytes);
});
test('valid vertical 15s MP4 with audio can be completed and survives reload',t=>{
  if(spawnSync('ffmpeg',['-version']).status!==0)return t.skip('ffmpeg missing: media fixture cannot be created');
  const {q,id,folder,accepted}=fixture(t);const {requestId}=accepted();
  const file=path.join(folder,'validated.mp4');
  const generated=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=navy:s=720x1280:r=12',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','15','-c:v','libx264','-preset','ultrafast',
    '-crf','35','-pix_fmt','yuv420p','-c:a','aac','-b:a','32k','-movflags','+faststart',file],{timeout:30000});
  assert.equal(generated.status,0,generated.stderr?.toString());
  q.resultReady(id,{requestId,url:'https://example.org/current.mp4?signature=local'});
  q.complete(id,{requestId,file});
  const saved=q.load().jobs[id];
  assert.equal(saved.phase,'completed');assert.equal(saved.media.audio,true);assert.equal(saved.media.width,720);
  assert.equal(saved.result.url,undefined);
  assert.equal(new Queue({folder:q.folder,bot:q.bot}).load().jobs[id].file,file);
  assert.throws(()=>q.beginSubmit(id),/proibida/);
});
test('state is backed up before mutations',t=>{
  const {q,id,folder,prepared}=fixture(t);const original=fs.readFileSync(q.file);prepared();
  const backup=path.join(folder,'backups/queue-r0000000001.json');
  assert.deepEqual(fs.readFileSync(backup),original);
  assert.equal(q.load().jobs[id].phase,'prepared');
});
test('corrupt state is not reset or overwritten',t=>{
  const {q,batch}=fixture(t);const invalid='{incomplete-json';fs.writeFileSync(q.file,invalid);
  assert.throws(()=>q.importBatch(batch),SyntaxError);
  assert.equal(fs.readFileSync(q.file,'utf8'),invalid);
});
test('writes without the inherited writer descriptor are refused',t=>{
  const {q,batch}=fixture(t);const readOnly=new Queue({folder:q.folder,bot:q.bot});
  assert.throws(()=>readOnly.importBatch(batch),/lock herdado/);
  assert.equal(readOnly.summary().jobs.length,2);
});
