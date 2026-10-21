"""V8 carries exact Python source through the existing authorized native tool."""
from copy import deepcopy
import json
from pathlib import Path
import shlex
import unittest

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest
from hormuz.local_python_script import compile_script


class LocalHarnessV8TransportTests(unittest.TestCase):
    SCRIPT = '''import copy
from saved_module import operation
state = {"label": "a'b;$(untouched)`text`", "values": [10]}
before = copy.deepcopy(state)
try:
    operation(state, ["valid", "invalid"])
except ValueError:
    pass
else:
    raise AssertionError("expected rejection")
assert state == before
'''

    def request(self, *, choice='auto'):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        pair = fixture['cases']['exec_failure']
        return {'instructions': 'Original host instructions and permissions.',
                'tools': [fixture['declarations']['exec_command']], 'tool_choice': choice,
                'input': [{'role': 'user', 'content': 'Repair the requested function.'},
                          pair['call'], pair['result']]}

    def adapter(self, request=None, profile='qwen-code.v8'):
        return CodexLlamaRequest(self.request() if request is None else request, harness=profile)

    def helper(self, adapter):
        helpers = [tool for tool in adapter.value['tools'] if tool['name'] in adapter.derived_checks]
        self.assertEqual(len(helpers), 1)
        return helpers[0]

    def call(self, adapter, arguments=None):
        return {'type': 'function_call', 'id': 'script-item', 'call_id': 'script-call',
                'name': self.helper(adapter)['name'], 'status': 'completed',
                'arguments': json.dumps({'script': self.SCRIPT, 'workdir': '/permitted/project'}
                                        if arguments is None else arguments)}

    def response(self, call):
        return {'id': 'script-response', 'status': 'completed', 'output': [call]}

    def feed_json(self, adapter, call):
        return json.loads(adapter.feed(json.dumps(self.response(call)).encode(), event_stream=False, final=True))

    def test_v8_offers_one_script_string_without_changing_native_prefix_or_choice(self):
        request = self.request()
        original = deepcopy(request)
        plain = CodexLlamaRequest(request)
        adapter = self.adapter(request)
        helper = self.helper(adapter)
        self.assertTrue(helper['name'].startswith('koto_python'))
        self.assertEqual(helper['parameters']['required'], ['script'])
        self.assertEqual(helper['parameters']['properties']['script']['type'], 'string')
        self.assertNotIn('checks', helper['parameters']['properties'])
        self.assertFalse(helper['parameters']['additionalProperties'])
        self.assertEqual(adapter.value['tools'][:-1], plain.value['tools'])
        self.assertEqual(adapter.value['input'][:-1][:-2], plain.value['input'][:-2])
        for actual, before in zip(adapter.value['input'][:-1], plain.value['input']):
            if actual.get('type') == 'function_call':
                self.assertEqual(json.loads(actual['arguments']), json.loads(before['arguments']))
            else:
                self.assertEqual(actual, before)
        self.assertEqual(adapter.value['tool_choice'], request['tool_choice'])
        self.assertEqual(request, original)

    def test_json_uses_exact_script_as_one_python_argument_and_keeps_native_ids(self):
        adapter = self.adapter()
        call = self.call(adapter)
        native = self.feed_json(adapter, call)['output'][0]
        self.assertEqual((native['id'], native['call_id'], native['name']),
                         ('script-item', 'script-call', 'exec_command'))
        self.assertNotIn('namespace', native)
        arguments = json.loads(native['arguments'])
        self.assertEqual(arguments, {'cmd': compile_script(self.SCRIPT), 'workdir': '/permitted/project'})
        self.assertEqual(shlex.split(arguments['cmd']), ['python3', '-c', self.SCRIPT])

    def test_empty_sse_deltas_never_leak_script_and_terminal_matches_native_item(self):
        adapter = self.adapter()
        call = self.call(adapter)
        raw = call['arguments']
        events = [{'type': 'response.output_item.added', 'item': {**call, 'arguments': '', 'status': 'in_progress'}}]
        for fragment in ('', raw[:11], '', raw[11:], ''):
            events.append({'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': fragment})
        events += [{'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': raw},
                   {'type': 'response.output_item.done', 'item': call},
                   {'type': 'response.completed', 'response': self.response(call)}]
        wire = b''.join(('data: ' + json.dumps(event) + '\n\n').encode() for event in events)
        translated = adapter.feed(wire, event_stream=True, final=True)
        output = [json.loads(line[5:]) for line in translated.decode().splitlines() if line.startswith('data:')]
        self.assertEqual([e['type'] for e in output],
                         ['response.output_item.added', 'response.output_item.done', 'response.completed'])
        self.assertEqual(output[0]['item']['arguments'], '')
        self.assertEqual(output[1]['item'], output[2]['response']['output'][0])
        self.assertEqual(json.loads(output[1]['item']['arguments'])['cmd'], compile_script(self.SCRIPT))
        self.assertNotIn('"script"', translated.decode())
        self.assertNotIn(self.helper(adapter)['name'], translated.decode())
        self.assertEqual(adapter.derived_buffer_bytes, 0)

    def test_authority_parameters_and_legacy_data_dsl_are_not_accepted(self):
        for arguments in ({'script': self.SCRIPT, 'sandbox_permissions': 'require_escalated'},
                          {'script': self.SCRIPT, 'cmd': 'alternate'}, {'checks': {}},
                          {'script': self.SCRIPT, 'workdir': []}, {'script': []}, {}):
            with self.subTest(arguments=arguments):
                adapter = self.adapter()
                with self.assertRaises(CodexLlamaError):
                    self.feed_json(adapter, self.call(adapter, arguments))

    def test_nonautomatic_choice_and_mutated_flat_tool_do_not_gain_script_helper(self):
        for choice in ('none', 'required', {'type': 'function', 'name': 'exec_command'}):
            with self.subTest(choice=choice):
                adapter = self.adapter(self.request(choice=choice))
                self.assertEqual(adapter.derived_checks, {})
                self.assertEqual(adapter.value['tool_choice'], choice)
        request = self.request()
        request['tools'][0]['description'] += ' unpinned'
        self.assertEqual(self.adapter(request).derived_checks, {})

    def test_old_profiles_keep_their_existing_interface(self):
        for profile in (None, 'qwen-code.v1', 'qwen-code.v2', 'qwen-code.v3',
                        'qwen-code.v4', 'qwen-code.v5', 'qwen-code.v6', 'qwen-code.v7'):
            with self.subTest(profile=profile):
                value = self.adapter(profile=profile).value
                self.assertFalse(any('script' in t.get('parameters', {}).get('properties', {})
                                     for t in value['tools']))

    def test_namespace_target_is_retained_and_alias_collision_is_separate(self):
        request = self.request()
        request['tools'] = [{'type': 'namespace', 'name': 'functions', 'tools': request['tools']}]
        for item in request['input']:
            if item.get('type') == 'function_call':
                item['namespace'] = 'functions'
        request['tools'].append({'type': 'function', 'name': 'koto_python', 'parameters': {'type': 'object'}})
        adapter = self.adapter(request)
        helper = self.helper(adapter)
        self.assertNotEqual(helper['name'], 'koto_python')
        # This name is already a real host tool. Model-facing advice must refer
        # to the newly declared helper rather than instructing that other tool.
        self.assertNotIn('koto_python', adapter.value['instructions'])
        self.assertNotIn('koto_python', adapter.value['input'][-1]['content'][0]['text'])
        self.assertIn('script', adapter.value['instructions'])
        native = self.feed_json(adapter, self.call(adapter))['output'][0]
        self.assertEqual((native['namespace'], native['name']), ('functions', 'exec_command'))

    def test_invalid_python_is_not_silently_repaired_and_actual_host_failure_survives(self):
        script = 'try: broken('
        adapter = self.adapter()
        native = self.feed_json(adapter, self.call(adapter, {'script': script}))['output'][0]
        self.assertEqual(shlex.split(json.loads(native['arguments'])['cmd'])[2], script)
        request = self.request()
        feedback = {'type': 'function_call_output', 'call_id': native['call_id'],
                    'output': 'Actual native SyntaxError; execution failed.'}
        request['input'] += [native, feedback]
        before = deepcopy(request)
        continued = self.adapter(request).value
        self.assertEqual(continued['input'][-2], feedback)
        self.assertEqual(json.loads(continued['input'][-3]['arguments']), json.loads(native['arguments']))
        self.assertEqual(request, before)

    def test_correlated_assertion_failure_gets_specification_advice_without_copying_feedback(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        request = self.request()
        result = request['input'][-1]
        result['output'] = result['output'].split('Output:\n')[0] + (
            'Output:\nTraceback (most recent call last):\nAssertionError\nprivate-failure-detail\n')
        marker = 'Assertion failure checkpoint:'
        for effort in ('none', 'minimal'):
            with self.subTest(effort=effort):
                request['reasoning'] = {'effort': effort}
                original = deepcopy(request)
                adapted = self.adapter(request).value
                reminder = adapted['input'][-1]['content'][0]['text']
                self.assertIn(marker, reminder)
                self.assertIn('actual and expected', reminder)
                self.assertIn('original specification', reminder)
                self.assertIn('Change a test only', reminder)
                self.assertNotIn('private-failure-detail', reminder)
                self.assertEqual(adapted['input'][-2], result)
                self.assertEqual(request, original)
        for control in ('successful_exit', 'unbound_result', 'unresolved_call', 'later_success'):
            with self.subTest(control=control):
                changed = deepcopy(request)
                if control == 'successful_exit':
                    changed['input'][-1]['output'] = changed['input'][-1]['output'].replace(
                        'Process exited with code 1', 'Process exited with code 0')
                elif control == 'unbound_result':
                    changed['input'].append({**result, 'call_id': 'unbound-feedback'})
                elif control == 'unresolved_call':
                    changed['input'].append({**changed['input'][-2], 'call_id': 'unresolved'})
                else:
                    changed['input'] += [
                        {**changed['input'][-2], 'call_id': 'later'},
                        {**fixture['cases']['exec_success']['result'], 'call_id': 'later'}]
                self.assertNotIn(marker, self.adapter(changed).value['input'][-1]['content'][0]['text'])
        self.assertNotIn(marker, self.adapter(request, profile='qwen-code.v7').value['input'][-1]['content'][0]['text'])


if __name__ == '__main__':
    unittest.main()
