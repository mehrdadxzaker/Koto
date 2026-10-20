"""V5 changes check formatting while preserving native work and V4 wire bytes."""
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import unittest

from hormuz.codex_llama import CodexLlamaRequest


def synthetic_requests():
    """Small synthetic histories using already committed native output envelopes."""
    fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
    tools = list(fixture['declarations'].values())
    base = {'instructions': 'Preserve host permissions.', 'tools': tools,
            'tool_choice': 'auto', 'input': [{'role': 'user', 'content': 'Repair the requested function.'}]}

    def command(case, *, call_id='command-1', cmd='python3 -c \'assert 1 == 1\''):
        return [{'type': 'function_call', 'name': 'exec_command', 'call_id': call_id,
                 'arguments': json.dumps({'cmd': cmd, 'yield_time_ms': 1000, 'max_output_tokens': 1000})},
                {'type': 'function_call_output', 'call_id': call_id,
                 'output': fixture['cases'][case]['result']['output']}]

    requests = {'no_tool_history': deepcopy(base)}
    for case in ('exec_failure', 'exec_success', 'python_syntax_failure'):
        value = deepcopy(base)
        value['input'] += command(case)
        requests[case] = value
    value = deepcopy(base)
    value['input'] += command('exec_success', call_id='repeat-1') + command('exec_success', call_id='repeat-2')
    requests['repeated_successful_command'] = value
    value = deepcopy(base)
    value['input'] += [
        {'type': 'custom_tool_call', 'name': 'apply_patch', 'call_id': 'saved-patch',
         'input': '*** Begin Patch\n*** Update File: example.py\n@@\n-old\n+new\n*** End Patch'},
        {'type': 'custom_tool_call_output', 'call_id': 'saved-patch',
         'output': fixture['cases']['patch_success']['result']['output']}]
    requests['saved_patch_without_later_command'] = value
    value = deepcopy(base)
    for index in range(2):
        value['input'] += [
            {'type': 'custom_tool_call', 'name': 'apply_patch', 'call_id': 'bad-patch-' + str(index),
             'input': '*** Begin Patch\n*** Update File: example.py\n@@ -1,2 +1,2 @@\n-old\n+new\n*** End Patch'},
            {'type': 'custom_tool_call_output', 'call_id': 'bad-patch-' + str(index),
             'output': "apply_patch verification failed: Failed to find context '-1,2 +1,2 @@' in example.py"}]
    requests['repeated_malformed_patch'] = value
    requests['string_input'] = {'input': 'Original noncoding request.', 'tool_choice': 'none'}
    return requests


def wire_digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


class LocalHarnessV5TransportTests(unittest.TestCase):
    def test_v4_wire_stays_equal_to_the_pre_v5_synthetic_snapshots(self):
        expected = json.loads((Path(__file__).parent / 'fixtures/local-harness-v4-wire-before-v5.json').read_text())
        requests = synthetic_requests()
        self.assertEqual(set(requests), set(expected['wire_sha256']))
        for name, request in requests.items():
            with self.subTest(case=name):
                self.assertEqual(wire_digest(CodexLlamaRequest(request, harness='qwen-code.v4').value),
                                 expected['wire_sha256'][name])

    def test_v5_keeps_the_same_guidance_native_prefix_tools_and_observational_numbers(self):
        for name, request in synthetic_requests().items():
            with self.subTest(case=name):
                original = deepcopy(request)
                v4 = CodexLlamaRequest(request, harness='qwen-code.v4').value
                v5 = CodexLlamaRequest(request, harness='qwen-code.v5').value
                self.assertEqual(v5['instructions'], v4['instructions'])
                self.assertEqual(v5['input'][:-1], v4['input'][:-1])
                self.assertEqual(v5.get('tools'), v4.get('tools'))
                self.assertEqual(v5.get('tool_choice'), v4.get('tool_choice'))
                self.assertEqual(v5['input'][-1]['role'], 'developer')
                self.assertEqual(v5['input'][-1]['type'], 'message')
                before, after = v4['input'][-1]['content'][0]['text'], v5['input'][-1]['content'][0]['text']
                self.assertEqual(after.splitlines()[:5], before.splitlines()[:5])
                self.assertIn('not proof of correctness', after)
                self.assertEqual(request, original)

    def test_v5_format_uses_single_line_stdlib_expected_exception_and_post_error_state_assertion(self):
        request = synthetic_requests()['python_syntax_failure']
        value = CodexLlamaRequest(request, harness='qwen-code.v5').value
        reminder = value['input'][-1]['content'][0]['text']
        examples = re.findall(r"(?m)^python3 -c '([^\n]*)'$", reminder)
        self.assertEqual(len(examples), 1, reminder)
        payload = examples[0]
        self.assertIn('unittest.TestCase().assertRaises(', payload)
        self.assertRegex(payload, r'assert\s+state\s*==\s*before')
        self.assertIn('copy.deepcopy(state)', payload)
        ast.parse(payload)
        self.assertNotIn('\\n', payload)
        self.assertNotIn('<<', reminder)
        self.assertNotIn('    try:', reminder)
        self.assertNotIn('    except ', reminder)
        self.assertNotIn("python3 -c '\n", reminder)
        self.assertNotIn('Keep compound statements on new lines', reminder)
        self.assertNotIn('Use actual newlines', reminder)
        self.assertIn('SyntaxError', reminder)
        self.assertIn('Do not repeat', reminder)


if __name__ == '__main__':
    unittest.main()
