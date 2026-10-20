"""The progress checkpoint reaches the real transport without altering native work."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest


class LocalHarnessProgressTransportTests(unittest.TestCase):
    def request(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        case = fixture['cases']['exec_failure']
        return {'instructions': 'Original host permissions.',
                'tools': list(fixture['declarations'].values()),
                'input': [{'role': 'user', 'content': 'Repair the requested function.'},
                          case['call'], case['result']]}

    def test_v4_appends_one_observational_checkpoint_after_the_native_prefix(self):
        request = self.request()
        original = deepcopy(request)
        baseline = CodexLlamaRequest(request).value
        adapted = CodexLlamaRequest(request, harness='qwen-code.v4').value
        previous = CodexLlamaRequest(request, harness='qwen-code.v3').value
        self.assertEqual(adapted['input'][:-1], previous['input'][:-1])
        self.assertEqual(json.loads(adapted['input'][1]['arguments']),
                         json.loads(original['input'][1]['arguments']))
        self.assertEqual(adapted['input'][2], original['input'][2])
        self.assertEqual(adapted['tools'], baseline['tools'])
        self.assertEqual(adapted['tool_choice'] if 'tool_choice' in adapted else None,
                         baseline.get('tool_choice'))
        self.assertTrue(adapted['instructions'].startswith(request['instructions'] + '\n\n'))
        self.assertIn('Local coding protocol', adapted['instructions'])
        self.assertIn('other', adapted['instructions'])
        reminder = adapted['input'][-1]
        self.assertEqual((reminder['type'], reminder['role']), ('message', 'developer'))
        self.assertIn('latest command exit: 1', reminder['content'][0]['text'])
        self.assertIn('shell', reminder['content'][0]['text'])
        self.assertNotIn('parse error near', reminder['content'][0]['text'])
        self.assertEqual(request, original)
        self.assertEqual(CodexLlamaRequest(request, harness='qwen-code.v4').value, adapted)

    def test_string_input_keeps_original_user_message_before_the_single_checkpoint(self):
        request = {'input': 'Original noncoding request.', 'tool_choice': 'none'}
        adapted = CodexLlamaRequest(request, harness='qwen-code.v4').value
        self.assertEqual(adapted['tool_choice'], 'none')
        self.assertEqual(len(adapted['input']), 2)
        self.assertEqual(adapted['input'][0]['role'], 'user')
        self.assertEqual(adapted['input'][0]['content'][0]['text'], request['input'])
        self.assertIn('other', adapted['input'][1]['content'][0]['text'])

    def test_repeated_patch_recovery_does_not_reintroduce_blocked_temporary_file_advice(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        saved = fixture['cases']['patch_failure']
        patch = json.loads(saved['call']['arguments'])['input']
        request = {'tools': [fixture['declarations']['apply_patch']], 'input': []}
        for index in range(2):
            request['input'].extend([
                {'type': 'custom_tool_call', 'name': 'apply_patch', 'call_id': str(index), 'input': patch},
                {'type': 'custom_tool_call_output', 'call_id': str(index), 'output': saved['result']['output']}])
        adapted = CodexLlamaRequest(request, harness='qwen-code.v4').value
        reminder = adapted['input'][-1]['content'][0]['text']
        self.assertIn('another declared host editing tool', reminder)
        self.assertNotIn('safely quoted heredoc', reminder)


if __name__ == '__main__':
    unittest.main()
