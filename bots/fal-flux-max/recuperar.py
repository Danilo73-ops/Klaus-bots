# Python / recuperar.py / Python 3 + Chromium + Node.js 24 / Termux FLUX original profile
"""Recupera o navegador e prepara o formulário. Não solicita geração."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
DOWNLOADS = Path('/storage/emulated/0/Download')
spec = importlib.util.spec_from_file_location('klaus_diagnostic', HERE / 'diagnostico.py')
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


def cdp_version():
    # The local CDP connection must not be sent through a configured HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open('http://127.0.0.1:9261/json/version', timeout=2) as r:
            value = json.loads(r.read(100000))
        return value if isinstance(value, dict) and value.get('Browser') else None
    except (OSError, ValueError, urllib.error.URLError):
        return None


def inspect_processes(legacy):
    processes = diagnostic.process_inventory(legacy)
    browsers = [p for p in processes if p['originalProfile'] and p['processState'] != 'Z']
    workers = [p for p in processes if p.get('script') and p['processState'] != 'Z']
    return browsers, workers


def snapshot(legacy, folder, include_profile):
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + str(os.getpid())
    target = legacy / 'backups' / ('klaus-bots-preparo-' + stamp)
    target.mkdir(parents=True, mode=0o700, exist_ok=False)
    names = ['robo.cjs', 'fal.sh', 'state.json', 'supervisor-lote06.sh', 'inspecionar-lote06.cjs',
             'lotes/lote06-clean/estado.json', 'lotes/lote06-clean/executor.cjs']
    for name in names:
        source = legacy / name
        if source.is_file() and not source.is_symlink():
            dest = target / name
            dest.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            shutil.copy2(source, dest)
    batch = legacy / 'lotes/lote06_es_25_v1'
    if batch.is_dir() and not batch.is_symlink():
        shutil.copytree(batch, target / 'lote06_es_25_v1', symlinks=True)
    # Chromium may write profile metadata during startup. When offline, copy the entire
    # original profile locally before starting it. No profile bytes enter the report or Git.
    if include_profile:
        print('Backup local do perfil original antes de iniciar o Chromium...', flush=True)
        shutil.copytree(legacy / 'perfil', target / 'perfil', symlinks=True)
    if (folder / 'queue.json').is_file():
        shutil.copy2(folder / 'queue.json', target / 'queue-nova-antes.json')
    return str(target)


def ensure_browser(legacy, folder, report):
    profile = legacy / 'perfil'
    if not profile.is_dir() or profile.is_symlink():
        raise RuntimeError('Perfil original ausente ou simbólico: ' + str(profile))
    browsers, workers = inspect_processes(legacy)
    if workers:
        raise RuntimeError('Há executores antigos do FLUX ativos: ' + ', '.join(str(p['pid']) + ':' + p['script'] for p in workers)
                           + '. Nenhum novo navegador será iniciado enquanto eles puderem enviar trabalhos.')
    alive = cdp_version()
    if alive:
        if not browsers:
            raise RuntimeError('Porta 9261 responde, mas não foi possível confirmar o perfil original em /proc. Sessão preservada.')
        report['backup'] = snapshot(legacy, folder, False)
        report['browserReused'] = True
        report['browser'] = alive.get('Browser')
        print('Chromium original já responde; reutilizando a sessão.', flush=True)
        return
    if browsers:
        raise RuntimeError('Chromium do perfil original está vivo sem CDP 9261. Nenhum segundo processo foi aberto: '
                           + ', '.join(str(p['pid']) for p in browsers))
    binary = shutil.which('chromium-browser') or shutil.which('chromium')
    if not binary:
        raise RuntimeError('Chromium não encontrado no Termux.')
    report['backup'] = snapshot(legacy, folder, True)
    # Check again after the potentially long backup to avoid starting a second owner.
    browsers, workers = inspect_processes(legacy)
    if browsers or workers or cdp_version():
        raise RuntimeError('Outro processo FLUX apareceu durante o backup. A sessão foi preservada.')
    env = dict(os.environ)
    for key in ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'KLAUS_LOCK_FD']:
        env.pop(key, None)
    log = folder / ('chromium-' + str(time.time_ns()) + '.log')
    args = [binary, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--disable-features=Vulkan', '--no-first-run', '--no-default-browser-check',
            '--window-size=1280,960', '--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=9261', '--user-data-dir=' + str(profile), 'about:blank']
    print('Iniciando uma sessão headless na porta 9261 com o perfil original...', flush=True)
    with log.open('xb') as stream:
        proc = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=stream,
                                stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    report['browserLaunched'] = {'pid': proc.pid, 'headless': True, 'log': str(log)}
    for _ in range(50):
        version = cdp_version()
        if version:
            report['browser'] = version.get('Browser')
            print('CDP 9261 conectado. Prosseguindo para o formulário.', flush=True)
            return
        if proc.poll() is not None:
            break
        time.sleep(0.5)
    report['chromiumLogTail'] = diagnostic.scrub(log.read_text(errors='replace')[-16000:])
    raise RuntimeError('Chromium não disponibilizou CDP 9261. Tentativa única; confira o relatório.')


def prepare(repo, folder, manifest, lock_fd):
    legacy = Path.home() / manifest['legacyDirectory']
    downloads = DOWNLOADS
    report = {'schema': 1, 'mode': 'preflight-no-generation', 'bot': manifest['id'],
              'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'generationRequested': False}
    print('KLAUS FLUX | recuperar navegador e preparar formulário', flush=True)
    try:
        if not legacy.is_dir():
            raise RuntimeError('Projeto original não encontrado: ' + str(legacy))
        ensure_browser(legacy, folder, report)
        wake = shutil.which('termux-wake-lock')
        if wake:
            subprocess.run([wake], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False)
        env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH='0')
        modules = str(Path.home() / 'youcine-capture/node_modules')
        env['NODE_PATH'] = os.pathsep.join(filter(None, [env.get('NODE_PATH'), modules]))
        print('Importando os pendentes locais e conferindo os cinco parâmetros. Run permanece bloqueado nesta etapa.', flush=True)
        result = subprocess.run(['node', str(HERE / 'preparar.cjs')], env=env, pass_fds=(lock_fd,),
                                capture_output=True, text=True, timeout=100, check=False)
        try:
            report['preflight'] = json.loads(result.stdout)
        except ValueError:
            report['preflight'] = {'error': 'Saída de preparação inválida', 'stdout': result.stdout[-12000:]}
        report['preflightExitCode'] = result.returncode
        if result.stderr.strip():
            report['events'] = result.stderr[-16000:]
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        report['error'] = str(error)
    finally:
        stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + str(os.getpid())
        output_folder = downloads if downloads.is_dir() else folder
        output = output_folder / ('KLAUS-FLUX-PREPARO-' + stamp + '.json')
        with output.open('x', encoding='utf-8') as f:
            json.dump(diagnostic.clean_json(report), f, ensure_ascii=False, indent=2)
        print('RELATÓRIO: ' + str(output), flush=True)
        details = report.get('preflight', {})
        if details.get('prepared'):
            print('FORMULÁRIO PREPARADO: ' + details['job'] + '; 15s, 720p, 9:16, áudio, reasoning high quando disponível.', flush=True)
        else:
            print('PREPARAÇÃO PENDENTE: ' + str(report.get('error') or details.get('error') or 'confira o relatório'), flush=True)
        print('Nenhum Run foi acionado por este comando. Anexe o relatório JSON neste chat.', flush=True)
    return bool(report.get('preflight', {}).get('prepared'))
