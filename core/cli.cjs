// JavaScript / cli.cjs / Node.js 24 / local Klaus-bots commands, launched by klaus.py
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Queue}=require('./queue.cjs');
try {
  const [command,bot,batch]=process.argv.slice(2);
  if(!['status','import'].includes(command)||!bot)throw Error('Use python3 klaus.py para executar comandos.');
  if(!process.env.KLAUS_DATA_DIR||!process.env.KLAUS_LOCK_FD)throw Error('Entrada pelo klaus.py é obrigatória.');
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../bots',bot,'manifest.json'),'utf8'));
  if(manifest.id!==bot)throw Error('Manifesto incompatível.');
  const queue=new Queue({bot,folder:path.join(process.env.KLAUS_DATA_DIR,bot),lockFd:Number(process.env.KLAUS_LOCK_FD)});
  queue.assertWriter();
  if(command==='import'){
    if(!batch)throw Error('Arquivo de lote não informado.');
    const parsed=JSON.parse(fs.readFileSync(batch,'utf8'));
    for(const job of parsed.jobs||[]) {
      const expected=manifest.parameters, params=job.parameters||parsed.parameters;
      if(JSON.stringify(Object.keys(expected).sort().map(k=>[k,expected[k]]))!==JSON.stringify(Object.keys(params||{}).sort().map(k=>[k,params[k]])))throw Error('Parâmetros do lote diferem do manifesto de '+bot+'.');
    }
    console.log(JSON.stringify(queue.importBatch(parsed),null,2));
  }else console.log(JSON.stringify({stage:manifest.stage,generationEnabled:manifest.generationEnabled,...queue.summary()},null,2));
}catch(error){console.error('KLAUS: '+error.message);process.exitCode=1;}
