# Python / test_launcher.py / Python 3 unittest / real local lock and launcher, Klaus-bots
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]


class LauncherTests(unittest.TestCase):
    def test_import_status_and_dedup_outside_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, KLAUS_DATA_DIR=str(Path(tmp) / 'runtime'))
            batch = Path(tmp) / 'batch.json'
            manifest = json.loads((REPO / 'bots/fal-flux-max/manifest.json').read_text())
            batch.write_text(json.dumps({'schema': 1, 'bot': 'fal-flux-max', 'parameters': manifest['parameters'],
                                         'jobs': [{'id': 'job73_es_fixture', 'prompt': 'offline fixture'}]}))
            def invoke(*args):
                return subprocess.run(['python3', str(REPO / 'klaus.py'), *args], env=env, capture_output=True, text=True, timeout=10)
            first = invoke('importar', 'fal-flux-max', str(batch))
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(json.loads(first.stdout)['added'], 1)
            state = Path(env['KLAUS_DATA_DIR']) / 'fal-flux-max/queue.json'
            fingerprint = hashlib.sha256(state.read_bytes()).hexdigest()
            second = invoke('importar', 'fal-flux-max', str(batch))
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(json.loads(second.stdout)['added'], 0)
            self.assertEqual(hashlib.sha256(state.read_bytes()).hexdigest(), fingerprint)
            status = invoke('status', 'fal-flux-max')
            self.assertEqual(status.returncode, 0, status.stderr)
            info = json.loads(status.stdout)
            self.assertFalse(info['generationEnabled'])
            self.assertEqual(info['jobs'][0]['phase'], 'pending')
            self.assertNotIn('offline fixture', status.stdout)

    def test_legacy_directory_remains_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            legacy = home / 'klaus-fal-robo-v1'
            legacy.mkdir()
            state = legacy / 'state.json'
            state.write_text('{"must":"remain"}')
            env = dict(os.environ, HOME=str(home), KLAUS_DATA_DIR=str(home / 'runtime'))
            result = subprocess.run(['python3', str(REPO / 'klaus.py'), 'status', 'fal-flux-max'], env=env,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(state.read_text(), '{"must":"remain"}')
            self.assertEqual(sorted(p.name for p in legacy.iterdir()), ['state.json'])

    def test_kernel_lock_survives_exec_and_releases_on_signal9(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'checkout'
            (root / 'core').mkdir(parents=True)
            (root / 'bots/fal-flux-max').mkdir(parents=True)
            shutil.copy2(REPO / 'klaus.py', root / 'klaus.py')
            shutil.copy2(REPO / 'bots/fal-flux-max/manifest.json', root / 'bots/fal-flux-max/manifest.json')
            (root / 'core/cli.cjs').write_text(
                '// JavaScript / lock fixture / Node.js 24 / local test\n'
                "require('node:fs').fstatSync(Number(process.env.KLAUS_LOCK_FD));console.log('LOCK_READY');setInterval(()=>{},1000);"
            )
            env = dict(os.environ, KLAUS_DATA_DIR=str(Path(tmp) / 'runtime'))
            child = subprocess.Popen(['python3', str(root / 'klaus.py'), 'status', 'fal-flux-max'],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(child.stdout, selectors.EVENT_READ)
                    self.assertTrue(selector.select(timeout=5), 'Node fixture did not start')
                self.assertEqual(child.stdout.readline().strip(), 'LOCK_READY')
                blocked = subprocess.run(['python3', str(REPO / 'klaus.py'), 'status', 'fal-flux-max'],
                                         env=env, capture_output=True, text=True, timeout=5)
                self.assertNotEqual(blocked.returncode, 0)
                self.assertIn('possui o lock', blocked.stderr)
                os.kill(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
                resumed = subprocess.run(['python3', str(REPO / 'klaus.py'), 'status', 'fal-flux-max'],
                                         env=env, capture_output=True, text=True, timeout=5)
                self.assertEqual(resumed.returncode, 0, resumed.stderr)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
                child.stdout.close()
                child.stderr.close()

    def test_refuses_runtime_inside_checkout(self):
        env = dict(os.environ, KLAUS_DATA_DIR=str(REPO / 'runtime'))
        result = subprocess.run(['python3', str(REPO / 'klaus.py'), 'status', 'fal-flux-max'], env=env,
                                capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fora do repositório', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
