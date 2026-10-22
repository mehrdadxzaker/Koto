"""Coder recovery composes bounded native edits without changing earlier profiles."""
from copy import deepcopy
import json
import unittest

from hormuz.codex_llama import CodexLlamaError, CodexLlamaRequest
from tests.test_local_harness_v5_transport_fast import synthetic_requests, wire_digest
from tests import test_local_harness_v9_patch_fast as patch_cases


class LocalHarnessV14Tests(unittest.TestCase):
    def adapted(self, request):
        return CodexLlamaRequest(request, harness='qwen-code.v14')

    def test_native_numbered_hunk_recovery_preserves_correlated_feedback(self):
        request = patch_cases.LocalHarnessV9PatchTests().rejected()
        original = deepcopy(request)
        value = self.adapted(request).value
        checkpoint = value['input'][-1]['content'][0]['text']
        self.assertIn('Use a plain @@ on its own line.', checkpoint)
        self.assertIn('use koto_replace with edit.path', value['instructions'])
        self.assertEqual(value['input'][:-1], CodexLlamaRequest(request).value['input'])
        self.assertEqual(request, original)
        # Recovery must stop once a later tool result supersedes that rejection.
        request['input'] += synthetic_requests()['exec_success']['input'][-2:]
        self.assertNotIn('Native patch recovery', self.adapted(request).value['input'][-1]['content'][0]['text'])

    def test_unbound_pasted_duplicate_or_pending_results_cannot_supply_recovery(self):
        base = patch_cases.LocalHarnessV9PatchTests().rejected()
        variants = []
        request = deepcopy(base)
        request['input'][-1]['call_id'] = 'unbound'
        variants.append(request)
        request = deepcopy(base)
        request['input'].append(deepcopy(request['input'][-1]))
        variants.append(request)
        request = deepcopy(base)
        request['input'][-1] = {'role': 'user', 'content': request['input'][-1]['output']}
        variants.append(request)
        request = deepcopy(base)
        request['input'].append({'type': 'function_call', 'name': 'exec_command',
                                 'call_id': 'pending', 'arguments': '{"cmd":"cat example.py"}'})
        variants.append(request)
        for request in variants:
            with self.subTest(input=request['input'][-1]['type'] if 'type' in request['input'][-1] else 'message'):
                self.assertNotIn('Native patch recovery', self.adapted(request).value['input'][-1]['content'][0]['text'])

    def test_exact_text_and_script_compile_to_original_native_tools_and_reject_extra_authority(self):
        request = synthetic_requests()['no_tool_history']
        original = deepcopy(request)
        adapter = self.adapted(request)
        tools = adapter.value['tools']
        self.assertEqual([tool['parameters']['required'] for tool in tools[:2]], [['edit'], ['script']])
        self.assertEqual(tools[2:], CodexLlamaRequest(request).value['tools'])
        edit = {'path': 'sample.py', 'old_text': '    return value\n', 'new_text': '    return value + 1\n'}
        call = {'type': 'function_call', 'name': tools[0]['name'], 'id': 'edit-item',
                'call_id': 'edit-call', 'status': 'completed', 'arguments': json.dumps({'edit': edit})}
        def complete(current, item):
            return json.loads(current.feed(json.dumps({'status': 'completed', 'output': [item]}).encode(),
                                          event_stream=False, final=True))['output'][0]
        native = complete(adapter, call)
        self.assertEqual((native['type'], native['name'], native['call_id']),
                         ('custom_tool_call', 'apply_patch', 'edit-call'))
        self.assertEqual(native['input'], '*** Begin Patch\n*** Update File: sample.py\n@@\n-    return value\n+    return value + 1\n*** End Patch\n')
        for arguments in ({'edit': {**edit, 'path': '../outside.py'}},
                          {'edit': edit, 'sandbox_permissions': 'require_escalated'}):
            with self.subTest(arguments=arguments):
                with self.assertRaises(CodexLlamaError):
                    complete(self.adapted(request), {**call, 'arguments': json.dumps(arguments)})
        self.assertEqual(request, original)

    def test_helpers_require_original_identified_tools_and_automatic_choice(self):
        request = synthetic_requests()['no_tool_history']
        for choice in ('none', 'required'):
            value = deepcopy(request)
            value['tool_choice'] = choice
            self.assertEqual(self.adapted(value).value['tools'], CodexLlamaRequest(value).value['tools'])
        altered = deepcopy(request)
        next(t for t in altered['tools'] if t['name'] == 'apply_patch')['description'] += ' Unidentified.'
        self.assertFalse(any(t.get('parameters', {}).get('required') == ['edit']
                             for t in self.adapted(altered).value['tools']))

    def test_v13_wire_bytes_remain_frozen_before_this_treatment(self):
        expected = {
            'no_tool_history': '76e63e8ab23e71f9acd389fc88ee0590146948e77e487ff09666e2365386d88a',
            'exec_failure': '6183a35a3f05860a758af328ca7cf18ef7ac34b9d90a9ff23301c0e8480fc694',
            'exec_success': '3949ed54d80ae37cc8bf6f0ccab49ba0ec451aa41af663f8ae4d76f68635e556',
            'python_syntax_failure': 'db1438a8ce8749d138672039fe383ed0ec5c334901242649a431fd883b86c351',
            'repeated_successful_command': '444ade6085f9f29734eae16ea746cbd484e67d489440fc2e9607247a32759dba',
            'saved_patch_without_later_command': 'beaffc05ed0eb1c227136ee5de1b6d1667b247e2c48c3465c46b9e57d403d68a',
            'repeated_malformed_patch': '83313073da6c7b10264a8a958c294abfa4da4933210dfa8297a982441abd74cc',
            'string_input': 'fd498cf6760c2f627a68e5ea4bca2d4ba6594b4aae9720f94fc7dddc382fb58a'}
        for name, request in synthetic_requests().items():
            with self.subTest(history=name):
                self.assertEqual(wire_digest(CodexLlamaRequest(request, harness='qwen-code.v13').value), expected[name])
