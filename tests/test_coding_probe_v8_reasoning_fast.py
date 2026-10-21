"""Transparent native reasoning crosses only the explicitly selected v8 probe."""
from copy import deepcopy
from email.message import Message
from pathlib import Path
import json
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from hormuz.coding_probe import HEADER, ProbeError
from hormuz.coding_qualification import request_profile_digest
from tests import test_coding_probe_v5_fast as probe_fixture


class CodingProbeV8ReasoningTests(unittest.TestCase):
    def prepare(self, *, version=5, capability='qwen_code_v8'):
        fixture = probe_fixture.CodingProbeV5Tests()
        probe, plan, request, target = fixture.prepare(version=version,
            capability=capability, seconds=90 if version == 4 else 180)
        native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
        request['tools'] = [native['declarations']['exec_command']]
        request['reasoning'] = {'effort': 'low'}
        plan['subject']['request_profile_sha256'] = request_profile_digest(request, schema_version=4)
        fixture.arm(probe, plan)
        self.submit(probe, request)
        continuation = deepcopy(request)
        continuation['input'] += [
            {'type': 'reasoning', 'id': 'rs-saved', 'summary': [],
             'content': [{'type': 'reasoning_text', 'text': 'Read the saved source before editing.'}]},
            {'type': 'function_call', 'name': 'exec_command', 'call_id': 'native-read',
             'arguments': '{"cmd":"cat solution.py"}', 'status': 'completed'},
            {'type': 'function_call_output', 'call_id': 'native-read',
             'output': 'Actual native source read; process exited with code 0.'}]
        return probe, continuation, target

    def submit(self, probe, request, *, work_id='work', actor='actor'):
        headers = Message()
        headers[HEADER], headers['User-Agent'] = probe.probe_id, 'codex_exec/0.160.0'
        handler = NS(headers=headers, path='/v1/responses', _work_id=work_id,
                     _work_conversation='conversation')
        decision = NS(requested_model=probe.plan['model'], resolved_alias=probe.plan['model'], route=object())
        with patch('hormuz.coding_probe.time.monotonic', return_value=101):
            probe.check(handler, NS(actor_id=actor), decision, request, client='codex', claim=True)
        return handler

    def test_native_reasoning_tool_call_and_result_continue_the_same_v8_probe(self):
        for version in (4, 5):
            with self.subTest(version=version):
                probe, continuation, _ = self.prepare(version=version)
                self.submit(probe, continuation)
                self.assertEqual(probe.count, 2)
                with patch('hormuz.coding_probe.time.monotonic', return_value=101):
                    self.assertEqual(probe.status()['automatic_admission_effect'], 'none')

    def test_cleartext_summary_and_empty_encrypted_placeholder_are_transparent(self):
        probe, continuation, _ = self.prepare()
        continuation['input'][1] = {'type': 'reasoning', 'status': 'completed',
            'encrypted_content': None, 'content': [],
            'summary': [{'type': 'summary_text', 'text': 'Inspect the actual saved function.'}]}
        self.submit(probe, continuation)
        self.assertEqual(probe.count, 2)

    def test_other_profiles_and_old_probe_versions_keep_rejecting_reasoning(self):
        for capability in ('qwen_code_v' + str(i) for i in range(1, 8)):
            with self.subTest(capability=capability):
                probe, continuation, _ = self.prepare(capability=capability)
                with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
                    self.submit(probe, continuation)
                self.assertEqual(probe.count, 1)
        probe, continuation, _ = self.prepare()
        probe.plan['schema_version'] = 3
        with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
            self.submit(probe, continuation)

    def test_encrypted_opaque_malformed_or_incomplete_reasoning_is_denied(self):
        variants = [
            {'type': 'reasoning', 'encrypted_content': 'opaque-provider-state'},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text'}], 'encrypted_content': 'opaque'},
            {'type': 'reasoning', 'summary': []},
            {'type': 'reasoning', 'content': 'not-parts'},
            {'type': 'reasoning', 'content': [{'type': 'input_text', 'text': 'text'}]},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 7}]},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text', 'ref': 'opaque'}]},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text'}], 'status': 'in_progress'},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text'}], 'role': 'user'},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text'}], 'summary': [{'type': 'item_reference', 'id': 'opaque'}]},
        ]
        for item in variants:
            with self.subTest(item=item):
                probe, continuation, _ = self.prepare()
                continuation['input'][1] = item
                with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
                    self.submit(probe, continuation)
                self.assertEqual(probe.count, 1)

    def test_reasoning_does_not_relax_prefix_profile_actor_work_or_generation(self):
        for change in ('first_prefix', 'new_user', 'new_developer', 'tools', 'effort', 'actor', 'work', 'generation'):
            with self.subTest(change=change):
                probe, continuation, target = self.prepare()
                options = {}
                if change == 'first_prefix': continuation['input'][0]['content'] = 'Another task.'
                elif change == 'new_user': continuation['input'].append({'role': 'user', 'content': 'Another task.'})
                elif change == 'new_developer': continuation['input'].append({'role': 'developer', 'content': 'New authority.'})
                elif change == 'tools': continuation['tools'] = []
                elif change == 'effort': continuation['reasoning']['effort'] = 'high'
                elif change == 'actor': options['actor'] = 'other-actor'
                elif change == 'work': options['work_id'] = 'different-conversation-work'
                else: target.generation = 'new-generation'
                with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
                    self.submit(probe, continuation, **options)
                self.assertEqual(probe.count, 1)

    def test_accepted_reasoning_is_bound_in_the_next_exact_prefix_and_cannot_replay(self):
        probe, continuation, _ = self.prepare()
        self.submit(probe, continuation)
        with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
            self.submit(probe, continuation)
        changed = deepcopy(continuation)
        changed['input'][1]['content'][0]['text'] = 'Changed previous reasoning.'
        changed['input'].append({'role': 'assistant', 'content': 'Continue.'})
        with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
            self.submit(probe, changed)
        extended = deepcopy(continuation)
        extended['input'].append({'role': 'assistant', 'content': 'Continue.'})
        self.submit(probe, extended)
        self.assertEqual(probe.count, 3)


if __name__ == '__main__':
    unittest.main()
