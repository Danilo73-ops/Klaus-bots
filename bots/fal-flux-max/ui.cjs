// JavaScript / ui.cjs / Node.js 24 + Playwright Core / semantic FLUX form preparation
'use strict';
const {hash,stable}=require('../../core/queue.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CONTROL='[role="combobox"],select,[role="switch"],input[type="checkbox"],input[type="number"]';
const FIELD_NAMES={duration:'Duration',resolution:'Resolution',aspect_ratio:'Aspect Ratio',generate_audio:'Generate Audio',reasoning_level:'Reasoning Level'};
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
function fieldMatch(text,key) {
  const label=FIELD_NAMES[key];
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('^'+escaped+'(?:\\s*\\*|\\s*\\(optional\\))?$', 'i').test(norm(text));
}
function findControl(controls,key) {
  const matches=controls.filter(c=>c.visible&&(c.name===key||c.id===key||c.labels.some(s=>fieldMatch(s,key))));
  if(matches.length>1)throw Error('Mais de um controle visível para '+FIELD_NAMES[key]+'.');
  return matches[0]||null;
}
function valueMatches(text,wanted,key) {
  const s=norm(text).toLowerCase().replace(/\s*\(default\)$/,'');
  if(key==='duration')return new RegExp('^'+wanted+'(?:\\s*(?:s|seconds?|segundos?))?$').test(s);
  if(key==='reasoning_level')return s===String(wanted).toLowerCase();
  return s===String(wanted).toLowerCase();
}
function isRunButton(button) {
  if(/^sign in/i.test(button.text||'')||/^sign in/i.test(button.ariaLabel||''))return false;
  return /^Run(?:\s|$|[⌘↵⏎])/i.test(button.text||'')||/^Run\b/i.test(button.ariaLabel||'')
    ||(button.leafTexts||[]).some(text=>/^Run$/i.test(norm(text)));
}
async function formSnapshot(page) {
  return page.evaluate(selector=>{
    const short=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,180);
    const visible=e=>{
      const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;
      for(let p=e;p;p=p.parentElement){const c=getComputedStyle(p);if(p.hidden||p.inert||p.getAttribute('aria-hidden')==='true'||c.display==='none'||c.visibility==='hidden')return false;}
      return true;
    };
    function labels(e) {
      const a=[e.getAttribute('aria-label'),...((e.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent)),
        ...[...(e.labels||[])].map(l=>l.textContent)].filter(Boolean);
      const keys=/^(Duration|Resolution|Aspect Ratio|Generate Audio|Reasoning Level)(?:\s*\*|\s*\(optional\))?$/i;
      for(let p=e.parentElement,depth=0;p&&depth<4;p=p.parentElement,depth++) {
        if(p.querySelectorAll(selector).length!==1)continue;
        for(const label of p.querySelectorAll('label,span,legend'))if(keys.test(short(label.textContent)))a.push(short(label.textContent));
      }
      return [...new Set(a.map(short))];
    }
    const controls=[...document.querySelectorAll(selector)].map((e,index)=>({index,tag:e.tagName,id:e.id,name:e.getAttribute('name'),
      role:e.getAttribute('role'),labels:labels(e),visible:visible(e),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',
      text:short(e.innerText||e.textContent),value:e.tagName==='SELECT'||e.tagName==='INPUT'?e.value:null,
      checked:e.matches('input[type="checkbox"]')?e.checked:e.getAttribute('aria-checked')==='true'||e.getAttribute('data-state')==='checked',
      ariaChecked:e.getAttribute('aria-checked'),dataState:e.getAttribute('data-state')}));
    const buttons=[...document.querySelectorAll('button,[role="tab"]')].map((e,index)=>({index,visible:visible(e),text:short(e.innerText),
      leafTexts:[...e.querySelectorAll('span')].filter(s=>!s.children.length).slice(0,8).map(s=>short(s.innerText)),
      ariaLabel:short(e.getAttribute('aria-label')),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',type:e.getAttribute('type')}));
    const body=document.body?.innerText||'';
    return {url:location.origin+location.pathname,readyState:document.readyState,visibility:document.visibilityState,focused:document.hasFocus(),
      controls,buttons:buttons.slice(0,90),promptFields:[...document.querySelectorAll('textarea')].map(e=>({name:e.name,visible:visible(e),length:e.value.length})),
      offers:(body.match(/Free video up to[^\r\n]{0,200}|\d+\s+free runs? left/gi)||[]).slice(0,6),
      signInToRun:buttons.some(b=>b.visible&&/sign in to run/i.test(b.text)),
      running:/\bIn progress\b|\bQueued\b|\bEm andamento\b/i.test(body)};
  },CONTROL);
}
async function nativeConfigClick(handle) {
  // A single already-identified form control is activated in place. There is no
  // scrollIntoView dependency, and this helper expressly rejects Run/submit.
  await handle.evaluate(e=>{
    const text=(e.innerText||e.getAttribute('aria-label')||'').trim();
    if(/^Run/i.test(text)||e.tagName==='BUTTON'&&e.type==='submit')throw Error('Ação de envio proibida durante preparação.');
    const r=e.getBoundingClientRect(),c=getComputedStyle(e);
    if(!r.width||!r.height||c.display==='none'||c.visibility==='hidden'||e.disabled||e.getAttribute('aria-disabled')==='true')throw Error('Controle deixou de estar disponível.');
    e.click();
  });
}
async function clickNamed(page,name) {
  const candidates=page.locator('button:visible,[role="tab"]:visible').filter({hasText:new RegExp('^\\s*'+name+'\\s*$','i')});
  if(await candidates.count()!==1)return false;
  await nativeConfigClick(candidates);await sleep(300);return true;
}
async function control(page,key) {
  return findControl((await formSnapshot(page)).controls,key);
}
async function setField(page,key,wanted) {
  let item=await control(page,key);
  if(!item)throw Error('Controle sem identificação semântica: '+FIELD_NAMES[key]);
  if(item.disabled)throw Error('Controle desabilitado: '+FIELD_NAMES[key]);
  const current=item.tag==='SELECT'||item.tag==='INPUT'?item.value:item.text;
  if(valueMatches(current,wanted,key))return;
  const locator=page.locator(CONTROL).nth(item.index);
  if(item.tag==='SELECT')await locator.selectOption(String(wanted),{timeout:6000});
  else if(item.tag==='INPUT')await locator.fill(String(wanted),{timeout:6000});
  else {
    await nativeConfigClick(locator);
    const options=page.locator('[role="option"]:visible');
    const until=Date.now()+4000;let candidates=[];
    do {
      candidates=[];
      for(let i=0;i<await options.count();i++)if(valueMatches(await options.nth(i).innerText(),wanted,key))candidates.push(i);
      if(candidates.length)break;await sleep(100);
    }while(Date.now()<until);
    if(candidates.length!==1)throw Error('Opção '+wanted+' de '+FIELD_NAMES[key]+' não é única ou está ausente.');
    await nativeConfigClick(options.nth(candidates[0]));
  }
  await sleep(300);item=await control(page,key);
  if(!item||!valueMatches(item.tag==='SELECT'||item.tag==='INPUT'?item.value:item.text,wanted,key))throw Error('Configuração não persistiu: '+FIELD_NAMES[key]);
}
async function enableAudio(page) {
  const item=await control(page,'generate_audio');
  if(!item)throw Error('Controle Generate Audio não encontrado por rótulo.');
  if(!item.checked)await nativeConfigClick(page.locator(CONTROL).nth(item.index));
  await sleep(250);
  if(!(await control(page,'generate_audio'))?.checked)throw Error('Áudio ativado não confirmado.');
}
async function promptLocator(page) {
  let box=page.locator('textarea[name="prompt"]:visible');
  if(await box.count()===0){await clickNamed(page,'Input');box=page.locator('textarea[name="prompt"]:visible');}
  if(await box.count()!==1)throw Error('É necessário exatamente um textarea visível com name=prompt.');
  return box;
}
async function prepareForm(page,job) {
  const before=await formSnapshot(page);
  if(before.running)throw Error('A página indica uma solicitação em andamento. Preparação interrompida sem preencher.');
  if(before.signInToRun)throw Error('O perfil abriu sem uma sessão autenticada para Run. Nenhum login ou nova conta foi criado.');
  await promptLocator(page);
  // Expanding More is based on absence of the control, not its current value.
  if(!await control(page,'aspect_ratio')||!await control(page,'generate_audio'))await clickNamed(page,'More');
  for(const key of ['duration','resolution','aspect_ratio'])await setField(page,key,job.parameters[key]);
  await enableAudio(page);
  const reasoning=await control(page,'reasoning_level');
  if(reasoning)await setField(page,'reasoning_level',job.parameters.reasoning_level);
  const box=await promptLocator(page);
  await box.fill('',{timeout:8000});
  if(await box.inputValue()!=='')throw Error('Prompt anterior não foi completamente apagado.');
  await box.fill(job.prompt,{timeout:10000});
  for(const delay of [350,850]){
    await sleep(delay);if(hash(await (await promptLocator(page)).inputValue())!==hash(job.prompt))throw Error('React não preservou o prompt completo.');
  }
  const after=await formSnapshot(page),parameters={};
  for(const key of ['duration','resolution','aspect_ratio']){
    const c=findControl(after.controls,key);
    if(!c||!valueMatches(c.tag==='SELECT'||c.tag==='INPUT'?c.value:c.text,job.parameters[key],key))throw Error('Parâmetro mudou após preencher: '+key);
    parameters[key]=job.parameters[key];
  }
  if(!findControl(after.controls,'generate_audio')?.checked)throw Error('Áudio mudou após preencher.');
  parameters.generate_audio=true;
  if(reasoning){
    const c=findControl(after.controls,'reasoning_level');
    if(!c||!valueMatches(c.tag==='SELECT'?c.value:c.text,'high','reasoning_level'))throw Error('Reasoning high não persistiu.');
  }
  parameters.reasoning_level=job.parameters.reasoning_level;
  const run=after.buttons.filter(b=>b.visible&&isRunButton(b));
  if(run.length!==1||run[0].disabled)throw Error('Run visível e habilitado não é único. Os nomes reais dos botões estão no relatório.');
  return {prompt:await (await promptLocator(page)).inputValue(),parameters,
    evidence:{promptLength:job.prompt.length,promptSha256:hash(job.prompt),parameters,
      reasoningAvailable:!!reasoning,run:{text:run[0].text,enabled:true},offers:after.offers}};
}
module.exports={formSnapshot,prepareForm,findControl,valueMatches,fieldMatch,nativeConfigClick,isRunButton};
