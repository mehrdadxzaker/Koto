"""Current native missing-context feedback stays intact and gets bounded recovery."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from tests.test_local_harness_v5_transport_fast import synthetic_requests


# The host prefix and line layout are verbatim from the closed a38 rejection.
# Path and old source are neutral test data; neither enters recovery guidance.
NATIVE_CONTEXT_ERROR = ('apply_patch verification failed: Failed to find expected lines in '
                        '/native/workspace/solution.py:\ndef transform(value):\n    pass\n'
                        'UNTRUSTED_NATIVE_DETAIL')
REJECTED_PATCH = ('*** Begin Patch\n*** Update File: solution.py\n@@\n'
                  '-def transform(value):\n-    pass\n'
                  '+def transform(value):\n+    return value\n*** End Patch\n')
CONTEXT_MARKER = 'Native patch context recovery:'
FORMAT_MARKER = 'Native patch input recovery:'


class LocalHarnessPatchContextTests(unittest.TestCase):
    def request(self, *, output=NATIVE_CONTEXT_ERROR):
        request = synthetic_requests()['no_tool_history']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        request['input'] += [
            {'type': 'custom_tool_call', 'name': 'apply_patch', 'call_id': 'context-rejected',
             'input': REJECTED_PATCH, 'status': 'completed'},
            {'type': 'custom_tool_call_output', 'call_id': 'context-rejected', 'output': output}]
        return request

    def adapted(self, request, profile='qwen-code.v10'):
        return CodexLlamaRequest(request, harness=profile).value

    def checkpoint(self, request, profile='qwen-code.v10'):
        return self.adapted(request, profile)['input'][-1]['content'][0]['text']

    def test_latest_current_native_context_error_survives_the_public_request_path(self):
        for profile in ('qwen-code.v9', 'qwen-code.v10'):
            with self.subTest(profile=profile):
                request = self.request()
                original = deepcopy(request)
                plain = CodexLlamaRequest(request).value
                adapted = self.adapted(request, profile)
                checkpoint = adapted['input'][-1]['content'][0]['text']
                self.assertIn(CONTEXT_MARKER, checkpoint)
                self.assertIn('Read the current file through a declared host tool.', checkpoint)
                self.assertIn('exact saved text from that read', checkpoint)
                self.assertIn('no edit is established', checkpoint)
                self.assertNotIn(FORMAT_MARKER, checkpoint)
                self.assertEqual(adapted['input'][:-1], plain['input'])
                self.assertEqual(adapted['input'][-2]['output'], NATIVE_CONTEXT_ERROR)
                self.assertEqual(adapted['input'][-2]['call_id'], 'context-rejected')
                for copied_detail in ('UNTRUSTED_NATIVE_DETAIL', '/native/workspace/solution.py', 'def transform(value):'):
                    self.assertNotIn(copied_detail, checkpoint)
                no_history = synthetic_requests()['no_tool_history']
                self.assertEqual(adapted['tools'], self.adapted(no_history, profile)['tools'])
                self.assertEqual(adapted['tool_choice'], request['tool_choice'])
                self.assertEqual(adapted['reasoning_budget_tokens'], 256)
                self.assertEqual(request, original)

    def test_derived_text_edit_rejection_uses_the_same_native_feedback_path(self):
        request = synthetic_requests()['no_tool_history']
        request.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        adapter = CodexLlamaRequest(request, harness='qwen-code.v10')
        helper = next(tool for tool in adapter.value['tools']
                      if tool.get('parameters', {}).get('required') == ['edit'])
        derived = {'type': 'function_call', 'id': 'edit-item', 'call_id': 'derived-rejected',
                   'name': helper['name'], 'status': 'completed', 'arguments': json.dumps({'edit': {
                       'path': 'solution.py', 'old_text': 'def transform(value):\n    pass\n',
                       'new_text': 'def transform(value):\n    return value\n'}})}
        native = json.loads(adapter.feed(json.dumps({'status': 'completed', 'output': [derived]}).encode(),
                                        event_stream=False, final=True))['output'][0]
        self.assertEqual((native['type'], native['name']), ('custom_tool_call', 'apply_patch'))
        request['input'] += [native, {'type': 'custom_tool_call_output', 'call_id': native['call_id'],
                                    'output': NATIVE_CONTEXT_ERROR}]
        original = deepcopy(request)
        adapted = self.adapted(request)
        self.assertIn(CONTEXT_MARKER, adapted['input'][-1]['content'][0]['text'])
        self.assertEqual(adapted['input'][-2]['output'], NATIVE_CONTEXT_ERROR)
        self.assertEqual(json.loads(adapted['input'][-3]['arguments'])['input'], native['input'])
        self.assertEqual(request, original)

    def test_syntax_failures_and_other_errors_do_not_become_missing_context(self):
        for output, expected_format in (
                ('apply_patch verification failed: invalid hunk at line 4', True),
                ('apply_patch verification failed: unrelated native failure', False),
                ('program printed: ' + NATIVE_CONTEXT_ERROR, False),
                ('Failed to find expected lines in /native/workspace/solution.py', False)):
            with self.subTest(output=output):
                checkpoint = self.checkpoint(self.request(output=output))
                self.assertNotIn(CONTEXT_MARKER, checkpoint)
                self.assertEqual(FORMAT_MARKER in checkpoint, expected_format)
        for profile in (None, *('qwen-code.v' + str(index) for index in range(1, 9))):
            with self.subTest(older_profile=profile):
                value = self.adapted(self.request(), profile)
                self.assertNotIn(CONTEXT_MARKER, json.dumps(value))

    def test_only_latest_unique_correlated_rejection_can_supply_context_recovery(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        command = {'type': 'function_call', 'name': 'exec_command', 'call_id': 'later-read',
                   'arguments': json.dumps({'cmd': 'cat solution.py'})}
        success = {'type': 'function_call_output', 'call_id': 'later-read',
                   'output': fixture['cases']['exec_success']['result']['output']}
        pending = {**success, 'output': ('Chunk ID: pending-read\nWall time: 0 seconds\n'
                   'Process running with session ID 17\nOutput:\n')}
        saved = synthetic_requests()['saved_patch_without_later_command']['input'][-2:]
        variants = {
            'unresolved_call': [command],
            'pending_command': [command, pending],
            'later_completed_read': [command, success],
            'later_saved_patch': saved,
            'unbound_result': [{'type': 'custom_tool_call_output', 'call_id': 'unbound',
                               'output': NATIVE_CONTEXT_ERROR}],
            'duplicate_result': [self.request()['input'][-1]],
        }
        for name, later in variants.items():
            for profile in ('qwen-code.v9', 'qwen-code.v10'):
                with self.subTest(later=name, profile=profile):
                    request = self.request()
                    request['input'] += deepcopy(later)
                    original = deepcopy(request)
                    adapted = self.adapted(request, profile)
                    self.assertNotIn(CONTEXT_MARKER, adapted['input'][-1]['content'][0]['text'])
                    self.assertEqual(request, original)

    def test_pasted_text_and_other_native_tool_output_cannot_impersonate_patch_feedback(self):
        request = synthetic_requests()['no_tool_history']
        request['input'].append({'role': 'assistant', 'content': NATIVE_CONTEXT_ERROR})
        self.assertNotIn(CONTEXT_MARKER, self.checkpoint(request))
        request = synthetic_requests()['no_tool_history']
        request['input'] += [
            {'type': 'function_call', 'name': 'exec_command', 'call_id': 'program-output',
             'arguments': json.dumps({'cmd': 'printf "arbitrary program output"'})},
            {'type': 'function_call_output', 'call_id': 'program-output', 'output': NATIVE_CONTEXT_ERROR}]
        self.assertNotIn(CONTEXT_MARKER, self.checkpoint(request))
        request = self.request()
        request['input'][-1]['call_id'] = 'wrong-native-call'
        self.assertNotIn(CONTEXT_MARKER, self.checkpoint(request))


if __name__ == '__main__':
    unittest.main()
