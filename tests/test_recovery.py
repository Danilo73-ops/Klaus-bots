# Python / test_recovery.py / Python 3 unittest / isolated Chromium recovery tests, no real browser
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recovery', REPO / 'bots/fal-flux-max/recuperar.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryTests(unittest.TestCase):
    def fixture(self, tmp):
        root = Path(tmp) / 'legacy'
        folder = Path(tmp) / 'runtime'
        (root / 'perfil').mkdir(parents=True)
        folder.mkdir()
        (root / 'perfil/Cookies').write_bytes(b'private-local-browser-database')
        (root / 'state.json').write_text('{"jobs":{}}')
        (root / 'robo.cjs').write_text('// keep original robot')
        return root, folder

    def test_offline_start_backs_up_entire_profile_and_uses_headless_original_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, folder = self.fixture(tmp)
            original = (root / 'perfil/Cookies').read_bytes()
            report = {}
            fake = Mock(pid=12345)
            fake.poll.return_value = None
            with patch.object(recovery, 'inspect_processes', return_value=([], [])), \
                 patch.object(recovery, 'cdp_version', side_effect=[None, None, {'Browser': 'Test Chromium'}]), \
                 patch.object(recovery.shutil, 'which', return_value='/test/chromium-browser'), \
                 patch.object(recovery.subprocess, 'Popen', return_value=fake) as launch, \
                 patch.dict(os.environ, {'DISPLAY': ':0', 'DBUS_SESSION_BUS_ADDRESS': 'original-value'}):
                recovery.ensure_browser(root, folder, report)
                args = launch.call_args.args[0]
                self.assertIn('--headless=new', args)
                self.assertIn('--user-data-dir=' + str(root / 'perfil'), args)
                self.assertNotIn('DISPLAY', launch.call_args.kwargs['env'])
                self.assertEqual(os.environ['DISPLAY'], ':0')
                self.assertEqual(os.environ['DBUS_SESSION_BUS_ADDRESS'], 'original-value')
            self.assertEqual((Path(report['backup']) / 'perfil/Cookies').read_bytes(), original)
            self.assertEqual((root / 'perfil/Cookies').read_bytes(), original)
            self.assertEqual((root / 'robo.cjs').read_text(), '// keep original robot')
            self.assertEqual(report['browserLaunched']['pid'], 12345)
            self.assertEqual(launch.call_count, 1)

    def test_existing_browser_is_reused_without_profile_copy_or_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, folder = self.fixture(tmp)
            report = {}
            with patch.object(recovery, 'inspect_processes', return_value=([{'pid': 7}], [])), \
                 patch.object(recovery, 'cdp_version', return_value={'Browser': 'Test Chromium'}), \
                 patch.object(recovery.subprocess, 'Popen') as launch:
                recovery.ensure_browser(root, folder, report)
            launch.assert_not_called()
            self.assertTrue(report['browserReused'])
            self.assertFalse((Path(report['backup']) / 'perfil').exists())

    def test_live_profile_without_cdp_is_never_started_twice(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, folder = self.fixture(tmp)
            with patch.object(recovery, 'inspect_processes', return_value=([{'pid': 7}], [])), \
                 patch.object(recovery, 'cdp_version', return_value=None), \
                 patch.object(recovery.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(RuntimeError, 'Nenhum segundo processo'):
                    recovery.ensure_browser(root, folder, {})
            launch.assert_not_called()

    def test_old_workers_prevent_browser_start_without_killing_anything(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, folder = self.fixture(tmp)
            with patch.object(recovery, 'inspect_processes', return_value=([], [{'pid': 7, 'script': 'robo.cjs'}])), \
                 patch.object(recovery.subprocess, 'Popen') as launch, \
                 patch.object(os, 'kill') as kill:
                with self.assertRaisesRegex(RuntimeError, 'executores antigos'):
                    recovery.ensure_browser(root, folder, {})
            launch.assert_not_called()
            kill.assert_not_called()

    def test_port_for_unconfirmed_profile_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, folder = self.fixture(tmp)
            with patch.object(recovery, 'inspect_processes', return_value=([], [])), \
                 patch.object(recovery, 'cdp_version', return_value={'Browser': 'Other Chromium'}), \
                 patch.object(recovery.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(RuntimeError, 'confirmar o perfil original'):
                    recovery.ensure_browser(root, folder, {})
            launch.assert_not_called()

    def test_preparation_failure_returns_false_and_still_saves_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, folder = self.fixture(tmp)
            downloads = Path(tmp) / 'Download'
            downloads.mkdir()
            with patch.object(recovery.Path, 'home', return_value=Path(tmp)), \
                 patch.object(recovery, 'DOWNLOADS', downloads), \
                 patch.object(recovery, 'ensure_browser', side_effect=RuntimeError('fixture CDP unavailable')):
                result = recovery.prepare(REPO, folder, {'id': 'fal-flux-max', 'legacyDirectory': 'legacy'}, 3)
            self.assertFalse(result)
            files = list(downloads.glob('KLAUS-FLUX-PREPARO-*.json'))
            self.assertEqual(len(files), 1)
            report = json.loads(files[0].read_text())
            self.assertFalse(report['generationRequested'])
            self.assertEqual(report['error'], 'fixture CDP unavailable')


if __name__ == '__main__':
    unittest.main(verbosity=2)
