"""Only current, correlated native patch-format failures produce v9 advice."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from tests.test_local_harness_v5_transport_fast import synthetic_requests


class LocalHarnessV9PatchTests(unittest.TestCase):
    def rejected(self):
        request = synthetic_requests()['no_tool_history']
        request['input'] += [
            {'type': 'custom_tool_call', 'name': 'apply_patch', 'call_id': 'bad-range',
             'input': '*** Begin Patch\n*** Update File: solution.py\n@@ -1,3 +1,27 @@\n-old\n+new\n*** End Patch'},
            {'type': 'custom_tool_call_output', 'call_id': 'bad-range',
             'output': "apply_patch verification failed: Failed to find context '-1,3 +1,27 @@' in solution.py"}]
        return request

    def checkpoint(self, request, profile='qwen-code.v9'):
        return CodexLlamaRequest(request, harness=profile).value['input'][-1]['content'][0]['text']

    def test_latest_correlated_numbered_hunk_failure_gets_native_format_advice(self):
        request = self.rejected()
        original = deepcopy(request)
        adapted = CodexLlamaRequest(request, harness='qwen-code.v9').value
        message = adapted['input'][-1]['content'][0]['text']
        self.assertIn('Native patch recovery', message)
        self.assertIn('Use a plain @@ on its own line.', message)
        self.assertNotIn('Native patch recovery', self.checkpoint(request, 'qwen-code.v8'))
        self.assertEqual(adapted['input'][2]['output'], request['input'][2]['output'])
        self.assertEqual(json.loads(adapted['input'][1]['arguments'])['input'], request['input'][1]['input'])
        self.assertEqual(request, original)

    def test_later_work_pending_unknown_or_duplicate_feedback_does_not_reuse_patch_advice(self):
        native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        command = {'type': 'function_call', 'name': 'exec_command', 'call_id': 'later-command',
                   'arguments': json.dumps({'cmd': 'cat solution.py'})}
        output = {'type': 'function_call_output', 'call_id': 'later-command',
                  'output': native['cases']['exec_success']['result']['output']}
        saved = synthetic_requests()['saved_patch_without_later_command']['input'][-2:]
        variants = {'pending': [command], 'completed_command': [command, output], 'saved': saved,
            'unbound': [{'type': 'function_call_output', 'call_id': 'unknown', 'output': 'untrusted'}],
            'duplicate': [self.rejected()['input'][-1]]}
        for name, later in variants.items():
            with self.subTest(name=name):
                request = self.rejected()
                request['input'] += deepcopy(later)
                self.assertNotIn('Native patch recovery', self.checkpoint(request))


if __name__ == '__main__':
    unittest.main()
