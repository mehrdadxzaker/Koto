"""Explicit integer policies retain native authority and earlier request bytes."""
from copy import deepcopy
import ast
import json
import shlex
import unittest

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest
from tests.test_local_harness_v5_transport_fast import synthetic_requests, wire_digest


class LocalHarnessV15Tests(unittest.TestCase):
    def test_declared_integer_policy_compiles_only_to_the_identified_native_command(self):
        original = synthetic_requests()['no_tool_history']
        before = deepcopy(original)
        adapter = CodexLlamaRequest(original, harness='qwen-code.v15')
        tools = adapter.value['tools']
        self.assertEqual([tool['name'] for tool in tools[:3]],
                         ['koto_integer_checks', 'koto_replace', 'koto_python'])
        for name, description in (
                ('tool', tools[0]['description']),
                ('schema', tools[0]['parameters']['properties']['checks']['description']),
                ('instructions', adapter.value['instructions'])):
            with self.subTest(case=name):
                self.assertIn('rejections require TypeError', description.replace('rejection requires', 'rejections require'))
                self.assertIn('other exception contracts', description)
        self.assertEqual(tools[3:], CodexLlamaRequest(original).value['tools'])
        spec = {'module_path': 'solution.py', 'function': 'transform', 'arguments': {'value': 3},
                'policies': [{'argument': 'value', 'subclasses': 'reject', 'booleans': 'reject'}]}
        item = {'type': 'function_call', 'id': 'types-item', 'call_id': 'types-call',
                'name': 'koto_integer_checks', 'arguments': json.dumps({'checks': spec, 'workdir': '/native/workspace'})}
        result = json.loads(adapter.feed(json.dumps({'status': 'completed', 'output': [item]}).encode(),
                                         event_stream=False, final=True))['output'][0]
        self.assertEqual((result['type'], result['name'], result['call_id']),
                         ('function_call', 'exec_command', 'types-call'))
        arguments = json.loads(result['arguments'])
        self.assertEqual(set(arguments), {'cmd', 'workdir'})
        self.assertEqual(arguments['workdir'], '/native/workspace')
        command = shlex.split(arguments['cmd'])
        self.assertEqual(command[:2], ['python3', '-c'])
        self.assertEqual(len(command), 3)
        ast.parse(command[2])
        self.assertEqual(original, before)

    def test_invalid_policy_and_additional_authority_are_rejected(self):
        base = synthetic_requests()['no_tool_history']
        spec = {'module_path': 'solution.py', 'function': 'transform', 'arguments': {'value': 3},
                'policies': [{'argument': 'value', 'subclasses': 'reject', 'booleans': 'reject'}]}
        variants = [('outside-path', {'checks': {**spec, 'module_path': '../outside.py'}}),
                    ('extra-authority', {'checks': spec, 'sandbox_permissions': 'require_escalated'}),
                    ('unknown-policy', {'checks': {**spec, 'policies': [{'argument': 'value', 'subclasses': 'coerce', 'booleans': 'reject'}]}}),
                    ('unbound-argument', {'checks': {**spec, 'arguments': {'other': 3}}}),
                    ('boolean-sample', {'checks': {**spec, 'arguments': {'value': True}}}),
                    ('duplicate-policy', {'checks': {**spec, 'policies': spec['policies'] * 2}}),
                    ('empty-policy', {'checks': {**spec, 'policies': []}}),
                    ('too-many-policies', {'checks': {**spec, 'policies': spec['policies'] * 9}})]
        for name, arguments in variants:
            with self.subTest(case=name):
                adapter = CodexLlamaRequest(base, harness='qwen-code.v15')
                item = {'type': 'function_call', 'id': 'bad-item', 'call_id': 'bad-call',
                        'name': 'koto_integer_checks', 'arguments': json.dumps(arguments)}
                with self.assertRaises(CodexLlamaError):
                    adapter.feed(json.dumps({'status': 'completed', 'output': [item]}).encode(),
                                 event_stream=False, final=True)

    def test_integer_helper_requires_original_native_identity_and_automatic_choice(self):
        base = synthetic_requests()['no_tool_history']
        for choice in ['none', 'required']:
            with self.subTest(choice=choice):
                request = deepcopy(base); request['tool_choice'] = choice
                self.assertNotIn('koto_integer_checks', [t['name'] for t in CodexLlamaRequest(request, harness='qwen-code.v15').value['tools']])
        request = deepcopy(base)
        next(t for t in request['tools'] if t['name'] == 'exec_command')['description'] += ' Unidentified.'
        self.assertNotIn('koto_integer_checks', [t['name'] for t in CodexLlamaRequest(request, harness='qwen-code.v15').value['tools']])

    def test_integer_compiler_validates_bounded_data_without_importing_target(self):
        from hormuz.local_python_integer_checks import compile_integer_checks
        from hormuz.local_python_checks import CheckSpecError
        spec = {'module_path': 'not-present.py', 'function': 'missing', 'arguments': {'value': 3},
                'policies': [{'argument': 'value', 'subclasses': 'allow', 'booleans': 'unchecked'}]}
        original = deepcopy(spec)
        self.assertEqual(shlex.split(compile_integer_checks(spec))[:2], ['python3', '-c'])
        self.assertEqual(spec, original)
        variants = [('non-json', {**spec, 'arguments': {'value': object()}}),
                    ('oversized', {**spec, 'arguments': {'value': 3, 'data': 'x' * 32769}}),
                    ('bad-boolean-rule', {**spec, 'policies': [{'argument': 'value', 'subclasses': 'allow', 'booleans': 'allow'}]}),
                    ('extra-field', {**spec, 'run': 'unrelated'}),
                    ('bad-parameter', {**spec, 'arguments': {'class': 3}})]
        for name, invalid in variants:
            with self.subTest(case=name):
                with self.assertRaises(CheckSpecError):
                    compile_integer_checks(invalid)

    def test_legacy_v14_wire_bytes_remain_unchanged(self):
        expected = {
            'no_tool_history': '9d68788485399dc34bbe7aa364bed2961fc8a6be5acb18c22d4f6463f12f1a43',
            'exec_failure': '28d7a2b51625b25c0a7f044dda00a5667dee8abe7185e20d088901c8af6fcbba',
            'exec_success': '646b0cc1f60ae4ae2b5e83b315446dfdb708d9ce1d07ba5daa2e76fde012bf8e',
            'python_syntax_failure': '72c24ed66adf055db22774002aef4f5f8d9f90cbff329fef5e26ab0d8fc1c27e',
            'repeated_successful_command': '5d9e7cfa2775c3f0862200b55a7b38f47068d69399a1e9ecc333f83189e6efe3',
            'saved_patch_without_later_command': 'cda9db168e873c043d620fa08540900a0fea4a7be97d857b0ac4fcb8a5504d15',
            'repeated_malformed_patch': '8474321b0443c18a2b7584a78dcb3c73ca31ec4a5adf37b826b7daff8f0a09d2',
            'string_input': 'fd498cf6760c2f627a68e5ea4bca2d4ba6594b4aae9720f94fc7dddc382fb58a'}
        for name, request in synthetic_requests().items():
            with self.subTest(history=name):
                self.assertEqual(wire_digest(CodexLlamaRequest(request, harness='qwen-code.v14').value), expected[name])
