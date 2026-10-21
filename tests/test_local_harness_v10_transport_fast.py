"""The smaller local interface preserves native tools, feedback and authority."""
from copy import deepcopy
import json
import unittest

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest
from hormuz.local_python_script import SCRIPT_SCHEMA, compile_script
from hormuz.local_text_patch import TEXT_PATCH_SCHEMA, compile_text_patch
from tests.test_local_harness_v5_transport_fast import synthetic_requests


SCRIPT = ('import unittest\nfrom solution import transform\n'
          'check = unittest.TestCase()\ncheck.assertEqual(transform(3), 4)\n')
EDIT = {'path': 'solution.py', 'old_text': '    return value\n',
        'new_text': '    return value + 1\n'}


class LocalHarnessV10TransportTests(unittest.TestCase):
    def request(self, history='no_tool_history'):
        value = synthetic_requests()[history]
        value.update(reasoning={'effort': 'low'}, max_output_tokens=2048)
        return value

    def adapter(self, request=None):
        return CodexLlamaRequest(self.request() if request is None else request, harness='qwen-code.v10')

    def helper_kinds(self, value):
        return [tool['parameters']['required'][0] for tool in value['tools']
                if tool.get('parameters', {}).get('required') in (['edit'], ['script'])]

    def call(self, adapter, kind, payload, *, suffix=''):
        helper = next(tool for tool in adapter.value['tools']
                      if tool.get('parameters', {}).get('required') == [kind])
        arguments = {kind: payload}
        if kind == 'script':
            arguments['workdir'] = '/native/workspace'
        return {'type': 'function_call', 'id': kind + '-item' + suffix,
                'call_id': kind + '-call' + suffix, 'name': helper['name'], 'status': 'completed',
                'arguments': json.dumps(arguments)}

    def native(self, adapter, call):
        response = {'status': 'completed', 'output': [call]}
        return json.loads(adapter.feed(json.dumps(response).encode(), event_stream=False, final=True))['output'][0]

    def feedback(self, code=0, text='', *, pending=False):
        status = 'Process running with session ID 17' if pending else f'Process exited with code {code}'
        return f'Chunk ID: native-check\nWall time: 0.0001 seconds\n{status}\nOutput:\n{text}'

    def completed_script(self, request, script=SCRIPT, *, code=0, text='', pending=False, suffix=''):
        adapter = self.adapter(request)
        native = self.native(adapter, self.call(adapter, 'script', script, suffix=suffix))
        request['input'] += [native, {'type': 'function_call_output', 'call_id': native['call_id'],
                                    'output': self.feedback(code, text, pending=pending)}]
        return native

    def test_only_edit_and_script_helpers_precede_unchanged_native_tools(self):
        request = self.request()
        original = deepcopy(request)
        plain = CodexLlamaRequest(request).value
        adapted = self.adapter(request).value
        self.assertEqual(self.helper_kinds(adapted), ['edit', 'script'])
        self.assertEqual(adapted['tools'][2:], plain['tools'])
        self.assertEqual(adapted['tools'][0]['parameters']['properties']['edit'], TEXT_PATCH_SCHEMA)
        self.assertEqual(adapted['tools'][1]['parameters']['properties']['script'], SCRIPT_SCHEMA)
        self.assertEqual(adapted['tool_choice'], request['tool_choice'])
        self.assertEqual(adapted['input'][:-1], plain['input'])
        for tool in adapted['tools'][:2]:
            self.assertIn(tool['name'], adapted['instructions'])
        for obsolete in ('koto_python_checks', 'function-case helper', 'atomic_batch', 'same_as'):
            self.assertNotIn(obsolete, adapted['instructions'])
            self.assertNotIn(obsolete, adapted['input'][-1]['content'][0]['text'])
        self.assertEqual(request, original)

    def test_nonautomatic_choices_and_unidentified_declarations_cannot_gain_authority(self):
        for choice in ('none', 'required', {'type': 'function', 'name': 'exec_command'}):
            with self.subTest(choice=choice):
                request = self.request()
                request['tool_choice'] = choice
                adapted = self.adapter(request).value
                self.assertEqual(adapted['tools'], CodexLlamaRequest(request).value['tools'])
                self.assertEqual(adapted['tool_choice'], choice)
                self.assertNotIn('koto_python', adapted['instructions'])
                self.assertNotIn('koto_replace', adapted['instructions'])
        for modified, remaining in (('exec_command', ['edit']), ('apply_patch', ['script'])):
            with self.subTest(modified=modified):
                request = self.request()
                target = next(tool for tool in request['tools'] if tool['name'] == modified)
                target['description'] += ' Unpinned host declaration.'
                adapted = self.adapter(request).value
                self.assertEqual(self.helper_kinds(adapted), remaining)
                self.assertEqual(adapted['tools'][len(remaining):], CodexLlamaRequest(request).value['tools'])
        adapter = self.adapter()
        call = self.call(adapter, 'script', SCRIPT)
        call['arguments'] = json.dumps({'script': SCRIPT, 'sandbox_permissions': 'require_escalated'})
        with self.assertRaises(CodexLlamaError):
            self.native(adapter, call)

    def test_colliding_aliases_restore_actual_native_namespace_and_original_tool_order(self):
        request = self.request()
        request['tools'] = [{'type': 'namespace', 'name': 'functions', 'tools': request['tools']}, *[
            {'type': 'function', 'name': name, 'parameters': {'type': 'object', 'properties': {}}}
            for name in ('koto_python', 'koto_replace')]]
        original = deepcopy(request)
        adapter = self.adapter(request)
        self.assertEqual(adapter.value['tools'][2:], CodexLlamaRequest(request).value['tools'])
        for kind, base, payload, native_name in (('edit', 'koto_replace', EDIT, 'apply_patch'),
                                                ('script', 'koto_python', SCRIPT, 'exec_command')):
            with self.subTest(kind=kind):
                call = self.call(adapter, kind, payload)
                self.assertNotEqual(call['name'], base)
                self.assertIn(call['name'], adapter.value['instructions'])
                native = self.native(adapter, call)
                self.assertEqual((native['name'], native['namespace']), (native_name, 'functions'))
        self.assertEqual(request, original)

    def test_limited_catalog_prioritizes_script_and_never_drops_native_tools(self):
        for count, expected in ((1022, ['edit', 'script']), (1023, ['script']), (1024, [])):
            with self.subTest(native_count=count):
                request = self.request()
                request['tools'] += [{'type': 'function', 'name': 'host_' + str(index),
                    'parameters': {'type': 'object', 'properties': {}, 'required': []}}
                    for index in range(count - len(request['tools']))]
                adapted = self.adapter(request).value
                self.assertEqual(len(adapted['tools']), 1024)
                self.assertEqual(self.helper_kinds(adapted), expected)
                self.assertEqual(adapted['tools'][len(expected):], CodexLlamaRequest(request).value['tools'])
                if 'edit' not in expected:
                    self.assertNotIn('koto_replace', adapted['instructions'])
                if 'script' not in expected:
                    self.assertNotIn('koto_python', adapted['instructions'])

    def test_compute_hints_follow_correlated_native_feedback_and_latest_saved_code(self):
        self.assertEqual(self.adapter().value['reasoning_budget_tokens'], 32)
        saved = self.request('saved_patch_without_later_command')
        self.assertEqual(self.adapter(saved).value['reasoning_budget_tokens'], 64)
        variants = [('print', 'print(4)', 0, False, 256),
                    ('failed', SCRIPT, 1, False, 256),
                    ('pending', SCRIPT, 0, True, 256),
                    ('verified', SCRIPT, 0, False, 16)]
        for name, script, code, pending, budget in variants:
            with self.subTest(feedback=name):
                request = deepcopy(saved)
                native = self.completed_script(request, script, code=code, pending=pending)
                original = deepcopy(request)
                adapted = self.adapter(request).value
                self.assertEqual(adapted['reasoning_budget_tokens'], budget)
                self.assertEqual(json.loads(native['arguments']),
                                 {'cmd': compile_script(script), 'workdir': '/native/workspace'})
                self.assertEqual(adapted['input'][-2], request['input'][-1])
                self.assertEqual(request, original)
                if pending:
                    self.assertIn('pending sessions: 1', adapted['input'][-1]['content'][0]['text'])
        request = deepcopy(saved)
        self.completed_script(request, code=1, text='AssertionError\nprivate-failure-detail\n', suffix='-failed')
        self.completed_script(request, suffix='-passing')
        adapted = self.adapter(request).value
        self.assertEqual(adapted['reasoning_budget_tokens'], 16)
        self.assertNotIn('Assertion failure checkpoint:', adapted['input'][-1]['content'][0]['text'])
        self.assertNotIn('private-failure-detail', adapted['input'][-1]['content'][0]['text'])
        # An unknown later result cannot inherit a prior finishing hint.
        request['input'].append({'type': 'function_call_output', 'call_id': 'unbound', 'output': self.feedback()})
        self.assertEqual(self.adapter(request).value['reasoning_budget_tokens'], 256)
        none = self.request()
        none['reasoning']['effort'] = 'none'
        self.assertEqual(self.adapter(none).value['reasoning_budget_tokens'], 0)
        string = self.request()
        string['input'] = 'Original request.'
        self.assertEqual(self.adapter(string).value['reasoning_budget_tokens'], 256)

    def test_interleaved_edit_and_script_streams_emit_only_matching_native_calls(self):
        adapter = self.adapter()
        calls = [self.call(adapter, 'edit', EDIT), self.call(adapter, 'script', SCRIPT)]
        events = [{'type': 'response.output_item.added',
                   'item': {**call, 'arguments': '', 'status': 'in_progress'}} for call in calls]
        for call in calls:
            split = len(call['arguments']) // 2
            for fragment in ('', call['arguments'][:split], call['arguments'][split:]):
                events.append({'type': 'response.function_call_arguments.delta', 'item_id': call['id'],
                               'delta': fragment})
        for call in calls:
            events += [{'type': 'response.function_call_arguments.done', 'item_id': call['id'],
                        'arguments': call['arguments']}, {'type': 'response.output_item.done', 'item': call}]
        events.append({'type': 'response.completed', 'response': {'status': 'completed', 'output': calls}})
        raw = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events).encode()
        output = [json.loads(line[5:]) for line in adapter.feed(raw, event_stream=True, final=True).decode().splitlines()
                  if line.startswith('data:')]
        self.assertEqual([item['type'] for item in output],
                         ['response.output_item.added'] * 2 + ['response.output_item.done'] * 2 + ['response.completed'])
        self.assertEqual(output[0]['item']['input'], '')
        self.assertEqual(output[1]['item']['arguments'], '')
        restored = output[-1]['response']['output']
        self.assertEqual([item['item'] for item in output[2:4]], restored)
        self.assertEqual((restored[0]['type'], restored[0]['name'], restored[0]['input']),
                         ('custom_tool_call', 'apply_patch', compile_text_patch(EDIT)))
        self.assertEqual((restored[1]['type'], restored[1]['name']), ('function_call', 'exec_command'))
        self.assertEqual(json.loads(restored[1]['arguments']),
                         {'cmd': compile_script(SCRIPT), 'workdir': '/native/workspace'})
        self.assertNotIn('koto_python', json.dumps(output))
        self.assertNotIn('koto_replace', json.dumps(output))
        self.assertEqual(adapter.derived_buffer_bytes, 0)


if __name__ == '__main__':
    unittest.main()
