"""Recovery instructions follow an actual rejected native patch, never edit it."""
from copy import deepcopy
import json
import unittest

from hormuz.codex_llama import CodexLlamaRequest


class LocalHarnessRecoveryTests(unittest.TestCase):
    def request(self, *, attempts=1):
        patch = '*** Begin Patch\n*** Update File: example.py\n@@ -1,1 +1,1 @@\n-old\n+new\n*** End Patch'
        request = {'instructions': 'Host permissions remain authoritative.',
            'tools': [{'type': 'custom', 'name': 'apply_patch', 'format': {
                'type': 'grammar', 'syntax': 'lark', 'definition': 'start: "PATCH"'}}],
            'input': [{'role': 'user', 'content': 'Repair the requested file.'}]}
        for index in range(attempts):
            request['input'].extend([
                {'type': 'custom_tool_call', 'name': 'apply_patch', 'call_id': f'patch-{index}', 'input': patch},
                {'type': 'custom_tool_call_output', 'call_id': f'patch-{index}',
                 'output': "apply_patch verification failed: Failed to find context '-1,1 +1,1 @@' in example.py"}])
        return request

    def test_rejected_native_header_adds_recovery_without_changing_tools_or_history(self):
        request = self.request()
        original = deepcopy(request)
        v2 = CodexLlamaRequest(request, harness='qwen-code.v2').value
        v3 = CodexLlamaRequest(request, harness='qwen-code.v3').value
        self.assertEqual(v3['instructions'], v2['instructions'])
        self.assertEqual(v3['tools'], v2['tools'])
        self.assertEqual(v3['input'][:-1], v2['input'][:-1])
        reminder = v3['input'][-1]['content'][0]['text']
        self.assertIn('Native patch recovery', reminder)
        self.assertIn('\n@@\n-old\n+new\n', reminder)
        self.assertIn('Do not repeat', reminder)
        self.assertEqual(request, original)
        self.assertEqual(json.loads(v3['input'][1]['arguments'])['input'], original['input'][1]['input'])

    def test_no_failure_unlinked_output_and_other_tools_do_not_trigger_recovery(self):
        request = self.request()
        variations = [deepcopy(request) for _ in range(6)]
        variations[0]['input'] = variations[0]['input'][:1]
        variations[1]['input'][-1]['output'] = 'Success. Updated example.py'
        variations[2]['input'][-1]['call_id'] = 'not-the-issued-call'
        variations[3]['tools'][0]['name'] = 'other_custom_tool'
        variations[3]['input'][1]['name'] = 'other_custom_tool'
        variations[4]['input'][1]['input'] = variations[4]['input'][1]['input'].replace('@@ -1,1 +1,1 @@', '@@')
        variations[5]['input'][-1]['call_id'] = []
        for value in variations:
            with self.subTest(value=value):
                self.assertEqual(CodexLlamaRequest(value, harness='qwen-code.v3').value,
                                 CodexLlamaRequest(value, harness='qwen-code.v2').value)

    def test_repeat_rejection_requests_an_available_host_alternative_without_new_turns(self):
        request = self.request(attempts=2)
        adapted = CodexLlamaRequest(request, harness='qwen-code.v3').value
        self.assertEqual(len(adapted['input']), len(request['input']) + 1)
        self.assertEqual(adapted['input'][-1]['role'], 'developer')
        reminder = adapted['input'][-1]['content'][0]['text']
        self.assertIn('another declared host editing tool', reminder)
        self.assertIn('host instructions', reminder)

    def test_later_success_clears_recovery_and_distinct_patches_do_not_count_as_repetition(self):
        request = self.request(attempts=2)
        request['input'][3]['input'] = request['input'][3]['input'].replace('+new', '+different')
        adapted = CodexLlamaRequest(request, harness='qwen-code.v3').value
        self.assertIn('Native patch recovery', adapted['input'][-1]['content'][0]['text'])
        self.assertNotIn('another declared host editing tool', adapted['input'][-1]['content'][0]['text'])
        request['input'].extend([
            {'type': 'custom_tool_call', 'name': 'apply_patch', 'call_id': 'good',
             'input': request['input'][1]['input'].replace('@@ -1,1 +1,1 @@', '@@')},
            {'type': 'custom_tool_call_output', 'call_id': 'good',
             'output': 'Exit code: 0\nSuccess. Updated the following files:\nM example.py'}])
        self.assertEqual(CodexLlamaRequest(request, harness='qwen-code.v3').value,
                         CodexLlamaRequest(request, harness='qwen-code.v2').value)


if __name__ == '__main__':
    unittest.main()
