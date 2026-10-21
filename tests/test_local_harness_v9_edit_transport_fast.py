"""Exact-text edits retain the existing native custom patch boundary."""
from copy import deepcopy
import json
import unittest

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest
from hormuz.local_python_named_checks import compile_named_feedback_checks
from hormuz.local_python_script import compile_script
from hormuz.local_text_patch import TEXT_PATCH_SCHEMA
from tests.test_local_harness_v5_transport_fast import synthetic_requests


EDIT = {'path': 'sample.py', 'old_text': '    return value\n', 'new_text': '    return value + 1\n'}
PATCH = '*** Begin Patch\n*** Update File: sample.py\n@@\n-    return value\n+    return value + 1\n*** End Patch\n'


class LocalHarnessV9EditTransportTests(unittest.TestCase):
    def request(self):
        return synthetic_requests()['no_tool_history']

    def adapter(self, request=None, *, harness='qwen-code.v9'):
        return CodexLlamaRequest(self.request() if request is None else request, harness=harness)

    def helper(self, adapter):
        helpers = [tool for tool in adapter.value['tools'] if tool.get('parameters', {}).get('required') == ['edit']]
        self.assertEqual(len(helpers), 1, 'The identified native patch tool must expose the edit interface.')
        return helpers[0]

    def call(self, adapter, **changes):
        return {'type': 'function_call', 'id': 'edit-item', 'call_id': 'edit-call',
                'name': self.helper(adapter)['name'], 'status': 'completed',
                'arguments': json.dumps({'edit': EDIT}), **changes}

    def response(self, adapter, calls):
        return json.loads(adapter.feed(json.dumps({'status': 'completed', 'output': calls}).encode(),
                                       event_stream=False, final=True))['output']

    def events(self, adapter, events, *, final=False):
        raw = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events).encode()
        return [json.loads(line[5:]) for line in adapter.feed(raw, event_stream=True, final=final).decode().splitlines()
                if line.startswith('data:')]

    def test_edit_interface_precedes_verification_without_changing_native_tool_bodies(self):
        request = self.request()
        original = deepcopy(request)
        adapter = self.adapter(request)
        helper = self.helper(adapter)
        self.assertEqual(helper['name'], 'koto_replace')
        self.assertEqual(adapter.value['tools'][0], helper)
        self.assertEqual([tool['parameters']['required'] for tool in adapter.value['tools'][:3]],
                         [['edit'], ['checks'], ['script']])
        self.assertEqual(adapter.value['tools'][3:], CodexLlamaRequest(request).value['tools'])
        self.assertEqual(helper['parameters']['required'], ['edit'])
        self.assertFalse(helper['parameters']['additionalProperties'])
        self.assertEqual(helper['parameters']['properties']['edit'], TEXT_PATCH_SCHEMA)
        self.assertEqual(adapter.value['tool_choice'], 'auto')
        self.assertEqual(request, original)

    def test_edit_call_compiles_to_native_custom_patch_and_replays_as_native_history(self):
        request = self.request()
        adapter = self.adapter(request)
        call = self.call(adapter)
        native = {key: value for key, value in call.items() if key != 'arguments'} | {
            'name': 'apply_patch', 'type': 'custom_tool_call', 'input': PATCH}
        self.assertEqual(self.response(adapter, [call]), [native])
        request['input'] += [native, {'type': 'custom_tool_call_output', 'call_id': call['call_id'], 'output': 'actual host result'}]
        replayed = self.adapter(request).value['input']
        self.assertIn({'type': 'function_call_output', 'call_id': call['call_id'], 'output': 'actual host result'}, replayed)
        replay = next(item for item in replayed if item.get('call_id') == call['call_id'] and item['type'] == 'function_call')
        self.assertEqual((replay['name'], json.loads(replay['arguments'])), ('apply_patch', {'input': PATCH}))

    def test_streamed_edit_hides_json_deltas_and_matches_done_and_terminal_patch(self):
        adapter = self.adapter()
        call = self.call(adapter)
        raw = call['arguments']
        events = [
            {'type': 'response.output_item.added', 'item': {**call, 'status': 'in_progress', 'arguments': ''}},
            {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': raw[:20]},
            {'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': raw[20:]},
            {'type': 'response.function_call_arguments.done', 'item_id': call['id'], 'arguments': raw},
            {'type': 'response.output_item.done', 'item': call},
            {'type': 'response.completed', 'response': {'status': 'completed', 'output': [call]}}]
        output = self.events(adapter, events, final=True)
        self.assertEqual([event['type'] for event in output],
                         ['response.output_item.added', 'response.output_item.done', 'response.completed'])
        self.assertEqual(output[0]['item']['type'], 'custom_tool_call')
        self.assertEqual(output[0]['item']['input'], '')
        self.assertNotIn('arguments', output[0]['item'])
        self.assertEqual(output[1]['item']['input'], PATCH)
        self.assertEqual(output[1]['item'], output[2]['response']['output'][0])
        self.assertNotIn('koto_replace', json.dumps(output))

    def test_namespace_collision_restores_actual_native_identity(self):
        request = self.request()
        request['tools'] = [{'type': 'namespace', 'name': 'functions', 'tools': request['tools']},
            {'type': 'function', 'name': 'koto_replace', 'parameters': {'type': 'object', 'properties': {}}}]
        adapter = self.adapter(request)
        self.assertNotEqual(self.helper(adapter)['name'], 'koto_replace')
        self.assertIn('prefer ' + self.helper(adapter)['name'] + ';', adapter.value['instructions'])
        self.assertNotIn('prefer koto_replace;', adapter.value['instructions'])
        native = self.response(adapter, [self.call(adapter)])[0]
        self.assertEqual((native['name'], native['namespace'], native['type'], native['input']),
                         ('apply_patch', 'functions', 'custom_tool_call', PATCH))

    def test_interleaved_edit_checks_and_script_keep_their_native_kinds_and_payloads(self):
        adapter = self.adapter()
        spec = {'module_path': 'sample.py', 'function': 'identity',
                'cases': [{'arguments': {'value': 1}, 'expected': 1}]}
        script = 'assert 1 == 1\n'
        helpers = {tool['parameters']['required'][0]: tool['name'] for tool in adapter.value['tools']
                   if tool.get('parameters', {}).get('required') in (['edit'], ['checks'], ['script'])}
        calls = [{**self.call(adapter), 'id': kind + '-item', 'call_id': kind + '-call',
                  'name': helpers[kind], 'arguments': json.dumps({kind: argument})}
                 for kind, argument in (('edit', EDIT), ('checks', spec), ('script', script))]
        events = [{'type': 'response.output_item.added', 'item': {**call, 'arguments': '', 'status': 'in_progress'}}
                  for call in calls]
        events += [{'type': 'response.function_call_arguments.delta', 'item_id': call['id'], 'delta': call['arguments']}
                   for call in reversed(calls)]
        events += [{'type': 'response.output_item.done', 'item': call} for call in calls]
        events += [{'type': 'response.completed', 'response': {'status': 'completed', 'output': calls}}]
        output = self.events(adapter, events, final=True)
        self.assertEqual([event['type'] for event in output],
                         ['response.output_item.added'] * 3 + ['response.output_item.done'] * 3 + ['response.completed'])
        restored = [event['item'] for event in output[3:6]]
        self.assertEqual(restored, output[-1]['response']['output'])
        self.assertEqual([(item['id'], item['call_id']) for item in restored],
                         [(item['id'], item['call_id']) for item in calls])
        self.assertEqual((restored[0]['type'], restored[0]['name'], restored[0]['input']),
                         ('custom_tool_call', 'apply_patch', PATCH))
        for item, command in zip(restored[1:], (compile_named_feedback_checks(spec), compile_script(script))):
            self.assertEqual((item['type'], item['name'], json.loads(item['arguments'])),
                             ('function_call', 'exec_command', {'cmd': command}))

    def test_invalid_edit_data_and_modified_terminal_payload_fail_closed(self):
        for arguments in ({'edit': {**EDIT, 'path': '../outside.py'}}, {'edit': EDIT, 'workdir': '/outside'},
                          {'edit': EDIT, 'cmd': 'unapproved'}, {'edit': {**EDIT, 'old_text': ''}}):
            with self.subTest(arguments=arguments):
                adapter = self.adapter()
                with self.assertRaises(CodexLlamaError):
                    self.response(adapter, [self.call(adapter, arguments=json.dumps(arguments))])
        adapter = self.adapter()
        call = self.call(adapter)
        self.events(adapter, [{'type': 'response.output_item.added', 'item': {**call, 'arguments': '', 'status': 'in_progress'}},
                              {'type': 'response.output_item.done', 'item': call}])
        changed = {**call, 'arguments': json.dumps({'edit': {**EDIT, 'new_text': 'different'}})}
        with self.assertRaises(CodexLlamaError):
            self.events(adapter, [{'type': 'response.completed', 'response': {'status': 'completed', 'output': [changed]}}], final=True)

    def test_edit_and_script_share_the_compiled_payload_cache_bound(self):
        adapter = self.adapter()
        edit_call = self.call(adapter, arguments=json.dumps({'edit': {
            'path': 'sample.py', 'old_text': 'a' * 32000, 'new_text': 'b' * 32000}}))
        script_alias = next(tool['name'] for tool in adapter.value['tools']
                            if tool.get('parameters', {}).get('required') == ['script'])
        script_call = {**edit_call, 'name': script_alias, 'arguments': json.dumps({'script': '#' + 'x' * 31999})}
        calls = [{**base, 'id': 'item-' + str(index), 'call_id': 'call-' + str(index)}
                 for index, base in enumerate([edit_call] * 5 + [script_call] * 7)]
        with self.assertRaises(CodexLlamaError):
            self.response(adapter, calls)

    def test_only_original_unique_identified_native_patch_and_auto_choice_offer_edit(self):
        original = self.request()
        patch = next(tool for tool in original['tools'] if tool['name'] == 'apply_patch')
        cases = []
        for choice in ('none', 'required', {'type': 'function', 'name': 'exec_command'}):
            request = deepcopy(original)
            request['tool_choice'] = choice
            cases.append(request)
        request = deepcopy(original)
        next(tool for tool in request['tools'] if tool['name'] == 'apply_patch')['description'] += ' changed'
        cases.append(request)
        request = deepcopy(original)
        request['tools'].append({'type': 'namespace', 'name': 'functions', 'tools': [deepcopy(patch)]})
        cases.append(request)
        for namespace, kind in (('other', 'custom'), ('functions', 'function'), ('functions', 'regex')):
            request = deepcopy(original)
            request['tools'] = [tool for tool in request['tools'] if tool['name'] != 'apply_patch']
            altered = deepcopy(patch)
            if kind == 'function':
                altered = {'type': 'function', 'name': 'apply_patch',
                           'parameters': {'type': 'object', 'properties': {'input': {'type': 'string'}}}}
            elif kind == 'regex':
                altered['format']['syntax'] = 'regex'
            request['tools'].append({'type': 'namespace', 'name': namespace, 'tools': [altered]})
            cases.append(request)
        request = deepcopy(original)
        request['tools'] = [tool for tool in request['tools'] if tool['name'] != 'apply_patch']
        request['input'] += [{'type': 'tool_search_output', 'execution': 'client', 'call_id': 'loaded', 'tools': [patch]}]
        cases.append(request)
        for index, request in enumerate(cases):
            with self.subTest(index=index):
                self.assertFalse(any(tool.get('parameters', {}).get('required') == ['edit']
                                     for tool in self.adapter(request).value['tools']))
        for harness in (None, 'qwen-code.v8'):
            with self.subTest(harness=harness):
                self.assertFalse(any(tool.get('parameters', {}).get('required') == ['edit']
                                     for tool in self.adapter(original, harness=harness).value['tools']))

    def test_registration_capacity_preserves_typed_then_script_slot_priority(self):
        for count, required in ((1021, [['edit'], ['checks'], ['script']]),
                                (1022, [['checks'], ['script']]), (1023, [['checks']]), (1024, [])):
            with self.subTest(count=count):
                request = self.request()
                request['tools'] += [{'type': 'function', 'name': 'extra_' + str(index),
                    'parameters': {'type': 'object', 'properties': {}}}
                    for index in range(count - len(request['tools']))]
                tools = self.adapter(request).value['tools']
                self.assertEqual(len(tools), 1024)
                self.assertEqual([tool['parameters']['required'] for tool in tools[:len(required)]], required)
                self.assertEqual(tools[len(required):], CodexLlamaRequest(request).value['tools'])

    def test_edit_and_verification_share_stream_argument_limit_and_call_identity(self):
        adapter = self.adapter()
        edit = self.call(adapter)
        checks = next(tool for tool in adapter.value['tools'] if tool.get('parameters', {}).get('required') == ['checks'])
        other = {**edit, 'id': 'checks-item', 'call_id': 'checks-call', 'name': checks['name']}
        self.events(adapter, [{'type': 'response.output_item.added',
                              'item': {**item, 'arguments': '', 'status': 'in_progress'}} for item in (edit, other)])
        self.events(adapter, [{'type': 'response.function_call_arguments.delta', 'item_id': edit['id'], 'delta': 'x' * 32768}])
        with self.assertRaises(CodexLlamaError):
            self.events(adapter, [{'type': 'response.function_call_arguments.delta', 'item_id': other['id'], 'delta': 'x' * 32769}])
        adapter = self.adapter()
        edit = self.call(adapter)
        duplicate = {**edit, 'name': 'exec_command', 'arguments': '{"cmd":"true"}'}
        with self.assertRaises(CodexLlamaError):
            self.response(adapter, [edit, duplicate])
        adapter = self.adapter()
        edit = self.call(adapter)
        self.events(adapter, [{'type': 'response.output_item.added', 'item': {**edit, 'arguments': '', 'status': 'in_progress'}}])
        with self.assertRaises(CodexLlamaError):
            self.events(adapter, [{'type': 'response.output_item.done', 'item': {**edit, 'call_id': 'changed-call'}}])


if __name__ == '__main__':
    unittest.main()
