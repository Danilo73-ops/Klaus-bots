// JavaScript / legado.cjs / Node.js 24 / conservative batch-06 import, original files read only
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash}=require('../../core/queue.cjs');
function readJSON(file) {
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}
}
function pendingBatch(legacy,manifest) {
  const prior=readJSON(path.join(legacy,'state.json')).jobs||{};
  const recent=readJSON(path.join(legacy,'lotes/lote06-clean/estado.json')).jobs||{};
  const folder=path.join(legacy,'lotes/lote06_es_25_v1');
  const names=fs.readdirSync(folder).filter(n=>/^job(?:7[1-9]|8\d|9[0-5])_es_.*\.txt$/.test(n)).sort();
  if(names.length!==25)throw Error('Lote local precisa conter exatamente os 25 prompts 71–95. Encontrados: '+names.length);
  const excluded=[],jobs=[];
  const terminal=new Set(['concluido','descartado_incerto','rejeitado_conteudo','descartado']);
  for(const name of names){
    const id=name.slice(0,-4),number=Number(id.slice(3,5));
    const prompt=fs.readFileSync(path.join(folder,name),'utf8').trim();
    const old=prior[id]||{},fresh=recent[id]||{};
    if(prompt.length<1000)throw Error('Prompt incompleto: '+id);
    for(const record of [old,fresh])if(record.digest && record.digest!==hash(prompt))throw Error('Prompt diverge do histórico: '+id);
    const history=[old,fresh];
    if(number===71||number===72||history.some(j=>terminal.has(j.phase))){
      excluded.push({id,reason:number<=72?'historical-do-not-resend':history.find(j=>terminal.has(j.phase)).phase});continue;
    }
    if(history.some(j=>j.submittedAt||j.requestId||j.request_id||j.startedAt||j.phase&&!['aguardando','revisao'].includes(j.phase))){
      throw Error('Job possui indício de envio anterior e precisa de reconciliação: '+id);
    }
    const dest=path.join('/storage/emulated/0/Download/KLAUS AUT. FLUX MAX/ESPANHOL',id+'.mp4');
    if(fs.existsSync(dest)){excluded.push({id,reason:'existing-mp4-preserved',file:dest});continue;}
    jobs.push({id,prompt});
  }
  return {batch:{schema:1,bot:manifest.id,parameters:manifest.parameters,jobs},excluded};
}
module.exports={pendingBatch};
