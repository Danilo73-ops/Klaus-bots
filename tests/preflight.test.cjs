// JavaScript / preflight.test.cjs / Node.js 24 test runner / offline FLUX form and legacy import
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {findControl,valueMatches,nativeConfigClick,prepareForm,isRunButton}=require('../bots/fal-flux-max/ui.cjs');
const {pendingBatch}=require('../bots/fal-flux-max/legado.cjs');
const {collectFacts}=require('../bots/fal-flux-max/preparar.cjs');
const {hash}=require('../core/queue.cjs');
const manifest=require('../bots/fal-flux-max/manifest.json');
const params=manifest.parameters;
test('semantic control selection handles auto and ignores hidden duplicates',()=>{
  const controls=[{index:0,visible:false,name:'aspect_ratio',labels:[],text:'9:16'},
    {index:1,visible:true,name:null,id:'aspect_ratio',labels:['Aspect Ratio'],text:'auto (default)'}];
  assert.equal(findControl(controls,'aspect_ratio').index,1);
  assert.equal(valueMatches('auto (default)','9:16','aspect_ratio'),false);
  assert.equal(valueMatches('15 s','15','duration'),true);
  assert.equal(valueMatches('15 seconds','15','duration'),true);
  assert.equal(valueMatches('high (default)','high','reasoning_level'),true);
});
test('ambiguous visible semantic controls are refused',()=>{
  const c={visible:true,name:'duration',labels:[]};
  assert.throws(()=>findControl([c,c],'duration'),/Mais de um/);
});
test('Run can be identified by its own span when a shortcut is concatenated to the text',()=>{
  assert.equal(isRunButton({text:'RunCtrlEnter',leafTexts:['Run','Ctrl','Enter']}),true);
  assert.equal(isRunButton({text:'Sign in to run',leafTexts:['Run']}),false);
  assert.equal(isRunButton({text:'Reset',leafTexts:['Reset']}),false);
});
test('native control helper rejects Run and submit buttons',async()=>{
  let clicks=0;
  const original=global.getComputedStyle;global.getComputedStyle=()=>({display:'block',visibility:'visible'});
  try {
    function handle(text,type='button'){return {evaluate:async fn=>fn({innerText:text,tagName:'BUTTON',type,getAttribute:()=>null,
      getBoundingClientRect:()=>({width:100,height:30}),click:()=>clicks++})};}
    await assert.rejects(nativeConfigClick(handle('Run')),/proibida/);
    await assert.rejects(nativeConfigClick(handle('15','submit')),/proibida/);
    await nativeConfigClick(handle('15'));
    assert.equal(clicks,1);
  }finally{global.getComputedStyle=original;}
});
function simulatedPage({revertPrompt=false,running=false,missingRun=false}={}) {
  const state={values:{duration:'5',resolution:'720p',aspect_ratio:'auto (default)',reasoning_level:'low'},
    audio:false,more:false,optionKey:null,prompt:'old text',runClicks:0};
  const fieldLabels={duration:'Duration',resolution:'Resolution',aspect_ratio:'Aspect Ratio',generate_audio:'Generate Audio',reasoning_level:'Reasoning Level'};
  const keys=['duration','resolution','aspect_ratio','generate_audio','reasoning_level'];
  const opts={duration:['5','15'],resolution:['720p','1080p'],aspect_ratio:['auto (default)','9:16'],reasoning_level:['low','high']};
  function snapshot(){return {running,signInToRun:false,controls:keys.map((key,index)=>({index,visible:!['aspect_ratio','generate_audio','reasoning_level'].includes(key)||state.more,
    tag:'BUTTON',name:key,labels:[fieldLabels[key]],text:state.values[key]||'',checked:key==='generate_audio'?state.audio:false})),
    buttons:[{text:'More',visible:true,disabled:false},...(missingRun?[]:[{text:'Run',visible:true,disabled:false}])],offers:['25 free runs left']};}
  const page={evaluate:async()=>snapshot()};
  page.locator=selector=>{
    function locator(index=0,filtered=null){
      const kind=selector.startsWith('textarea')?'prompt':selector.startsWith('[role="option"]')?'option':selector.startsWith('button:visible')?'named':'control';
      function text(){return kind==='option'?(opts[state.optionKey]||[])[index]:kind==='named'?'More':state.values[keys[index]]||'';}
      const object={
        count:async()=>kind==='prompt'?1:kind==='option'?(opts[state.optionKey]||[]).length:kind==='named'?(filtered?.test('More')?1:0):keys.length,
        nth:i=>locator(i,filtered),filter:({hasText})=>locator(index,hasText),
        innerText:async()=>text(),inputValue:async()=>revertPrompt&&state.prompt!=='old text'&&state.prompt!==''?'reverted':state.prompt,
        fill:async value=>{state.prompt=value;},
        click:async()=>{if(kind==='named')state.more=true;},
        evaluate:async (fn,arg)=>fn({innerText:text(),tagName:'BUTTON',type:'button',getAttribute:()=>null,scrollIntoView:()=>{},getBoundingClientRect:()=>({width:100,height:30}),
          click:()=>{
            if(kind==='named'){state.more=true;return;}
            if(kind==='option'){state.values[state.optionKey]=text();state.optionKey=null;return;}
            const key=keys[index];if(key==='generate_audio')state.audio=!state.audio;else state.optionKey=key;
          }},arg)
      };return object;
    }
    return locator();
  };
  return {page,state};
}
test('simulated complete preflight configures all parameters and preserves the full prompt without Run',async()=>{
  const original=global.getComputedStyle;global.getComputedStyle=()=>({display:'block',visibility:'visible'});
  try{
    const {page,state}=simulatedPage();
    const prompt='Complete offline fixture with original new dialogue.';
    const result=await prepareForm(page,{prompt,parameters:params});
    assert.equal(result.prompt,prompt);assert.deepEqual(result.parameters,params);
    assert.equal(state.values.aspect_ratio,'9:16');assert.equal(state.values.duration,'15');
    assert.equal(state.values.reasoning_level,'high');assert.equal(state.audio,true);
    assert.equal(state.runClicks,0);assert.equal(result.evidence.run.enabled,true);
  }finally{global.getComputedStyle=original;}
});
test('simulated React reversion stops preflight',async()=>{
  const original=global.getComputedStyle;global.getComputedStyle=()=>({display:'block',visibility:'visible'});
  try{
    const {page,state}=simulatedPage({revertPrompt:true});
    await assert.rejects(prepareForm(page,{prompt:'New offline text',parameters:params}),/React/);
    assert.equal(state.runClicks,0);
  }finally{global.getComputedStyle=original;}
});
test('page with an active request is left unchanged',async()=>{
  const {page,state}=simulatedPage({running:true});
  await assert.rejects(prepareForm(page,{prompt:'new text',parameters:params}),/em andamento/);
  assert.equal(state.prompt,'old text');assert.equal(state.values.duration,'5');
});
test('network facts exclude authentication and unrelated profile fields',()=>{
  const facts=collectFacts({token:'PRIVATE',email:'PRIVATE',user:{name:'PRIVATE'},promotion:{free_runs_remaining:25,cost:0},parameters:{duration:15}});
  assert.equal(facts.length,3);assert(!JSON.stringify(facts).includes('PRIVATE'));
});
function legacyFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'klaus-legacy-'));
  fs.mkdirSync(path.join(root,'lotes/lote06_es_25_v1'),{recursive:true});
  fs.mkdirSync(path.join(root,'lotes/lote06-clean'),{recursive:true});
  for(let n=71;n<=95;n++)fs.writeFileSync(path.join(root,'lotes/lote06_es_25_v1',`job${n}_es_fixture.txt`),('offline fixture '+n+' ').repeat(80));
  fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({jobs:{job71_es_fixture:{phase:'descartado_incerto',submittedAt:'old'},job72_es_fixture:{phase:'descartado_incerto',submittedAt:'old'}}}));
  const recent=path.join(root,'lotes/lote06-clean/estado.json');
  fs.writeFileSync(recent,JSON.stringify({jobs:{job73_es_fixture:{phase:'aguardando'}}}));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,recent};
}
test('legacy import preserves 71/72 and selects 73 without reading old MP4 jobs',t=>{
  const {root}=legacyFixture(t),result=pendingBatch(root,manifest);
  assert.equal(result.batch.jobs.length,23);assert.equal(result.batch.jobs[0].id,'job73_es_fixture');
  assert.equal(result.excluded.length,2);
});
test('legacy import refuses uncertain submission evidence',t=>{
  const {root,recent}=legacyFixture(t);
  fs.writeFileSync(recent,JSON.stringify({jobs:{job73_es_fixture:{phase:'aguardando',submittedAt:'not-safe'}}}));
  assert.throws(()=>pendingBatch(root,manifest),/reconciliação/);
});
test('legacy import verifies historical prompt digests',t=>{
  const {root,recent}=legacyFixture(t);
  fs.writeFileSync(recent,JSON.stringify({jobs:{job73_es_fixture:{phase:'aguardando',digest:hash('different')}}}));
  assert.throws(()=>pendingBatch(root,manifest),/diverge/);
});
test('a terminal old record wins over a newer pending record',t=>{
  const {root}=legacyFixture(t);
  fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({jobs:{job73_es_fixture:{phase:'concluido',file:'/moved/elsewhere.mp4'}}}));
  const result=pendingBatch(root,manifest);
  assert.equal(result.batch.jobs.length,22);assert(result.excluded.some(x=>x.id==='job73_es_fixture'));
});
