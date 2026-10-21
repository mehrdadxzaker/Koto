"""Exercise compiled patches through the pinned offline native patch parser."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

from hormuz.local_text_patch import compile_text_patch


CLIENT = Path('/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/'
              'codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex')
CLIENT_SHA256 = '112fae7a5a1223e673c8a1791d32338f37df8b527ff1159bb8adac6c4dbf1b4b'
FLAG = '--codex-run-as-apply-patch'


@unittest.skipUnless(sys.platform == 'darwin' and CLIENT.is_file()
    and Path('/usr/bin/sandbox-exec').is_file(), 'Requires pinned native Codex and macOS sandbox')
class LocalTextPatchWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        binary = CLIENT.read_bytes()
        if hashlib.sha256(binary).hexdigest() != CLIENT_SHA256:
            raise unittest.SkipTest('Installed native Codex differs from the reviewed parser pin')
        if FLAG.encode() not in binary:
            raise unittest.SkipTest('Pinned native binary lacks the reviewed parser entry point')

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='koto-native-text-patch-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.workspace = self.root / 'workspace'; self.workspace.mkdir()

    def apply(self, edit):
        patch = compile_text_patch(edit)
        policy = ('(version 1)(allow default)(deny network*)(deny file-write*)'
                  '(allow file-write* (subpath ' + json.dumps(str(self.workspace.resolve())) + '))')
        bootstrap = ('import os,resource,sys\n'
            'resource.setrlimit(resource.RLIMIT_CPU,(2,2))\n'
            'resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))\n'
            'resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))\n'
            'os.execv(sys.argv[1],sys.argv[1:])\n')
        with tempfile.TemporaryFile(dir=self.workspace) as stdout, tempfile.TemporaryFile(dir=self.workspace) as stderr:
            process = subprocess.Popen(['/usr/bin/sandbox-exec', '-p', policy,
                sys.executable, '-I', '-B', '-c', bootstrap, str(CLIENT), FLAG, patch],
                cwd=self.workspace, env={'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8'},
                stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                process.wait(timeout=4)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=1)
            stdout.seek(0); stderr.seek(0)
            result = {'exit': process.returncode, 'stdout': stdout.read(8192).decode('utf-8', 'replace'),
                      'stderr': stderr.read(8192).decode('utf-8', 'replace')}
        self.assertNotIn('sandbox_apply', result['stderr'], result)
        return result

    def test_literal_replacement_preserves_unicode_quotes_and_unedited_lines(self):
        target = self.workspace / 'with spaces.py'
        target.write_text('first\nlabel = "before"\nlast\n')
        result = self.apply({'path': target.name, 'old_text': 'label = "before"',
                             'new_text': 'label = \'café 🐈\''})
        self.assertEqual(result['exit'], 0, result)
        self.assertEqual(target.read_bytes(), 'first\nlabel = \'café 🐈\'\nlast\n'.encode())

    def test_blank_line_contents_survive_the_native_parser(self):
        target = self.workspace / 'blank.txt'
        target.write_text('first\n\nsecond\nlast\n')
        result = self.apply({'path': target.name, 'old_text': '\nsecond\n', 'new_text': '\nchanged\n'})
        self.assertEqual(result['exit'], 0, result)
        self.assertEqual(target.read_bytes(), b'first\n\nchanged\nlast\n')

    def test_marker_looking_lines_are_file_content_not_patch_directives(self):
        target = self.workspace / 'markers.txt'
        target.write_text('*** End Patch\n@@\n-old\n+new\n')
        new = '*** Begin Patch\n*** Update File: absent.txt\n@@ -1,2 +1,2 @@\n*** End Patch'
        result = self.apply({'path': target.name, 'old_text': target.read_text(), 'new_text': new})
        self.assertEqual(result['exit'], 0, result)
        self.assertEqual(target.read_bytes(), (new + '\n').encode())
        self.assertFalse((self.workspace / 'absent.txt').exists())

    def test_wrong_context_fails_without_changing_the_file(self):
        target = self.workspace / 'context.txt'
        original = b'actual context\n'; target.write_bytes(original)
        result = self.apply({'path': target.name, 'old_text': 'different context', 'new_text': 'changed'})
        self.assertNotEqual(result['exit'], 0, result)
        self.assertEqual(target.read_bytes(), original)

    def test_native_line_replacement_uses_its_existing_terminal_lf_policy(self):
        target = self.workspace / 'no-terminal-lf.txt'
        target.write_bytes(b'before')
        result = self.apply({'path': target.name, 'old_text': 'before', 'new_text': 'after'})
        self.assertEqual(result['exit'], 0, result)
        self.assertEqual(target.read_bytes(), b'after\n')

    def test_host_sandbox_blocks_a_symlink_write_outside_the_owned_workspace(self):
        outside = self.root / 'outside.txt'; outside.write_bytes(b'before\n')
        (self.workspace / 'link.txt').symlink_to(outside)
        result = self.apply({'path': 'link.txt', 'old_text': 'before', 'new_text': 'after'})
        self.assertNotEqual(result['exit'], 0, result)
        self.assertEqual(outside.read_bytes(), b'before\n')


if __name__ == '__main__':
    unittest.main()
