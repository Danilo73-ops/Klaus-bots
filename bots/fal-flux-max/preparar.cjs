// JavaScript / preparar.cjs / Node.js 24 + Playwright Core / FLUX preflight, never submits
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Queue}=require('../../core/queue.cjs');
const {pendingBatch}=require('./legado.cjs');
const {formSnapshot,prepareForm}=require('./ui.cjs');
const manifest=require('./manifest.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function publicURL(input){const u=new URL(input);return u.origin+u.pathname;}
function collectFacts(data,prefix='',output=[],depth=0) {
  if(depth>8||output.length>=100||!data||typeof data!=='object')return output;
  for(const [key,value] of Object.entries(data)){
    if(/token|secret|cookie|password|authorization|email|session/i.test(key))continue;
    const at=prefix?prefix+'.'+key:key;
    if(/free|promo|quota|allowance|remaining|price|cost|billable|duration|resolution|model|endpoint|reasoning|aspect|audio/i.test(key)
        && ['string','number','boolean'].includes(typeof value))output.push({path:at,value:typeof value==='string'?value.slice(0,160):value});
    else if(value&&typeof value==='object')collectFacts(value,at,output,depth+1);
    if(output.length>=100)break;
  }
  return output;
}
async function main(){
  const report={prepared:false,generationRequested:false,networkFacts:[],pages:[]};
  let page;
  const pending=new Set();
  try {
    const folder=path.join(process.env.KLAUS_DATA_DIR,manifest.id);
    const queue=new Queue({folder,bot:manifest.id,lockFd:Number(process.env.KLAUS_LOCK_FD)});queue.assertWriter();
    queue.recoverInterruptedSubmit();
    const imported=pendingBatch(path.join(process.env.HOME,manifest.legacyDirectory),manifest);
    report.excluded=imported.excluded;
    for(const excluded of imported.excluded)queue.discardPending(excluded.id,excluded.reason);
    if(imported.batch.jobs.length)report.import=queue.importBatch(imported.batch);
    report.queue=queue.summary();
    const job=queue.next();
    if(!job)throw Error(report.queue.blockedBy.length?'Há tentativa ativa ou incerta na fila nova: '+report.queue.blockedBy.join(', '):'Nenhum job elegível. Nenhum formulário foi preenchido.');
    if(!imported.batch.jobs.some(j=>j.id===job.id))throw Error('O próximo job da fila nova não pertence aos pendentes seguros do lote 06: '+job.id);
    report.job=job.id;
    const {chromium}=require('playwright-core');
    const browser=await chromium.connectOverCDP(manifest.cdp,{timeout:15000});
    const contexts=browser.contexts();
    if(contexts.length!==1)throw Error('Mais de um contexto Chromium; seleção automática recusada.');
    const context=contexts[0];
    const targets=context.pages().filter(p=>publicURL(p.url()).replace(/\/$/,'')===manifest.url);
    if(targets.length>1){
      const scored=[];
      for(const p of targets){const s=await formSnapshot(p);report.pages.push(s);scored.push({page:p,snapshot:s});}
      const focused=scored.filter(x=>x.snapshot.focused&&x.snapshot.promptFields.some(f=>f.visible));
      if(focused.length!==1)throw Error('Há abas FLUX duplicadas sem uma única aba focada e editável. Sessões preservadas.');
      page=focused[0].page;
    }else page=targets[0]||await context.newPage();
    page.setDefaultTimeout(7000);
    const onResponse=response=>{
      const task=(async()=>{
        const u=new URL(response.url());
        if(u.hostname!=='fal.ai'||!u.pathname.startsWith('/api/')||!response.headers()['content-type']?.includes('json'))return;
        const length=Number(response.headers()['content-length']||0);if(length>750000)return;
        const body=await response.body();if(body.length>750000)return;
        const facts=collectFacts(JSON.parse(body.toString()));
        if(facts.length&&report.networkFacts.length<20)report.networkFacts.push({url:publicURL(response.url()),status:response.status(),facts});
      })().catch(()=>{});
      pending.add(task);task.finally(()=>pending.delete(task));
    };
    page.on('response',onResponse);
    if(!targets.length)await page.goto(manifest.url,{waitUntil:'domcontentloaded',timeout:30000});
    const until=Date.now()+18000;
    do{
      report.before=await formSnapshot(page);
      if(report.before.promptFields.some(f=>f.visible)||report.before.signInToRun)break;
      await sleep(500);
    }while(Date.now()<until);
    const prepared=await prepareForm(page,job);
    queue.prepare(job.id,{prompt:prepared.prompt,parameters:prepared.parameters});
    report.prepared=true;report.evidence=prepared.evidence;report.after=await formSnapshot(page);report.queue=queue.summary();
    await Promise.race([Promise.allSettled([...pending]),sleep(1000)]);
    page.off('response',onResponse);
  }catch(error){
    report.error=error.message;
    if(page)report.after=await Promise.race([formSnapshot(page).catch(e=>({error:e.message})),sleep(5000).then(()=>({error:'DOM snapshot timeout'}))]);
  }
  return report;
}
if(require.main===module)main().then(report=>{
  // Exit after stdout has drained. Socket closure disconnects this client only;
  // no Browser.close, page.close or context.close command is sent to Chromium.
  process.stdout.write(JSON.stringify(report)+'\n',()=>process.exit(report.prepared?0:1));
}).catch(error=>process.stdout.write(JSON.stringify({prepared:false,error:error.message})+'\n',()=>process.exit(1)));
module.exports={collectFacts};
