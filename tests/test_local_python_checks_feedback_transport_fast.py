"""V7 selects recoverable check feedback without changing native execution."""
from copy import deepcopy
import ast
import json
from pathlib import Path
import shlex
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest


class LocalPythonChecksFeedbackTransportTests(unittest.TestCase):
    def setUp(self):
        self.spec = {'module_path': 'example.py', 'function': 'transform',
                     'cases': [{'args': []}]}
        self.command = "python3 -c 'raise SystemExit(2)'"
        module = ModuleType('hormuz.local_python_checks')
        module.CheckSpecError = type('CheckSpecError', (ValueError,), {})
        module.CHECKS_SCHEMA = {'type': 'object', 'description': 'strict v6'}
        module.FEEDBACK_CHECKS_SCHEMA = {'type': 'object', 'description': 'feedback v7'}
        module.compile_checks = Mock(side_effect=module.CheckSpecError('expected_xor_raises_required'))
        module.compile_feedback_checks = Mock(return_value=self.command)
        self.module = module
        self.addCleanup(patch.stopall)
        patch.dict('sys.modules', {'hormuz.local_python_checks': module}).start()

    def request(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        return {'tools': [fixture['declarations']['exec_command']], 'tool_choice': 'auto',
                'input': [{'role': 'user', 'content': 'Repair the requested function.'},
                          {'type': 'function_call', 'name': 'exec_command', 'call_id': 'prior',
                           'arguments': '{"cmd":"cat example.py"}'},
                          {'type': 'function_call_output', 'call_id': 'prior', 'output': 'saved source'}]}

    def adapter(self, request=None, profile='qwen-code.v7'):
        return CodexLlamaRequest(self.request() if request is None else request, harness=profile)

    def helper(self, adapter):
        helpers = [tool for tool in adapter.value['tools'] if tool['name'] in adapter.derived_checks]
        self.assertEqual(len(helpers), 1)
        return helpers[0]

    def call(self, adapter, **changes):
        return {'type': 'function_call', 'id': 'feedback-item', 'call_id': 'feedback-call',
                'name': self.helper(adapter)['name'], 'status': 'completed',
                'arguments': json.dumps({'checks': self.spec, 'workdir': '/native/workspace'}), **changes}

    def response(self, call):
        return {'id': 'feedback-response', 'status': 'completed', 'output': [call]}

    def feed_json(self, adapter, call):
        return json.loads(adapter.feed(json.dumps(self.response(call)).encode(), event_stream=False, final=True))

    def feed_events(self, adapter, events, *, final=False):
        raw = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events).encode()
        output = adapter.feed(raw, event_stream=True, final=final)
        return [json.loads(line[5:]) for line in output.decode().splitlines() if line.startswith('data:')]

    def test_v7_selects_feedback_api_and_preserves_the_original_native_prefix_and_choice(self):
        request = self.request()
        original = deepcopy(request)
        adapter = self.adapter(request)
        plain = CodexLlamaRequest(request)
        helper = self.helper(adapter)
        self.assertEqual(helper['parameters']['properties']['checks'], self.module.FEEDBACK_CHECKS_SCHEMA)
        self.assertIs(adapter.compile_checks, self.module.compile_feedback_checks)
        self.assertEqual(adapter.value['tools'][:-1], plain.value['tools'])
        self.assertEqual(adapter.value['input'][:len(plain.value['input'])], plain.value['input'])
        self.assertEqual(adapter.value['tool_choice'], 'auto')
        self.assertEqual(request, original)
        self.module.compile_checks.assert_not_called()
        self.module.compile_feedback_checks.assert_not_called()

    def test_v6_keeps_the_original_schema_compiler_and_strict_failure(self):
        adapter = self.adapter(profile='qwen-code.v6')
        helper = self.helper(adapter)
        self.assertEqual(helper['parameters']['properties']['checks'], self.module.CHECKS_SCHEMA)
        self.assertIs(adapter.compile_checks, self.module.compile_checks)
        with self.assertRaises(CodexLlamaError):
            self.feed_json(adapter, self.call(adapter))
        self.module.compile_checks.assert_called_once_with(self.spec)
        self.module.compile_feedback_checks.assert_not_called()

    def test_feedback_command_becomes_one_existing_native_call_without_a_fabricated_result(self):
        adapter = self.adapter()
        call = self.call(adapter)
        body = self.feed_json(adapter, call)
        self.assertEqual(len(body['output']), 1)
        native = body['output'][0]
        self.assertEqual(native, {**call, 'name': 'exec_command',
                                 'arguments': json.dumps({'cmd': self.command, 'workdir': '/native/workspace'},
                                                         separators=(',', ':'))})
        self.assertNotIn('namespace', native)
        self.module.compile_feedback_checks.assert_called_once_with(self.spec)
        self.module.compile_checks.assert_not_called()

    def test_stream_hides_helper_arguments_and_reuses_one_compiled_feedback_command(self):
        adapter = self.adapter()
        call = self.call(adapter)
        raw = call['arguments']
        output = self.feed_events(adapter, [
            {'type': 'response.output_item.added', 'item': {**call, 'arguments': '', 'status': 'in_progress'}},
            {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': ''},
            {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': raw[:11]},
            {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': raw[11:]},
            {'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': raw},
            {'type': 'response.output_item.done', 'item': call},
            {'type': 'response.completed', 'response': self.response(call)}], final=True)
        self.assertEqual([event['type'] for event in output],
                         ['response.output_item.added', 'response.output_item.done', 'response.completed'])
        self.assertEqual(output[0]['item']['arguments'], '')
        for native in (output[1]['item'], output[2]['response']['output'][0]):
            self.assertEqual(native['name'], 'exec_command')
            self.assertNotIn('namespace', native)
            self.assertEqual(json.loads(native['arguments']), {'cmd': self.command, 'workdir': '/native/workspace'})
        self.assertNotIn('"checks"', json.dumps(output))
        self.assertNotIn(self.helper(adapter)['name'], json.dumps(output))
        self.assertEqual(adapter.derived_buffer_bytes, 0)
        self.module.compile_feedback_checks.assert_called_once_with(self.spec)

    def test_nonautomatic_native_choices_never_offer_or_call_the_feedback_compiler(self):
        for choice in ('none', 'required', {'type': 'function', 'name': 'exec_command'},
                       {'type': 'allowed_tools', 'mode': 'auto', 'tools': []}):
            with self.subTest(choice=choice):
                request = self.request()
                request['tool_choice'] = choice
                adapter = self.adapter(request)
                self.assertEqual(adapter.derived_checks, {})
                self.assertEqual(adapter.value['tool_choice'], choice)
        self.module.compile_feedback_checks.assert_not_called()

    def test_outer_authority_and_malformed_protocol_remain_hard_failures(self):
        for arguments in ({'checks': self.spec, 'sandbox_permissions': 'require_escalated'},
                          {'checks': self.spec, 'workdir': []}, '{'):
            with self.subTest(arguments=arguments):
                adapter = self.adapter()
                raw = arguments if isinstance(arguments, str) else json.dumps(arguments)
                with self.assertRaises(CodexLlamaError):
                    self.feed_json(adapter, self.call(adapter, arguments=raw))
        self.module.compile_feedback_checks.assert_not_called()

    def test_hard_feedback_compiler_errors_still_reject_the_provider_response(self):
        self.module.compile_feedback_checks.side_effect = self.module.CheckSpecError('invalid_module_path')
        adapter = self.adapter()
        with self.assertRaises(CodexLlamaError):
            self.feed_json(adapter, self.call(adapter))
        self.module.compile_feedback_checks.assert_called_once_with(self.spec)


class LocalPythonChecksFeedbackCompilerIntegrationTests(unittest.TestCase):
    def adapter(self, profile='qwen-code.v7'):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        return CodexLlamaRequest({'tools': [fixture['declarations']['exec_command']], 'input': 'Repair.'},
                                 harness=profile)

    def call(self, adapter, spec):
        return {'type': 'function_call', 'id': 'real-feedback-item', 'call_id': 'real-feedback-call',
                'name': adapter.value['tools'][-1]['name'], 'status': 'completed',
                'arguments': json.dumps({'checks': spec})}

    def feed(self, adapter, spec):
        call = self.call(adapter, spec)
        return json.loads(adapter.feed(json.dumps({'status': 'completed', 'output': [call]}).encode(),
                                       event_stream=False, final=True))['output'][0]

    def test_real_semantic_error_reaches_native_command_without_target_data_or_import(self):
        from hormuz.local_python_checks import compile_feedback_checks
        spec = {'module_path': 'submitted_target_marker.py', 'function': 'submitted_function_marker',
                'cases': [{'args': []}]}
        native = self.feed(self.adapter(), spec)
        self.assertEqual(native['name'], 'exec_command')
        self.assertNotIn('namespace', native)
        command = json.loads(native['arguments'])['cmd']
        self.assertEqual(command, compile_feedback_checks(spec))
        words = shlex.split(command)
        self.assertEqual(words[:2], ['python3', '-c'])
        tree = ast.parse(words[2])
        imports = [node.names[0].name for node in ast.walk(tree) if isinstance(node, ast.Import)]
        self.assertEqual(imports, ['sys'])
        self.assertIn('expected_xor_raises_required', words[2])
        self.assertNotIn('submitted_target_marker', command)
        self.assertNotIn('submitted_function_marker', command)
        self.assertTrue(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                            and node.func.attr == 'exit' and len(node.args) == 1
                            and isinstance(node.args[0], ast.Constant) and node.args[0].value == 2
                            for node in ast.walk(tree)))

    def test_real_valid_feedback_compilation_keeps_the_native_call_and_history(self):
        from hormuz.local_python_checks import compile_feedback_checks
        spec = {'module_path': 'example.py', 'function': 'transform',
                'cases': [{'args': [[1, 2]], 'expected': [1, 2]}]}
        adapter = self.adapter()
        native = self.feed(adapter, spec)
        self.assertEqual(native['type'], 'function_call')
        self.assertEqual(native['call_id'], 'real-feedback-call')
        self.assertEqual(json.loads(native['arguments']), {'cmd': compile_feedback_checks(spec)})
        request = {'tools': [adapter.declarations['exec_command']],
                   'input': [native, {'type': 'function_call_output', 'call_id': native['call_id'],
                                      'output': 'actual native feedback'}]}
        replayed = CodexLlamaRequest(request, harness='qwen-code.v7').value
        self.assertEqual(json.loads(replayed['input'][0]['arguments']), json.loads(native['arguments']))
        self.assertEqual(replayed['input'][1], request['input'][1])

    def test_real_hard_feedback_error_and_v6_semantic_error_remain_rejected(self):
        for profile, spec in (
                ('qwen-code.v7', {'module_path': '../outside.py', 'function': 'transform',
                                  'cases': [{'args': [], 'expected': None}]}),
                ('qwen-code.v6', {'module_path': 'example.py', 'function': 'transform',
                                  'cases': [{'args': []}]})):
            with self.subTest(profile=profile):
                with self.assertRaises(CodexLlamaError):
                    self.feed(self.adapter(profile), spec)


if __name__ == '__main__':
    unittest.main()
