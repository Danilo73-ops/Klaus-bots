# Python / klaus_flux_diagnostico.py / Python 3 + Node.js 24 / Termux Android, Klaus FLUX MAX
"""Coleta local de leitura. Não executa o robô nem envia solicitações de geração."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

VERSION = "1.1.0"
JOB = re.compile(r"^job(?:7[1-9]|8\d|9[0-5])(?:_|\.)")
SENSITIVE = re.compile(
    r"^(?:authorization|proxy.?authorization|cookies?|set.?cookie|headers?|"
    r"password|passwd|api.?key|fal.?key|credentials?|secrets?|.*token|"
    r"localstorage|sessionstorage|storagestate)$", re.I
)
KEY_LITERAL = re.compile(
    r"(?i)([\"'`]?(?:authorization|cookies?|password|passwd|api[_-]?key|"
    r"fal[_-]?key|(?:access[_-]?|refresh[_-]?)?token|secret|credentials)"
    r"[\"'`]?\s*[:=]\s*)([\"'`])((?:\\.|(?!\2)[^\r\n\\])*)(\2)"
)
URL = re.compile(r"https?://[^\s\"'`<>\\]+")

# Only Runtime.evaluate is sent to already-open, matching Playground targets.
# No DOM mutations, clicks, scrolling, navigation, cookies, storage or fetch calls.
CDP_JS = r'''// JavaScript / embedded diagnostic / Node.js 24 / existing CDP 9261
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const targetPath = '/models/blackforestlabs/flux-3-max/text-to-video';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function getJSON(route) {
  return new Promise((resolve, reject) => {
    const req = http.get({hostname:'127.0.0.1',port:9261,path:route}, res => {
      const parts=[]; let size=0;
      res.on('data', c=>{size+=c.length;if(size>2*1024*1024)res.destroy(new Error('CDP response too large'));else parts.push(c);});
      res.on('error',reject);
      res.on('end',()=>{try{if(res.statusCode!==200)throw Error('CDP HTTP '+res.statusCode);resolve(JSON.parse(Buffer.concat(parts).toString()));}catch(e){reject(e);}});
    });
    req.setTimeout(3500,()=>req.destroy(new Error('CDP HTTP timeout')));
    req.on('error', reject);
  });
}
function inspectDOM() {
  const short=(s,n=180)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,n);
  const identity=e=>e?{tag:e.tagName,id:e.id||null,role:e.getAttribute('role'),
    name:e.getAttribute('name'),testid:e.getAttribute('data-testid'),
    classes:short(typeof e.className==='string'?e.className:'',260)}:null;
  function describe(e) {
    const r=e.getBoundingClientRect(),c=getComputedStyle(e);
    const x=Math.max(0,Math.min(innerWidth-1,r.x+r.width/2));
    const y=Math.max(0,Math.min(innerHeight-1,r.y+r.height/2));
    const intersects=r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
    const top=intersects?document.elementFromPoint(x,y):null;
    const labelled=(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ');
    const labels=[...(e.labels||[])].map(l=>short(l.textContent));
    const ancestors=[];
    for(let p=e.parentElement;p&&ancestors.length<10;p=p.parentElement){
      const s=getComputedStyle(p),b=p.getBoundingClientRect();
      ancestors.push({...identity(p),display:s.display,visibility:s.visibility,
        overflowX:s.overflowX,overflowY:s.overflowY,position:s.position,
        rect:{x:b.x,y:b.y,width:b.width,height:b.height},
        scrollTop:p.scrollTop,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight,
        ariaHidden:p.getAttribute('aria-hidden'),inert:!!p.inert});
    }
    return {...identity(e),text:short(e.innerText),labels,labelled:short(labelled),
      ariaLabel:short(e.getAttribute('aria-label')),placeholder:short(e.getAttribute('placeholder')),
      ariaControls:e.getAttribute('aria-controls'),ariaExpanded:e.getAttribute('aria-expanded'),
      ariaDisabled:e.getAttribute('aria-disabled'),ariaChecked:e.getAttribute('aria-checked'),
      checked:typeof e.checked==='boolean'?e.checked:null,disabled:!!e.disabled,
      dataState:e.getAttribute('data-state'),hidden:!!e.hidden,inert:!!e.inert,
      type:e.getAttribute('type'),form:identity(e.form||e.closest('form')),
      rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      css:{display:c.display,visibility:c.visibility,opacity:c.opacity,
        pointerEvents:c.pointerEvents,position:c.position,transform:c.transform},
      hasLayout:!!e.getClientRects().length,intersectsViewport:intersects,
      receivesCenterPoint:!!top&&(e===top||e.contains(top)),centerTop:identity(top),ancestors};
  }
  const fields=[...document.querySelectorAll('textarea,input[name="prompt"],[contenteditable="true"]')].slice(0,32).map(e=>({
    ...describe(e),rawValue:typeof e.value==='string'?e.value:(e.textContent||'')
  }));
  const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(e=>
    /^(Run(?:\s|$)|Sign in to run$|Reset$|More$|Input$|Result$)/i.test((e.innerText||e.getAttribute('aria-label')||'').trim())
  ).slice(0,48).map(describe);
  const controls=[...document.querySelectorAll('[role="combobox"],select,[role="switch"],input[type="checkbox"]')].slice(0,48).map(e=>({
    ...describe(e),value:e.tagName==='SELECT'?e.value:null,
    selectedOptions:e.tagName==='SELECT'?[...e.selectedOptions].map(o=>({value:o.value,text:short(o.textContent)})):null
  }));
  // Read the structure near the advanced-field captions. These fields can be
  // rendered as buttons or radio groups rather than comboboxes/switches.
  const thin=e=>({
    ...identity(e),text:short(e.innerText,90),ariaLabel:short(e.getAttribute('aria-label'),90),
    ariaLabelledby:e.getAttribute('aria-labelledby'),type:e.getAttribute('type'),
    value:e.matches('select,input:not([name="prompt"])')?short(e.value,60):null,
    checked:typeof e.checked==='boolean'?e.checked:null,
    ariaChecked:e.getAttribute('aria-checked'),dataState:e.getAttribute('data-state'),
    disabled:!!e.disabled,visible:!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'
  });
  const captions=/^(?:Aspect Ratio|Generate Audio|Reasoning Level|Duration|Resolution|More)$/i;
  const matches=[...document.querySelectorAll('label,legend,span,p,div')].filter(e=>{
    if(!captions.test(short(e.textContent,80)))return false;
    return ![...e.children].some(child=>captions.test(short(child.textContent,80)));
  }).slice(0,24);
  const fieldRegions=matches.map(e=>{
    const ancestors=[];
    for(let p=e.parentElement;p&&ancestors.length<7;p=p.parentElement){
      const children=[...p.querySelectorAll('button,[role="radio"],[role="switch"],[role="combobox"],select,input')]
        .filter(c=>c.getAttribute('name')!=='prompt').slice(0,16).map(thin);
      ancestors.push({...identity(p),text:p.querySelector('textarea')?null:short(p.innerText,250),
        children,childCount:p.querySelectorAll('button,[role="radio"],[role="switch"],[role="combobox"],select,input').length});
      if(children.length>1&&ancestors.length>=2)break;
    }
    return {caption:short(e.textContent,80),element:thin(e),ancestors};
  });
  const formControls=[...document.querySelectorAll('form button,form input,form select,form [role="radio"],form [role="switch"],form [role="combobox"]')]
    .filter(e=>e.getAttribute('name')!=='prompt').slice(0,80).map(thin);
  const body=document.body?.innerText||'';
  const status=body.match(/(?:Free video up to[^\r\n]{0,180}|\d+\s+free runs? left)/gi)||[];
  const resources=performance.getEntriesByType('resource').filter(e=>{
    try{return /(^|\.)fal\.(ai|run|media)$/.test(new URL(e.name).hostname);}catch{return false;}
  }).slice(-60).map(e=>{const u=new URL(e.name);return {origin:u.origin,path:u.pathname,
    queryKeys:[...u.searchParams.keys()],initiator:e.initiatorType,startTime:e.startTime,duration:e.duration};});
  const results=[...document.querySelectorAll('[data-testid="result"],[role="tabpanel"]')].slice(0,12).map(e=>({
    identity:identity(e),hidden:e.hidden,ariaHidden:e.getAttribute('aria-hidden'),
    hasLayout:!!e.getClientRects().length,
    inProgress:/\bIn progress\b|\bQueued\b|\bEm andamento\b/i.test(e.innerText||''),
    completed:/\bCompleted\b|\bConclu[ií]do\b/i.test(e.innerText||''),
    contentBlocked:/material flagged by a content checker/i.test(e.innerText||'')
  }));
  return {readyState:document.readyState,visibility:document.visibilityState,focused:document.hasFocus(),
    viewport:{width:innerWidth,height:innerHeight,devicePixelRatio,scrollX,scrollY},
    fields,buttons,controls,fieldRegions,formControls,offers:status.slice(0,8),results,resources,
    flags:{contentBlocked:/material flagged by a content checker/i.test(body),
      inputValidationError:/Error validating the input/i.test(body),
      inProgress:/\bIn progress\b|\bQueued\b|\bEm andamento\b/i.test(body)},
    videoCount:document.querySelectorAll('video').length,
    mp4Links:[...document.querySelectorAll('a[href]')].filter(e=>/\.mp4(?:[?#]|$)/i.test(e.href)).slice(0,16).map(e=>{
      const u=new URL(e.href);return {origin:u.origin,path:u.pathname,label:short(e.innerText)};
    })};
}
async function inspectTarget(t) {
  const u=new URL(t.webSocketDebuggerUrl);
  if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.port!=='9261'||u.protocol!=='ws:')throw Error('Unexpected CDP address');
  const ws=new WebSocket(u); let serial=0;
  const pending=new Map();
  const abort=err=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(err);}pending.clear();};
  ws.addEventListener('message',ev=>{
    let m;try{m=JSON.parse(String(ev.data));}catch{return;}
    const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);
    if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);
  });
  ws.addEventListener('close',()=>abort(Error('CDP disconnected')));
  ws.addEventListener('error',()=>abort(Error('CDP WebSocket error')));
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('CDP WebSocket open timeout')),4500);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP WebSocket open error'));},{once:true});
    });
    const call=(method,params)=>new Promise((resolve,reject)=>{
      const id=++serial;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},8000);
      pending.set(id,{resolve,reject,timer});
      try{ws.send(JSON.stringify({id,method,params}));}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
    const samples=[];
    for(let i=0;i<2;i++){
      if(i)await sleep(1200);
      const r=await call('Runtime.evaluate',{expression:'('+inspectDOM.toString()+')()',returnByValue:true,timeout:6000});
      if(r.exceptionDetails)throw Error('DOM evaluation failed: '+(r.exceptionDetails.text||'unknown'));
      const sample=r.result?.value;
      if(!sample||!Array.isArray(sample.fields))throw Error('DOM result unavailable');
      for(const f of sample.fields){const s=f.rawValue||'';f.valueLength=s.length;f.valueSha256=hash(s);f.trimmedSha256=hash(s.trim());delete f.rawValue;}
      samples.push(sample);
    }
    return {targetId:t.id,url:'https://fal.ai'+targetPath,samples};
  } finally {abort(Error('Diagnostic completed'));try{ws.close();}catch{}}
}
(async()=>{
  const output={node:process.version,readOnly:true,port:9261,tabs:[],errors:[]};
  try{
    const version=await getJSON('/json/version');
    output.browser={Browser:version.Browser,ProtocolVersion:version['Protocol-Version']};
    const targets=await getJSON('/json/list');
    const matching=targets.filter(t=>{try{const u=new URL(t.url);return t.type==='page'&&u.hostname==='fal.ai'&&u.pathname.replace(/\/$/,'')===targetPath;}catch{return false;}});
    output.matchingTabs=matching.length;
    // Two current tabs are enough to distinguish a duplicate page without stalling on many stale targets.
    for(const t of matching.slice(0,2)){
      try{output.tabs.push(await inspectTarget(t));}catch(e){output.errors.push({targetId:t.id,error:e.message});}
    }
    if(matching.length>2)output.errors.push({error:'More than two matching tabs; only the first two were inspected.'});
  }catch(e){output.errors.push({error:e.message});}
  console.log(JSON.stringify(output));
})().catch(e=>{console.log(JSON.stringify({readOnly:true,error:e.message}));process.exitCode=1;});
'''


def scrub(text: str) -> str:
    text = KEY_LITERAL.sub(lambda m: m[1] + m[2] + "[REDACTED]" + m[4], text)
    text = re.sub(r"(?im)^(\s*(?:export\s+)?(?:FAL_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD|SECRET)\s*=\s*)[^\r\n]*",
                  r"\1[REDACTED]", text)
    text = re.sub(r"(?im)^\s*(?:authorization|cookie|set-cookie|x-api-key)\s*:[^\r\n]*", "[REDACTED HEADER]", text)
    text = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]", text)
    text = re.sub(r"\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{16,})", "[REDACTED TOKEN]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+", "[REDACTED JWT]", text)
    text = re.sub(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[REDACTED EMAIL]", text)
    def clean_url(m):
        # Retain origin/path for debugging; exclude userinfo, signed queries and fragments.
        value = m[0].split("?", 1)[0].split("#", 1)[0]
        return re.sub(r"^(https?://)[^/]*@", r"\1", value)
    return URL.sub(clean_url, text)


def clean_json(value, depth=0):
    if depth > 40:
        return "[DEPTH LIMIT]"
    if isinstance(value, dict):
        return {k: "[REDACTED]" if SENSITIVE.match(str(k)) else clean_json(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_json(v, depth + 1) for v in value]
    return scrub(value) if isinstance(value, str) else value


def command(args, *, timeout=12, env=None, stdin=None):
    try:
        r = subprocess.run(args, input=stdin, capture_output=True, text=True,
                           timeout=timeout, env=env, check=False)
        return {"returncode": r.returncode, "stdout": scrub(r.stdout[-3_000_000:]),
                "stderr": scrub(r.stderr[-4000:])}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"error": scrub(str(e))}


def under(path: Path, root: Path) -> bool:
    try:
        if not path.resolve().is_relative_to(root.resolve()):
            return False
        # Do not follow symlinked files or subdirectories while collecting source.
        current = path.absolute()
        base = root.absolute()
        while current != base:
            if current.is_symlink() or current == current.parent:
                return False
            current = current.parent
        return True
    except OSError:
        return False


def process_inventory(root: Path):
    result = []
    for p in Path("/proc").iterdir():
        if not p.name.isdecimal() or int(p.name) == os.getpid():
            continue
        try:
            args = [x.decode(errors="replace") for x in (p / "cmdline").read_bytes().split(b"\0") if x]
            if not args:
                continue
            exe = Path(args[0]).name
            profile = str(root / "perfil")
            profile_match = any(a == f"--user-data-dir={profile}" for a in args)
            profile_match |= any(args[i] == "--user-data-dir" and args[i+1] == profile for i in range(len(args)-1))
            script = None
            if re.match(r"^(?:node|python|bash|sh)", exe):
                for a in args[1:4]:
                    if not a.endswith((".cjs", ".js", ".py", ".sh")):
                        continue
                    candidate = Path(a)
                    if not candidate.is_absolute():
                        candidate = (p / "cwd").resolve() / candidate
                    if under(candidate, root):
                        script = str(candidate.relative_to(root))
                        break
            if not (profile_match or script):
                continue
            stat = (p / "stat").read_text().rsplit(")", 1)[1].split()
            result.append({"pid": int(p.name), "parentPid": int(stat[1]),
                           "processState": stat[0], "startTicks": stat[19],
                           "executable": exe, "script": script,
                           "originalProfile": profile_match,
                           "headless": any(a.startswith("--headless") for a in args),
                           "cdp9261": "--remote-debugging-port=9261" in args})
        except (OSError, ValueError, IndexError):
            continue
    return result


def probe_file(p: Path):
    item = {"path": str(p), "bytes": p.stat().st_size, "modifiedNs": p.stat().st_mtime_ns}
    if not shutil.which("ffprobe"):
        item["probeError"] = "ffprobe não encontrado"
        return item
    result = command(["ffprobe", "-v", "error", "-show_entries",
                      "format=duration,size,format_name:stream=codec_type,codec_name,width,height,duration",
                      "-of", "json", str(p)], timeout=10)
    if result.get("returncode") == 0:
        try:
            item["probe"] = json.loads(result["stdout"])
        except ValueError:
            item["probeError"] = "ffprobe retornou JSON inválido"
    else:
        item["probeError"] = result
    return item


def collect(root: Path, downloads: Path, output: Path):
    if not root.is_dir():
        raise RuntimeError("Pasta do projeto não encontrada: " + str(root))
    if not downloads.is_dir():
        raise RuntimeError("Pasta Download inacessível: " + str(downloads))
    report = {"version": VERSION, "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "readOnly": True, "root": str(root), "missing": [], "warnings": [],
              "files": [], "processes": process_inventory(root), "jobs": {}, "mp4s": []}
    entries = {}
    total_bytes = 0

    def add_file(p: Path, name: str, *, tail=False):
        nonlocal total_bytes
        boundary = downloads if p.parent == downloads else root
        if not under(p, boundary) or not p.is_file():
            report["missing"].append(name)
            return
        if any(part.lower() in {"perfil", "node_modules", "cookies", ".git", "backups"} for part in Path(name).parts):
            report["warnings"].append("Caminho privado excluído: " + name)
            return
        try:
            size = p.stat().st_size
            if size > 2_000_000 and not tail:
                report["warnings"].append("Arquivo acima de 2 MB omitido: " + name)
                return
            with p.open("rb") as f:
                if tail:
                    f.seek(max(0, size - 160_000))
                raw = f.read(2_000_001)
            text = raw.decode("utf-8", errors="replace")
            parsed = None
            if p.suffix == ".json" and not tail:
                try:
                    parsed = json.loads(text)
                    cleaned = json.dumps(clean_json(parsed), ensure_ascii=False, indent=2)
                except ValueError:
                    cleaned = scrub(text)
                    report["warnings"].append("JSON inválido ou alterado durante a leitura: " + name)
            else:
                cleaned = scrub(text)
            payload = cleaned.encode("utf-8")
            if total_bytes + len(payload) > 12_000_000:
                report["warnings"].append("Limite de 12 MB atingido; omitido: " + name)
                return
            entries[name] = payload
            total_bytes += len(payload)
            report["files"].append({"name": name, "originalBytes": size,
                                    "capturedBytes": len(raw), "tailOnly": tail,
                                    "capturedSha256": hashlib.sha256(raw).hexdigest(),
                                    "redacted": cleaned != text})
            if isinstance(parsed, dict) and isinstance(parsed.get("jobs"), dict):
                report["jobs"][name] = {k: clean_json(v) for k, v in parsed["jobs"].items() if JOB.match(k + "_")}
        except OSError as e:
            report["warnings"].append(name + ": " + scrub(str(e)))

    required = ["robo.cjs", "fal.sh", "state.json", "supervisor-lote06.sh", "inspecionar-lote06.cjs",
                "lotes/lote06-clean/executor.cjs", "lotes/lote06-clean/estado.json",
                "lotes/lote06-clean/log_atual", "lotes/lote06-clean/pid"]
    for rel in required:
        add_file(root / rel, "projeto/" + rel)
    # Only named batch-06 tools are included, never generic config or profile directories.
    for pattern in ("supervisor-lote06*.sh", "inspecionar-lote06*.cjs"):
        for p in sorted(root.glob(pattern))[:12]:
            if "projeto/" + p.name not in entries:
                add_file(p, "projeto/" + p.name)
    for rel in ("lotes/lote06_es_25_v1", "fila"):
        folder = root / rel
        if not under(folder, root) or not folder.is_dir():
            report["missing"].append("projeto/" + rel)
            continue
        for p in sorted(folder.iterdir()):
            if p.suffix == ".txt" and JOB.match(p.name):
                add_file(p, "projeto/" + rel + "/" + p.name)
    for name in ("klaus_flux_lote06_25_es.sh", "klaus_flux_reinicio_limpo_lote06.py",
                 "klaus_flux_fix_visual_prompt_v2.py", "klaus_flux_fix_tab_react06.py"):
        p = downloads / name
        if p.exists():
            add_file(p, "instaladores/" + name)
    logs = []
    logdir = root / "logs"
    if under(logdir, root) and logdir.is_dir():
        logs = [p for p in logdir.iterdir() if under(p, root) and p.is_file()
                and re.search(r"lote06|flux06|clean06", p.name, re.I)]
    pointer = root / "lotes/lote06-clean/log_atual"
    if under(pointer, root) and pointer.is_file():
        try:
            if pointer.stat().st_size <= 4096:
                p = Path(pointer.read_text().strip())
                if not p.is_absolute():
                    p = root / p
                if under(p, logdir) and p.is_file():
                    logs.append(p)
        except OSError:
            pass
    for p in sorted(set(logs), key=lambda p: p.stat().st_mtime, reverse=True)[:6]:
        add_file(p, "logs/" + p.name, tail=True)

    env = os.environ.copy()
    env["PLAYWRIGHT_BROWSERS_PATH"] = "0"
    fallback = str(Path.home() / "youcine-capture/node_modules")
    env["NODE_PATH"] = os.pathsep.join(filter(None, (env.get("NODE_PATH"), fallback)))
    report["runtime"] = {"python": sys.version.split()[0], "node": command(["node", "--version"]),
                         "ffprobe": shutil.which("ffprobe"), "chromium": shutil.which("chromium-browser") or shutil.which("chromium"),
                         "playwright": command(["node", "-e", "console.log(JSON.stringify({path:require.resolve('playwright-core'),version:require('playwright-core/package.json').version}));"], env=env)}
    print("Lendo campos e botões pela porta 9261; nenhum clique será feito...", flush=True)
    observed = command(["node", "-e", CDP_JS], env=env, timeout=48)
    try:
        report["browser"] = clean_json(json.loads(observed.get("stdout", "")))
    except ValueError:
        report["browser"] = {"readOnly": True, "collectorError": observed}

    videos = []
    for lang in ("ESPANHOL", "PT BR"):
        folder = downloads / "KLAUS AUT. FLUX MAX" / lang
        if not under(folder, downloads) or not folder.is_dir():
            continue
        for p in folder.iterdir():
            if under(p, folder) and p.is_file() and JOB.match(p.name) and p.suffix.lower() in {".mp4", ".part"}:
                videos.append(p)
    print("Conferindo metadados dos MP4 existentes; os vídeos não entram no ZIP...", flush=True)
    if len(videos) > 60:
        report["warnings"].append("Mais de 60 arquivos candidatos; inventário limitado a 60.")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for item in pool.map(probe_file, sorted(videos)[:60]):
            report["mp4s"].append(item)
    entries["diagnostico.json"] = json.dumps(clean_json(report), ensure_ascii=False, indent=2).encode("utf-8")
    entries["LEIA-ME.txt"] = (
        "KLAUS FLUX MAX — diagnóstico de leitura\n"
        "Nenhum processo foi iniciado, encerrado ou reiniciado pelo coletor.\n"
        "Nenhum clique, preenchimento, navegação ou pedido de geração foi feito.\n"
        "Os arquivos originais não foram alterados. Os arquivos no ZIP são cópias para análise.\n"
        "Não inclui perfil Chromium, cookies, storage, .env, credenciais, backups ou vídeos.\n"
        "Campos conhecidos de credenciais, cabeçalhos e URLs assinadas foram filtrados das cópias.\n"
        "A existência de um processo ou fase local não confirma uma geração no fal.ai.\n"
        "O diagnóstico da interface registra duas amostras sem interação.\n"
        "Se o CDP estiver offline, os arquivos e logs continuam disponíveis para análise.\n"
    ).encode("utf-8")
    # Exclusive creation: even a repeated invocation cannot replace an existing archive.
    try:
        with output.open("xb") as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as z:
                for name, payload in entries.items():
                    z.writestr(name, payload)
    except FileExistsError:
        raise RuntimeError("O destino já existe; nenhum arquivo foi sobrescrito: " + str(output))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / "klaus-fal-robo-v1")
    parser.add_argument("--download", type=Path, default=Path("/storage/emulated/0/Download"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.absolute()
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    output = args.output or args.download / f"KLAUS-FLUX-DIAGNOSTICO-{stamp}-{os.getpid()}.zip"
    print("KLAUS FLUX MAX | diagnóstico de leitura " + VERSION, flush=True)
    report = collect(root, args.download, output)
    print("ZIP criado: " + str(output), flush=True)
    print(f"Arquivos de análise: {len(report['files'])}; vídeos inventariados: {len(report['mp4s'])}.", flush=True)
    browser = report.get("browser", {})
    print("Abas FLUX encontradas: " + str(browser.get("matchingTabs", "CDP indisponível")), flush=True)
    if browser.get("errors") or browser.get("collectorError"):
        print("A leitura do navegador teve limitações; o motivo está no ZIP.", flush=True)
    print("Envie esse ZIP neste chat. Nenhuma geração foi solicitada pelo coletor.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Coleta interrompida. Nenhum arquivo do projeto foi alterado.", file=sys.stderr)
        sys.exit(130)
    except (RuntimeError, OSError, ValueError) as e:
        print("Diagnóstico não concluído: " + str(e), file=sys.stderr)
        sys.exit(1)
