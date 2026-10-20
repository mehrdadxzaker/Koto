"""The v6 private check interface becomes one existing native command call."""
from copy import deepcopy
import ast
import json
from pathlib import Path
import shlex
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest
from hormuz.local_harness import PROFILES


class LocalPythonChecksTransportTests(unittest.TestCase):
    def setUp(self):
        self.spec = {'cases': [{'args': [1], 'expected': 1}]}
        self.cmd = "python3 -c 'COMPILED_CHECKS'"
        module = ModuleType('hormuz.local_python_checks')
        module.CheckSpecError = type('CheckSpecError', (ValueError,), {})
        module.CHECKS_SCHEMA = {'type': 'object', 'properties': {'cases': {'type': 'array'}},
                               'required': ['cases'], 'additionalProperties': False}
        module.compile_checks = Mock(return_value=self.cmd)
        self.compiler = module.compile_checks
        self.addCleanup(patch.stopall)
        patch.dict('sys.modules', {'hormuz.local_python_checks': module}).start()
        patch.dict(PROFILES, {'qwen_code_v6': 'qwen-code.v6'}).start()

    def request(self, *, namespace='functions', choice='auto'):
        tool = {'type': 'function', 'name': 'exec_command', 'description': 'Native host command.',
                'parameters': {'type': 'object', 'properties': {
                    'cmd': {'type': 'string'}, 'workdir': {'type': 'string'}},
                    'required': ['cmd'], 'additionalProperties': False}}
        return {'instructions': 'Preserve host authority.', 'tool_choice': choice,
                'tools': [tool if namespace is None else {'type': 'namespace', 'name': namespace, 'tools': [tool]}],
                'input': [{'role': 'user', 'content': 'Repair the requested Python function.'}]}

    def adapter(self, request=None):
        return CodexLlamaRequest(request or self.request(), harness='qwen-code.v6')

    def helper(self, adapter):
        helpers = [tool for tool in adapter.value['tools'] if tool['name'].startswith('koto_python_checks')]
        self.assertEqual(len(helpers), 1)
        return helpers[0]['name']

    def call(self, alias, *, arguments=None, **changes):
        return {'type': 'function_call', 'id': 'fc-check', 'call_id': 'call-check',
                'name': alias, 'arguments': json.dumps({'checks': self.spec} if arguments is None else arguments),
                'status': 'completed', **changes}

    def response(self, call, *, status='completed'):
        return {'id': 'response-check', 'status': status, 'output': [call]}

    def feed_json(self, adapter, value):
        return json.loads(adapter.feed(json.dumps(value).encode(), event_stream=False, final=True))

    def feed_events(self, adapter, events, *, final=False):
        raw = b''.join(('data: ' + json.dumps(event) + '\n\n').encode() for event in events)
        result = adapter.feed(raw, event_stream=True, final=final)
        return [json.loads(line[5:]) for line in result.decode().splitlines() if line.startswith('data:')]

    def added(self, call):
        return {'type': 'response.output_item.added', 'output_index': 0,
                'item': {**call, 'arguments': '', 'status': 'in_progress'}}

    def test_private_helper_preserves_the_original_request_native_tools_and_history(self):
        request = self.request()
        request['input'] += [{'type': 'function_call', 'namespace': 'functions', 'name': 'exec_command',
                             'call_id': 'old', 'arguments': '{ "cmd" : "cat example.py" }'},
                            {'type': 'function_call_output', 'call_id': 'old', 'output': 'native output'}]
        original = deepcopy(request)
        adapter = self.adapter(request)
        plain = CodexLlamaRequest(request).value
        helper = next(tool for tool in adapter.value['tools'] if tool['name'] == self.helper(adapter))
        self.assertEqual(adapter.value['tools'][:-1], plain['tools'])
        self.assertEqual(adapter.value['input'][:-1], CodexLlamaRequest(request, harness='qwen-code.v5').value['input'][:-1])
        self.assertEqual(helper['parameters']['required'], ['checks'])
        self.assertEqual(helper['parameters']['properties']['workdir'], {'type': 'string'})
        self.assertFalse(helper['parameters']['additionalProperties'])
        self.assertEqual(request, original)
        self.compiler.assert_not_called()

    def test_selection_requires_native_namespace_cmd_schema_and_automatic_choice(self):
        for namespace in (None, 'mcp__other'):
            value = self.adapter(self.request(namespace=namespace)).value
            self.assertFalse(any(t['name'].startswith('koto_python_checks') for t in value['tools']))
        for choice in ('none', 'required', {'type': 'function', 'name': 'exec_command'},
                       {'type': 'allowed_tools', 'mode': 'auto', 'tools': []}):
            value = self.adapter(self.request(choice=choice)).value
            self.assertFalse(any(t['name'].startswith('koto_python_checks') for t in value['tools']))
        for mutation in ('missing_cmd', 'not_required', 'wrong_type', 'other_required'):
            request = self.request()
            schema = request['tools'][0]['tools'][0]['parameters']
            if mutation == 'missing_cmd': schema['properties'].pop('cmd')
            elif mutation == 'not_required': schema['required'] = []
            elif mutation == 'wrong_type': schema['properties']['cmd']['type'] = 'array'
            else: schema['required'].append('workdir')
            value = self.adapter(request).value
            self.assertFalse(any(t['name'].startswith('koto_python_checks') for t in value['tools']))
        request = self.request()
        request.pop('tool_choice')
        self.helper(self.adapter(request))

    def test_existing_profiles_and_full_catalogs_do_not_gain_the_helper(self):
        for profile in (None, 'qwen-code.v1', 'qwen-code.v2', 'qwen-code.v3', 'qwen-code.v4', 'qwen-code.v5'):
            value = CodexLlamaRequest(self.request(), harness=profile).value
            self.assertFalse(any(t['name'].startswith('koto_python_checks') for t in value['tools']))
        request = self.request()
        request['tools'] += [{'type': 'function', 'name': 'tool_' + str(i),
                              'parameters': {'type': 'object'}} for i in range(1023)]
        self.assertEqual(len(self.adapter(request).value['tools']), 1024)

    def test_exact_captured_flat_native_declaration_compiles_without_inventing_a_namespace(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        request = self.request()
        request['tools'] = [fixture['declarations']['exec_command']]
        adapter = self.adapter(request)
        output = self.feed_json(adapter, self.response(self.call(self.helper(adapter))))['output'][0]
        self.assertEqual(output['name'], 'exec_command')
        self.assertNotIn('namespace', output)
        self.assertEqual(json.loads(output['arguments']), {'cmd': self.cmd})
        for field in ('description', 'parameters'):
            changed = deepcopy(request)
            if field == 'description': changed['tools'][0][field] += ' altered'
            else: changed['tools'][0][field]['properties']['cmd']['description'] += ' altered'
            value = self.adapter(changed).value
            self.assertEqual(len(value['tools']), 1)

    def test_unqualified_or_ambiguous_native_targets_do_not_offer_the_helper(self):
        request = self.request()
        request['tools'][0]['tools'][0]['parameters'] = []
        self.assertEqual(len(self.adapter(request).value['tools']), 1)
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        request = self.request()
        request['tools'].append(fixture['declarations']['exec_command'])
        self.assertEqual(len(self.adapter(request).value['tools']), 2)

    def test_a_discovered_tool_cannot_supply_the_native_execution_authority(self):
        native = self.request()['tools'][0]
        request = {'tools': [], 'input': [{'type': 'tool_search_output', 'execution': 'client',
                                          'call_id': 'discovery', 'tools': [native]}]}
        value = self.adapter(request).value
        self.assertFalse(any(tool['name'].startswith('koto_python_checks') for tool in value['tools']))

    def test_alias_collision_is_deterministic_and_does_not_alias_native_history(self):
        request = self.request()
        request['tools'].append({'type': 'function', 'name': 'koto_python_checks', 'parameters': {'type': 'object'}})
        first, second = self.adapter(request), self.adapter(request)
        alias = first.value['tools'][-1]['name']
        self.assertNotEqual(alias, 'koto_python_checks')
        self.assertEqual(alias, second.value['tools'][-1]['name'])
        self.assertLessEqual(len(alias), 64)
        body = self.feed_json(first, self.response(self.call(alias)))
        self.assertEqual(body['output'][0]['name'], 'exec_command')
        self.assertEqual(body['output'][0]['namespace'], 'functions')

    def test_complete_json_compiles_only_the_new_call_and_keeps_native_ids_and_workdir(self):
        adapter = self.adapter()
        call = self.call(self.helper(adapter), arguments={'checks': self.spec, 'workdir': '/permitted/project'})
        output = self.feed_json(adapter, self.response(call))['output'][0]
        self.assertEqual({k: output[k] for k in ('id', 'call_id', 'namespace', 'name')},
                         {'id': call['id'], 'call_id': call['call_id'], 'namespace': 'functions', 'name': 'exec_command'})
        self.assertEqual(json.loads(output['arguments']), {'cmd': self.cmd, 'workdir': '/permitted/project'})
        self.compiler.assert_called_once_with(self.spec)

    def test_invalid_wrapper_arguments_fail_without_a_fabricated_tool_result(self):
        for arguments in ({'checks': self.spec, 'sandbox_permissions': 'require_escalated'},
                          {'checks': self.spec, 'workdir': 9}, {}, {'checks': self.spec, 'cmd': 'other'}):
            with self.subTest(arguments=arguments):
                adapter = self.adapter()
                with self.assertRaises(CodexLlamaError):
                    self.feed_json(adapter, self.response(self.call(self.helper(adapter), arguments=arguments)))

    def test_incomplete_json_never_exposes_helper_specification(self):
        adapter = self.adapter()
        output = self.feed_json(adapter, self.response(self.call(self.helper(adapter), status='in_progress'), status='incomplete'))
        self.assertEqual(output['output'][0]['arguments'], '')
        self.assertEqual(output['output'][0]['name'], 'exec_command')
        self.compiler.assert_not_called()

    def test_stream_suppresses_raw_arguments_and_emits_compiled_native_item_and_terminal(self):
        adapter = self.adapter()
        call = self.call(self.helper(adapter))
        arguments = call['arguments']
        events = [self.added(call),
                  {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': arguments[:12]},
                  {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': arguments[12:]},
                  {'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': arguments},
                  {'type': 'response.output_item.done', 'item': call},
                  {'type': 'response.completed', 'response': self.response(call)}]
        output = self.feed_events(adapter, events, final=True)
        self.assertEqual([e['type'] for e in output],
                         ['response.output_item.added', 'response.output_item.done', 'response.completed'])
        self.assertEqual(output[0]['item']['arguments'], '')
        for item in (output[1]['item'], output[2]['response']['output'][0]):
            self.assertEqual((item['name'], item['namespace']), ('exec_command', 'functions'))
            self.assertEqual(json.loads(item['arguments']), {'cmd': self.cmd})
        self.assertNotIn('"checks"', json.dumps(output))
        self.assertNotIn(self.helper(adapter), json.dumps(output))
        self.compiler.assert_called_once_with(self.spec)

    def test_argument_done_alone_cannot_make_an_unemitted_call_complete(self):
        adapter = self.adapter()
        call = self.call(self.helper(adapter))
        self.feed_events(adapter, [self.added(call),
            {'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': call['arguments']}])
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.completed', 'response': {'status': 'completed', 'output': []}}])

    def test_stream_rejects_unbound_identifiers_mismatched_call_ids_and_conflicting_snapshots(self):
        for variant in ('unbound_delta', 'unbound_done', 'changed_call_id', 'changed_arguments', 'changed_delta'):
            with self.subTest(variant=variant):
                adapter = self.adapter()
                call = self.call(self.helper(adapter))
                events = [self.added(call)]
                if variant == 'unbound_delta':
                    events += [{'type': 'response.function_call_arguments.delta', 'item_id': 'unknown', 'delta': '{}'}]
                elif variant == 'unbound_done':
                    events += [{'type': 'response.function_call_arguments.done', 'item_id': 'unknown', 'arguments': '{}'}]
                else:
                    events += [{'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': call['arguments']}]
                    if variant == 'changed_call_id': call['call_id'] = 'other'
                    elif variant == 'changed_delta': call['arguments'] = '{"checks":{"cases":[]}}'
                    else:
                        events += [{'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': call['arguments']}]
                        call['arguments'] = '{"checks":{"cases":[]}}'
                    events += [{'type': 'response.output_item.done', 'item': call}]
                with self.assertRaises(CodexLlamaError):
                    self.feed_events(adapter, events)

    def test_stream_buffer_and_truncated_calls_are_bounded(self):
        adapter = self.adapter()
        call = self.call(self.helper(adapter))
        self.feed_events(adapter, [self.added(call)])
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': 'x' * 65537}])
        adapter = self.adapter()
        call = self.call(self.helper(adapter))
        self.feed_events(adapter, [self.added(call), {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': '{'}])
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.completed', 'response': {'status': 'completed', 'output': []}}], final=True)

    def test_stream_rejects_unbound_terminal_calls_and_inconsistent_incomplete_identity(self):
        adapter = self.adapter()
        call = self.call(self.helper(adapter))
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.completed', 'response': self.response(call)}])
        adapter = self.adapter()
        call = self.call(self.helper(adapter))
        self.feed_events(adapter, [self.added(call)])
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.incomplete', 'response': self.response(
                {**call, 'call_id': 'other', 'status': 'in_progress'}, status='incomplete')}])

    def test_compiled_commands_over_64k_are_valid_and_do_not_consume_raw_argument_budget(self):
        self.compiler.return_value = 'x' * 70000
        adapter = self.adapter()
        alias = self.helper(adapter)
        call = self.call(alias)
        self.feed_events(adapter, [self.added(call), {'type': 'response.output_item.done', 'item': call}])
        pending = self.call(alias, id='fc-next', call_id='call-next')
        self.feed_events(adapter, [self.added(pending),
            {'type': 'response.function_call_arguments.delta', 'item_id': pending['id'], 'delta': 'x' * 65536}])
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.function_call_arguments.delta', 'item_id': pending['id'], 'delta': 'x'}])

    def test_raw_budget_is_aggregate_and_malformed_completed_json_is_not_compiled(self):
        adapter = self.adapter()
        alias = self.helper(adapter)
        one = self.call(alias)
        two = self.call(alias, id='fc-next', call_id='call-next')
        self.feed_events(adapter, [self.added(one), self.added(two),
            {'type': 'response.function_call_arguments.delta', 'item_id': one['id'], 'delta': 'x' * 32768}])
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.function_call_arguments.delta', 'item_id': two['id'], 'delta': 'x' * 32769}])
        adapter = self.adapter()
        call = self.call(self.helper(adapter))
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [self.added(call),
                {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': '{'},
                {'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': '{'}])
        self.compiler.assert_not_called()

    def test_compiled_cache_has_an_aggregate_limit_and_repeated_snapshots_do_not_double_count(self):
        self.compiler.return_value = 'x' * 128000
        adapter = self.adapter()
        alias = self.helper(adapter)
        calls = [self.call(alias, id='fc-' + str(i), call_id='call-' + str(i)) for i in range(5)]
        for call in calls[:4]:
            self.feed_events(adapter, [self.added(call),
                {'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': call['arguments']},
                {'type': 'response.output_item.done', 'item': call}])
        self.assertEqual(self.compiler.call_count, 4)
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [self.added(calls[4]), {'type': 'response.output_item.done', 'item': calls[4]}])


class LocalPythonChecksCompilerIntegrationTests(unittest.TestCase):
    def test_real_compiler_reaches_native_output_without_execution_and_replays_as_native_history(self):
        from hormuz.local_python_checks import compile_checks
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        request = {'tools': [fixture['declarations']['exec_command']], 'input': 'Repair the requested function.'}
        original = deepcopy(request)
        spec = {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': [
            {'args': [[5], [2]], 'expected': [3], 'same_as_arg': 0},
            {'args': [[5], [6]], 'raises': 'ValueError', 'unchanged_args': [0]}],
            'atomic_batch': {'argument': 1, 'unchanged_args': [0]}}
        adapter = CodexLlamaRequest(request, harness='qwen-code.v6')
        helper = adapter.value['tools'][-1]
        self.assertIn('checks', helper['parameters']['properties'])
        call = {'type': 'function_call', 'id': 'actual-check', 'call_id': 'actual-call',
                'name': helper['name'], 'arguments': json.dumps({'checks': spec}), 'status': 'completed'}
        body = json.loads(adapter.feed(json.dumps({'status': 'completed', 'output': [call]}).encode(),
                                       event_stream=False, final=True))
        native = body['output'][0]
        self.assertEqual(native['name'], 'exec_command')
        self.assertNotIn('namespace', native)
        command = json.loads(native['arguments'])['cmd']
        self.assertEqual(command, compile_checks(spec))
        words = shlex.split(command)
        self.assertEqual(words[:2], ['python3', '-c'])
        ast.parse(words[2])
        continued = deepcopy(request)
        continued['input'] = [{'role': 'user', 'content': request['input']}, native,
                              {'type': 'function_call_output', 'call_id': native['call_id'], 'output': 'actual host output'}]
        replayed = CodexLlamaRequest(continued, harness='qwen-code.v6').value
        self.assertEqual(json.loads(replayed['input'][1]['arguments']), {'cmd': command})
        self.assertEqual(replayed['input'][2], continued['input'][2])
        self.assertEqual(request, original)

    def test_real_invalid_spec_is_rejected_before_a_native_call_is_emitted(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        adapter = CodexLlamaRequest({'tools': [fixture['declarations']['exec_command']], 'input': 'Repair.'},
                                    harness='qwen-code.v6')
        call = {'type': 'function_call', 'id': 'actual-check', 'call_id': 'actual-call',
                'name': adapter.value['tools'][-1]['name'], 'status': 'completed',
                'arguments': json.dumps({'checks': {'module_path': 'offsets.py', 'function': 'apply_offsets',
                                                   'cases': [{'args': []}]}})}
        with self.assertRaises(CodexLlamaError):
            adapter.feed(json.dumps({'status': 'completed', 'output': [call]}).encode(), event_stream=False, final=True)


if __name__ == '__main__':
    unittest.main()
