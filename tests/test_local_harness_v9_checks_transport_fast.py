"""Both v9 verification interfaces retain the existing native command boundary."""
from copy import deepcopy
import json
import unittest

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest
from hormuz.local_python_checks import FEEDBACK_CHECKS_SCHEMA, compile_feedback_checks
from hormuz.local_python_script import SCRIPT_SCHEMA, compile_script
from tests.test_local_harness_v5_transport_fast import synthetic_requests


SPEC = {'module_path': 'offsets.py', 'function': 'apply_offsets', 'cases': [
    {'args': [[5], [2]], 'expected': [3], 'same_as_arg': 0},
    {'args': [[5], [6]], 'raises': 'ValueError', 'unchanged_args': [0]}],
    'atomic_batch': {'argument': 1, 'unchanged_args': [0]}}
SCRIPT = 'from offsets import apply_offsets\nassert apply_offsets([5], [2]) == [3]\n'


class LocalHarnessV9ChecksTransportTests(unittest.TestCase):
    def request(self):
        return synthetic_requests()['no_tool_history']

    def adapter(self, request=None):
        return CodexLlamaRequest(self.request() if request is None else request, harness='qwen-code.v9')

    def helpers(self, adapter):
        result = {}
        for tool in adapter.value['tools']:
            required = tool.get('parameters', {}).get('required')
            if required in (['checks'], ['script']):
                result[required[0]] = tool
        self.assertEqual(set(result), {'checks', 'script'})
        return result

    def calls(self, adapter, order=('checks', 'script')):
        helpers = self.helpers(adapter)
        payloads = {'checks': SPEC, 'script': SCRIPT}
        return [{'type': 'function_call', 'id': kind + '-item', 'call_id': kind + '-call',
                 'name': helpers[kind]['name'], 'status': 'completed',
                 'arguments': json.dumps({kind: payloads[kind], 'workdir': '/native/workspace'})}
                for kind in order]

    def expected(self, call, kind, *, namespace=None):
        result = {**call, 'name': 'exec_command', 'arguments': json.dumps({
            'cmd': compile_feedback_checks(SPEC) if kind == 'checks' else compile_script(SCRIPT),
            'workdir': '/native/workspace'}, separators=(',', ':'))}
        if namespace is not None:
            result['namespace'] = namespace
        return result

    def feed_events(self, adapter, events, *, final=False):
        output = adapter.feed(''.join('data: ' + json.dumps(event) + '\n\n'
                                      for event in events).encode(), event_stream=True, final=final)
        return [json.loads(line[5:]) for line in output.decode().splitlines() if line.startswith('data:')]

    def test_primary_checks_then_script_keep_all_original_host_tool_bodies_and_order(self):
        request = self.request()
        original = deepcopy(request)
        adapter = self.adapter(request)
        helpers = self.helpers(adapter)
        plain = CodexLlamaRequest(request).value
        self.assertEqual(adapter.value['tools'][:2], [helpers['checks'], helpers['script']])
        self.assertEqual(adapter.value['tools'][2:], plain['tools'])
        self.assertEqual(helpers['checks']['parameters']['properties']['checks'], FEEDBACK_CHECKS_SCHEMA)
        self.assertEqual(helpers['script']['parameters']['properties']['script'], SCRIPT_SCHEMA)
        self.assertIn('Prefer ' + helpers['checks']['name'], adapter.value['instructions'])
        self.assertIn('fallback', adapter.value['instructions'])
        self.assertIn(helpers['script']['name'], adapter.value['instructions'])
        self.assertIn('original', adapter.value['instructions'])
        self.assertIn('atomic_batch', adapter.value['instructions'])
        self.assertNotIn('not shell commands or JSON test cases', adapter.value['instructions'])
        self.assertEqual(adapter.value['tool_choice'], 'auto')
        self.assertEqual(request, original)

    def test_both_response_orders_use_their_own_compiler_and_preserve_native_history(self):
        for order in (('checks', 'script'), ('script', 'checks')):
            with self.subTest(order=order):
                request = self.request()
                adapter = self.adapter(request)
                calls = self.calls(adapter, order)
                response = {'id': 'both-response', 'status': 'completed', 'output': calls}
                actual = json.loads(adapter.feed(json.dumps(response).encode(), event_stream=False, final=True))
                expected = [self.expected(call, kind) for call, kind in zip(calls, order)]
                self.assertEqual(actual, {**response, 'output': expected})
                history = [entry for call in expected for entry in (call, {
                    'type': 'function_call_output', 'call_id': call['call_id'], 'output': 'actual native result'})]
                request['input'] += history
                replayed = self.adapter(request).value['input']
                self.assertEqual(replayed[1:1 + len(history)], history)

    def test_interleaved_streams_hide_raw_helper_arguments_and_match_terminal_commands(self):
        for order in (('checks', 'script'), ('script', 'checks')):
            with self.subTest(order=order):
                adapter = self.adapter()
                calls = self.calls(adapter, order)
                events = [{'type': 'response.output_item.added',
                           'item': {**call, 'arguments': '', 'status': 'in_progress'}} for call in calls]
                for part in (0, 1):
                    for call in calls:
                        raw = call['arguments']
                        split = len(raw) // 2
                        events += [
                            {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': ''},
                            {'type': 'response.function_call_arguments.delta', 'item_id': call['id'],
                             'delta': raw[:split] if part == 0 else raw[split:]}]
                for call in calls:
                    events += [
                        {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': ''},
                        {'type': 'response.function_call_arguments.done', 'item_id': call['id'],
                         'arguments': call['arguments']},
                        {'type': 'response.output_item.done', 'item': call}]
                events.append({'type': 'response.completed',
                               'response': {'id': 'both-response', 'status': 'completed', 'output': calls}})
                actual = self.feed_events(adapter, events, final=True)
                self.assertEqual([event['type'] for event in actual],
                    ['response.output_item.added'] * 2 + ['response.output_item.done'] * 2 + ['response.completed'])
                expected = [self.expected(call, kind) for call, kind in zip(calls, order)]
                self.assertEqual([event['item'] for event in actual[2:4]], expected)
                self.assertEqual(actual[-1]['response']['output'], expected)
                self.assertTrue(all(event['item']['arguments'] == '' for event in actual[:2]))
                self.assertNotIn('koto_python', json.dumps(actual))

    def test_namespace_collisions_use_actual_allocated_aliases_for_each_interface(self):
        request = self.request()
        occupied_tools = [{'type': 'function', 'name': name,
            'parameters': {'type': 'object', 'properties': {}, 'required': [], 'additionalProperties': False}}
            for name in ('koto_python_checks', 'koto_python')]
        request['tools'] = [{'type': 'namespace', 'name': 'functions', 'tools': request['tools']}, *occupied_tools]
        original = deepcopy(request)
        adapter = self.adapter(request)
        helpers = self.helpers(adapter)
        plain = CodexLlamaRequest(request).value
        self.assertEqual(adapter.value['tools'][2:], plain['tools'])
        for kind, occupied in (('checks', 'koto_python_checks'), ('script', 'koto_python')):
            self.assertNotEqual(helpers[kind]['name'], occupied)
            self.assertIn(helpers[kind]['name'], adapter.value['instructions'])
        calls = self.calls(adapter)
        actual = json.loads(adapter.feed(json.dumps({'status': 'completed', 'output': calls}).encode(),
                                         event_stream=False, final=True))['output']
        self.assertEqual(actual, [self.expected(call, kind, namespace='functions')
                                 for call, kind in zip(calls, ('checks', 'script'))])
        self.assertEqual(request, original)

    def test_primary_interface_gets_the_only_free_slot_without_dropping_native_tools(self):
        for count, kinds in ((1022, ['checks', 'script']), (1023, ['checks']), (1024, [])):
            with self.subTest(count=count):
                request = self.request()
                request['tools'] += [{'type': 'function', 'name': 'host_' + str(index),
                    'parameters': {'type': 'object', 'properties': {}, 'required': []}}
                    for index in range(count - len(request['tools']))]
                plain = CodexLlamaRequest(request).value
                adapted = self.adapter(request).value
                self.assertEqual(len(adapted['tools']), 1024)
                self.assertEqual([tool['parameters']['required'][0] for tool in adapted['tools'][:len(kinds)]], kinds)
                self.assertEqual(adapted['tools'][len(kinds):], plain['tools'])
                if not kinds:
                    self.assertNotIn('Prefer koto_python_checks', adapted['instructions'])
                elif len(kinds) == 1:
                    self.assertNotIn('fallback', adapted['instructions'])

    def test_nonautomatic_choices_and_unidentified_host_commands_offer_neither_interface(self):
        for choice in ('none', 'required', {'type': 'function', 'name': 'exec_command'}):
            with self.subTest(choice=choice):
                request = self.request()
                request['tool_choice'] = choice
                adapted = self.adapter(request).value
                self.assertEqual(adapted['tools'], CodexLlamaRequest(request).value['tools'])
                self.assertEqual(adapted['tool_choice'], choice)
        request = self.request()
        request['tools'][0]['description'] += ' Unpinned declaration.'
        self.assertEqual(self.adapter(request).value['tools'], CodexLlamaRequest(request).value['tools'])

    def test_stream_argument_bound_is_shared_across_both_interfaces(self):
        adapter = self.adapter()
        calls = self.calls(adapter)
        events = [{'type': 'response.output_item.added',
                   'item': {**call, 'arguments': '', 'status': 'in_progress'}} for call in calls]
        self.feed_events(adapter, events)
        self.feed_events(adapter, [{'type': 'response.function_call_arguments.delta',
                                   'item_id': calls[0]['id'], 'delta': 'x' * 32768}])
        with self.assertRaises(CodexLlamaError):
            self.feed_events(adapter, [{'type': 'response.function_call_arguments.delta',
                                       'item_id': calls[1]['id'], 'delta': 'y' * 32769}])


if __name__ == '__main__':
    unittest.main()
