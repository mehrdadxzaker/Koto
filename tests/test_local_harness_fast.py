"""Optional Qwen adaptation through the public Responses transport."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.contracts import ContractValidationError, validate_contract


class LocalHarnessTests(unittest.TestCase):
    def test_v1_guidance_bytes_remain_bound_to_existing_evidence(self):
        from hormuz.local_harness import GUIDANCE
        self.assertEqual(hashlib.sha256(GUIDANCE.encode()).hexdigest(),
                         'be348aeb7ee30b784d71df3c5272ae94d87af39730d250ceb0ccda303240d0de')

    def test_v2_keeps_native_context_and_requires_execution_of_adversarial_checks(self):
        request = {'instructions': 'Host permissions and repository rules.',
            'reasoning': {'effort': 'none'}, 'max_output_tokens': 2048,
            'tools': [{'type': 'function', 'name': 'exec_command', 'parameters': {
                'type': 'object', 'properties': {'cmd': {'type': 'string'}}}}],
            'input': [{'role': 'user', 'content': 'Fix the function using the specification.'},
                {'type': 'function_call', 'name': 'exec_command', 'call_id': 'read',
                 'arguments': '{ "cmd": "cat solution.py" }'},
                {'type': 'function_call_output', 'call_id': 'read', 'output': 'source content'}]}
        original = deepcopy(request)
        adapted = CodexLlamaRequest(request, harness='qwen-code.v2').value
        self.assertTrue(adapted['instructions'].startswith(original['instructions'] + '\n\n'))
        self.assertIn('Local verification protocol', adapted['instructions'])
        self.assertIn('python3', adapted['instructions'])
        self.assertIn('failure', adapted['instructions'])
        self.assertIn('unhashable', adapted['instructions'])
        self.assertEqual(adapted['tools'], original['tools'])
        self.assertEqual(adapted['input'][0], original['input'][0])
        self.assertEqual(adapted['input'][2], original['input'][2])
        self.assertEqual(len(adapted['input']), len(original['input']) + 1)
        reminder = adapted['input'][-1]
        self.assertEqual(reminder['type'], 'message')
        self.assertEqual(reminder['role'], 'developer')
        self.assertIn('Local verification protocol', reminder['content'][0]['text'])
        self.assertEqual(json.loads(adapted['input'][1]['arguments']),
                         json.loads(original['input'][1]['arguments']))
        self.assertEqual(request, original)
        self.assertEqual(CodexLlamaRequest(request, harness='qwen-code.v2').value, adapted)

    def test_v2_string_input_preserves_user_text_before_one_reminder(self):
        request = {'instructions': 'Host rules.', 'input': 'Exact original user text.'}
        adapted = CodexLlamaRequest(request, harness='qwen-code.v2').value
        self.assertEqual(len(adapted['input']), 2)
        self.assertEqual(adapted['input'][0], {'type': 'message', 'role': 'user', 'content': [
            {'type': 'input_text', 'text': request['input']}]})
        self.assertEqual(adapted['input'][1]['role'], 'developer')
        self.assertEqual(request['input'], 'Exact original user text.')

    def test_qwen_guidance_preserves_host_instructions_tools_and_argument_values(self):
        request = {'instructions': 'Follow repository instructions. Ask before destructive actions.',
            'reasoning': {'effort': 'none'}, 'max_output_tokens': 2048,
            'tools': [{'type': 'function', 'name': 'edit', 'description': 'Host edit tool.',
                       'parameters': {'type': 'object', 'properties': {
                           'file_path': {'type': 'string'}, 'new_string': {'type': 'string'}}}}],
            'input': [{'type': 'message', 'role': 'developer', 'content': 'Work only in this project.'},
                      {'type': 'function_call', 'name': 'edit', 'call_id': 'call-1',
                       'arguments': '{ "new_string": "a  b\\n", "file_path": "x.py", "extra": 7 }'},
                      {'type': 'function_call_output', 'call_id': 'call-1', 'output': 'saved'}]}
        original = deepcopy(request)
        adapted = CodexLlamaRequest(request, harness='qwen-code.v1').value
        self.assertTrue(adapted['instructions'].startswith(request['instructions']))
        self.assertIn('Read', adapted['instructions'])
        self.assertEqual(adapted['tools'][0]['parameters'], request['tools'][0]['parameters'])
        self.assertEqual(adapted['input'][0], request['input'][0])
        self.assertEqual(adapted['input'][1]['arguments'],
                         '{"file_path":"x.py","new_string":"a  b\\n","extra":7}')
        self.assertEqual(adapted['input'][2], request['input'][2])
        self.assertEqual(request, original)
        self.assertEqual(CodexLlamaRequest(request).value['instructions'], original['instructions'])
        self.assertEqual(CodexLlamaRequest(request).value['input'][1]['arguments'],
                         original['input'][1]['arguments'])

    def test_versioned_harness_declarations_do_not_widen_older_profiles(self):
        fixtures = Path(__file__).parent / 'fixtures'
        for name, previous in [('local-setup-profile-v5.json', 4),
                               ('coding-probe-plan-v4.json', 3),
                               ('local-coding-evidence-v4.json', 3)]:
            with self.subTest(record=name):
                value = json.loads((fixtures / name).read_text())
                subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
                subject['capabilities'].append('qwen_code_v1')
                subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'
                if 'plan' in value:
                    value['plan_sha256'] = hashlib.sha256(json.dumps(value['plan'], sort_keys=True,
                        separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
                validate_contract(value)
                old = deepcopy(value)
                old['schema_version'] = previous
                with self.assertRaises(ContractValidationError):
                    validate_contract(old)
                subject['capabilities'].remove('codex_llama_v1')
                with self.assertRaises(ContractValidationError):
                    validate_contract(value)

    def test_invalid_arguments_are_rejected_without_repairs(self):
        for arguments in ['[]', '{"x":1,"x":2}', '{"x":NaN}', '{"x":']:
            with self.subTest(arguments=arguments):
                with self.assertRaises(ValueError):
                    CodexLlamaRequest({'tools': [{'type': 'function', 'name': 'read',
                        'parameters': {'type': 'object'}}], 'input': [{
                            'type': 'function_call', 'name': 'read', 'call_id': 'call-1',
                            'arguments': arguments}]}, harness='qwen-code.v1')


if __name__ == '__main__':
    unittest.main()
