// JavaScript / queue.cjs / Node.js 24 / persistent local queue, Klaus-bots
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const PHASES = new Set(['pending','prepared','submitting','uncertain','queued','running',
  'result_ready','downloading','completed','rejected_content','failed_remote','discarded']);
const ACTIVE = new Set(['submitting','uncertain','queued','running','result_ready','downloading']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
function stable(value) {
  if (Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function requireCondition(ok, message) { if (!ok) throw new Error(message); }
function syncDirectory(folder) {
  const fd = fs.openSync(folder, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function validateMP4(file, parameters) {
  requireCondition(path.extname(file).toLowerCase()==='.mp4', 'Resultado final precisa ter extensão .mp4.');
  const st=fs.lstatSync(file);
  requireCondition(st.isFile() && !st.isSymbolicLink() && st.size>50000, 'MP4 ausente, pequeno ou inválido.');
  const run=spawnSync('ffprobe',['-v','error','-show_entries',
    'format=duration,size,format_name:stream=codec_type,codec_name,width,height','-of','json',file],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  requireCondition(!run.error && run.status===0, 'FFprobe não validou o arquivo: '+(run.error?.message||run.stderr||'erro'));
  const data=JSON.parse(run.stdout), streams=data.streams||[];
  const video=streams.find(s=>s.codec_type==='video'), audio=streams.find(s=>s.codec_type==='audio');
  const duration=Number(data.format?.duration);
  requireCondition(video && /(?:^|,)mp4(?:,|$)/.test(data.format?.format_name||''), 'Contêiner MP4 ou vídeo ausente.');
  requireCondition(Number.isFinite(duration) && Math.abs(duration-parameters.duration)<=0.6, 'Duração incompatível com o job.');
  requireCondition(!parameters.generate_audio || !!audio, 'Faixa de áudio ausente.');
  if(parameters.aspect_ratio==='9:16') {
    requireCondition(video.height>video.width && Math.abs(video.width/video.height-9/16)<0.025, 'Vídeo não está em 9:16.');
  }
  if(parameters.resolution==='720p') requireCondition(Math.min(video.width,video.height)>=680, 'Vídeo abaixo de 720p.');
  return {duration,bytes:st.size,width:video.width,height:video.height,audio:!!audio,codec:video.codec_name};
}

class Queue {
  constructor({folder,bot,lockFd}) {
    requireCondition(typeof bot==='string' && ID.test(bot), 'Identificador de bot inválido.');
    this.folder=path.resolve(folder); this.bot=bot; this.lockFd=lockFd;
    this.file=path.join(this.folder,'queue.json');
  }
  assertWriter() {
    requireCondition(Number.isInteger(this.lockFd) && this.lockFd>=3, 'Escrita exige o lock herdado do klaus.py.');
    const inherited=fs.fstatSync(this.lockFd), expected=fs.statSync(path.join(this.folder,'operation.lock'));
    requireCondition(inherited.dev===expected.dev && inherited.ino===expected.ino, 'Lock incompatível com a fila.');
  }
  load() {
    let raw;
    try { raw=fs.readFileSync(this.file,'utf8'); }
    catch(e) { if(e.code==='ENOENT') return {schema:1,bot:this.bot,revision:0,jobs:{},events:[]}; throw e; }
    const data=JSON.parse(raw);
    this.validate(data);
    return data;
  }
  validate(data) {
    requireCondition(data.schema===1 && data.bot===this.bot && Number.isSafeInteger(data.revision) && data.revision>=0, 'Formato ou identidade da fila incompatível.');
    requireCondition(data.jobs && typeof data.jobs==='object' && !Array.isArray(data.jobs) && Array.isArray(data.events), 'Estrutura de fila inválida.');
    for(const [id,j] of Object.entries(data.jobs)) {
      requireCondition(ID.test(id) && j.id===id && PHASES.has(j.phase), 'Job ou fase inválida: '+id);
      requireCondition(/^[a-f0-9]{64}$/.test(j.digest), 'Digest inválido: '+id);
      requireCondition(j.retryable===['pending','prepared'].includes(j.phase), 'Reenvio incompatível com fase: '+id);
      if(typeof j.prompt==='string') requireCondition(hash(stable({prompt:j.prompt,parameters:j.parameters}))===j.digest, 'Prompt ou parâmetros foram alterados: '+id);
    }
  }
  mutate(event, action) {
    this.assertWriter();
    const previous=this.load(), data=structuredClone(previous);
    const result=action(data);
    if(stable(data)===stable(previous)) return result;
    data.revision++;
    data.events.push({at:now(),revision:data.revision,...event});
    data.events=data.events.slice(-2000);
    this.validate(data);
    fs.mkdirSync(this.folder,{recursive:true,mode:0o700});
    if(fs.existsSync(this.file)) {
      const back=path.join(this.folder,'backups'); fs.mkdirSync(back,{mode:0o700,recursive:true});
      const target=path.join(back,'queue-r'+String(previous.revision).padStart(10,'0')+'.json');
      try { fs.copyFileSync(this.file,target,fs.constants.COPYFILE_EXCL); }
      catch(e) { if(e.code!=='EEXIST'||!fs.readFileSync(target).equals(fs.readFileSync(this.file))) throw e; }
      const fd=fs.openSync(target,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(back);
    }
    const temp=this.file+'.tmp.'+crypto.randomUUID();
    const fd=fs.openSync(temp,'wx',0o600);
    try { fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp,this.file); syncDirectory(this.folder);
    return result;
  }
  importBatch(batch) {
    requireCondition(batch && batch.schema===1 && batch.bot===this.bot && Array.isArray(batch.jobs) && batch.jobs.length, 'Lote deve ter schema:1, bot e jobs não vazios.');
    const ids=new Set();
    const records=batch.jobs.map(j=>{
      requireCondition(j && typeof j.id==='string' && ID.test(j.id) && !ids.has(j.id), 'ID inválido ou repetido no lote.'); ids.add(j.id);
      requireCondition(typeof j.prompt==='string' && j.prompt.trim(), 'Prompt vazio: '+j.id);
      const parameters=j.parameters||batch.parameters;
      requireCondition(parameters && Number.isInteger(parameters.duration) && parameters.duration>0 && typeof parameters.generate_audio==='boolean' && typeof parameters.aspect_ratio==='string' && typeof parameters.resolution==='string', 'Parâmetros incompletos: '+j.id);
      return {id:j.id,prompt:j.prompt,parameters,digest:hash(stable({prompt:j.prompt,parameters}))};
    });
    return this.mutate({type:'batch_import',count:records.length},data=>{
      let added=0;
      for(const item of records) {
        if(Object.hasOwn(data.jobs,item.id)) {
          requireCondition(data.jobs[item.id].digest===item.digest, 'ID existente possui outro prompt ou parâmetros: '+item.id);
          continue;
        }
        requireCondition(!Object.values(data.jobs).some(j=>j.digest===item.digest), 'Prompt idêntico já existe sob outro ID: '+item.id);
        Object.defineProperty(data.jobs,item.id,{value:{...item,phase:'pending',retryable:true,createdAt:now()},enumerable:true,writable:true,configurable:true});
        added++;
      }
      return {added,total:Object.keys(data.jobs).length};
    });
  }
  change(id,type,allowed,action) {
    return this.mutate({type,id},data=>{
      const job=data.jobs[id];
      requireCondition(job && allowed.includes(job.phase), 'Transição '+type+' proibida para '+id+' ('+(job?.phase||'ausente')+').');
      const result=action(job,data);job.updatedAt=now();return result;
    });
  }
  prepare(id,{prompt,parameters}) {
    return this.change(id,'prepared',['pending','prepared'],job=>{
      requireCondition(hash(stable({prompt,parameters}))===job.digest, 'A interface não contém o prompt e os parâmetros esperados.');
      job.phase='prepared';job.retryable=true;
    });
  }
  failBeforeSubmit(id,message) {
    return this.change(id,'pre_submit_failure',['pending','prepared'],job=>{job.phase='pending';job.retryable=true;job.error=String(message);});
  }
  discardPending(id,reason) {
    if(!Object.hasOwn(this.load().jobs,id))return false;
    const current=this.load().jobs[id];
    if(['discarded','completed','rejected_content','failed_remote'].includes(current.phase))return false;
    return this.change(id,'legacy_exclusion',['pending','prepared'],job=>{
      job.phase='discarded';job.retryable=false;job.error=String(reason);return true;
    });
  }
  beginSubmit(id) {
    return this.change(id,'submission_boundary',['prepared'],(job,data)=>{
      requireCondition(!Object.values(data.jobs).some(j=>j.id!==id&&ACTIVE.has(j.phase)), 'Existe solicitação ativa ou incerta; reconcilie antes de enviar.');
      job.attempt={id:crypto.randomUUID(),createdAt:now()};job.phase='submitting';job.retryable=false;delete job.error;
      return structuredClone(job.attempt);
    });
  }
  accepted(id,{attemptId,requestId}) {
    return this.change(id,'accepted',['submitting','uncertain'],(job,data)=>{
      requireCondition(job.attempt.id===attemptId && typeof requestId==='string' && requestId.length>0, 'Resposta não corresponde à tentativa atual.');
      requireCondition(!Object.values(data.jobs).some(j=>j.id!==id&&j.requestId===requestId), 'Request ID já pertence a outro job.');
      job.requestId=requestId;job.phase='queued';
    });
  }
  running(id,requestId) {
    return this.change(id,'running',['queued','running'],job=>{requireCondition(job.requestId===requestId,'Request ID diferente.');job.phase='running';});
  }
  markUncertain(id,message) {
    return this.change(id,'uncertain',['submitting'],job=>{job.phase='uncertain';job.error=String(message);});
  }
  rejectContent(id,{attemptId,requestId,message}) {
    return this.change(id,'content_rejection',['submitting','uncertain','queued','running'],job=>{
      requireCondition(job.attempt.id===attemptId && /material flagged by a content checker/i.test(message||''), 'Rejeição não confirmada para esta tentativa.');
      requireCondition(!job.requestId || job.requestId===requestId, 'Rejeição pertence a outra solicitação.');
      job.phase='rejected_content';job.error='material flagged by a content checker';job.retryable=false;delete job.prompt;
    });
  }
  remoteFailed(id,{requestId,message}) {
    return this.change(id,'remote_failure',['queued','running'],job=>{
      requireCondition(job.requestId===requestId,'Falha de outra solicitação.');job.phase='failed_remote';job.error=String(message);job.retryable=false;
    });
  }
  resultReady(id,{requestId,url}) {
    return this.change(id,'result_ready',['queued','running'],job=>{
      requireCondition(job.requestId===requestId,'Resultado de outra solicitação.');
      const parsed=new URL(url);requireCondition(parsed.protocol==='https:','URL do resultado deve ser HTTPS.');
      job.phase='result_ready';job.result={requestId,url};
    });
  }
  downloading(id) {
    return this.change(id,'downloading',['result_ready','downloading'],job=>{job.phase='downloading';});
  }
  complete(id,{requestId,file}) {
    return this.change(id,'completed',['result_ready','downloading'],job=>{
      requireCondition(job.requestId===requestId && job.result.requestId===requestId,'Arquivo não correlacionado à solicitação.');
      const metadata=validateMP4(file,job.parameters);
      job.phase='completed';job.file=path.resolve(file);job.media=metadata;job.completedAt=now();job.retryable=false;
      delete job.result.url;
    });
  }
  recoverInterruptedSubmit() {
    return this.mutate({type:'recovery'},data=>{
      let changed=0;
      for(const job of Object.values(data.jobs)) if(job.phase==='submitting') {
        job.phase='uncertain';job.error='Processo interrompido após a barreira de envio; consultar antes de prosseguir.';job.retryable=false;changed++;
      }
      return changed;
    });
  }
  next() {
    const jobs=Object.values(this.load().jobs);
    return jobs.some(j=>ACTIVE.has(j.phase))?null:jobs.find(j=>['pending','prepared'].includes(j.phase))||null;
  }
  summary() {
    const data=this.load(), counts={};
    const jobs=Object.values(data.jobs).map(j=>{counts[j.phase]=(counts[j.phase]||0)+1;return {id:j.id,phase:j.phase,retryable:j.retryable,requestId:j.requestId||null,file:j.file||null};});
    return {bot:this.bot,revision:data.revision,counts,blockedBy:jobs.filter(j=>ACTIVE.has(j.phase)).map(j=>j.id),jobs};
  }
}
module.exports={Queue,validateMP4,stable,hash};
