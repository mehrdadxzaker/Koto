"""Optional Qwen adaptation through the public Responses transport."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from hormuz.codex_llama import CodexLlamaRequest
from hormuz.contracts import ContractValidationError, validate_contract


class LocalHarnessTests(unittest.TestCase):
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
