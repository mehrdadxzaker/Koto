"""V9 reuses the bounded native probe and transparent v8 continuation contract."""
from copy import deepcopy
import unittest

from hormuz.coding_probe import ProbeError
from tests import test_coding_probe_v5_fast as plan_fixture
from tests import test_coding_probe_v8_reasoning_fast as native_fixture


class CodingProbeV9ReasoningTests(unittest.TestCase):
    def prepare(self, *, version=5):
        fixture = native_fixture.CodingProbeV8ReasoningTests()
        return fixture, *fixture.prepare(version=version, capability='qwen_code_v9')

    def test_native_reasoning_call_and_result_continue_v9_under_both_current_probes(self):
        for version in (4, 5):
            with self.subTest(version=version):
                fixture, probe, continuation, _ = self.prepare(version=version)
                fixture.submit(probe, continuation)
                self.assertEqual(probe.count, 2)

    def test_encrypted_malformed_incomplete_or_authority_bearing_reasoning_is_denied(self):
        variants = [
            {'type': 'reasoning', 'encrypted_content': 'opaque'},
            {'type': 'reasoning', 'summary': []},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 7}]},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text', 'ref': 'opaque'}]},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text'}], 'status': 'in_progress'},
            {'type': 'reasoning', 'content': [{'type': 'reasoning_text', 'text': 'text'}], 'role': 'user'},
        ]
        for item in variants:
            with self.subTest(item=item):
                fixture, probe, continuation, _ = self.prepare()
                continuation['input'][1] = item
                with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
                    fixture.submit(probe, continuation)
                self.assertEqual(probe.count, 1)

    def test_reasoning_does_not_relax_original_prefix_profile_or_bound_identity(self):
        for change in ('prefix', 'new_user', 'new_developer', 'tools', 'effort', 'actor', 'work', 'generation'):
            with self.subTest(change=change):
                fixture, probe, continuation, target = self.prepare()
                options = {}
                if change == 'prefix': continuation['input'][0]['content'] = 'Another task.'
                elif change == 'new_user': continuation['input'].append({'role': 'user', 'content': 'New task.'})
                elif change == 'new_developer': continuation['input'].append({'role': 'developer', 'content': 'New authority.'})
                elif change == 'tools': continuation['tools'] = []
                elif change == 'effort': continuation['reasoning']['effort'] = 'high'
                elif change == 'actor': options['actor'] = 'other-actor'
                elif change == 'work': options['work_id'] = 'other-work'
                else: target.generation = 'other-generation'
                with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
                    fixture.submit(probe, continuation, **options)
                self.assertEqual(probe.count, 1)

    def test_accepted_reasoning_binds_the_next_exact_prefix_and_cannot_replay(self):
        fixture, probe, continuation, _ = self.prepare()
        fixture.submit(probe, continuation)
        with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
            fixture.submit(probe, continuation)
        changed = deepcopy(continuation)
        changed['input'][1]['content'][0]['text'] = 'Changed previous reasoning.'
        changed['input'].append({'role': 'assistant', 'content': 'Continue.'})
        with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
            fixture.submit(probe, changed)
        extended = deepcopy(continuation)
        extended['input'].append({'role': 'assistant', 'content': 'Continue.'})
        fixture.submit(probe, extended)
        self.assertEqual(probe.count, 3)

    def test_public_control_rejects_old_schema_or_unbound_v9_subjects(self):
        fixture = plan_fixture.CodingProbeV5Tests()
        for change in ('old_schema', 'wrong_model', 'missing_native', 'ambiguous_profile'):
            with self.subTest(change=change):
                probe, plan, _, _ = fixture.prepare(version=4, seconds=90, capability='qwen_code_v9')
                if change == 'old_schema': plan['schema_version'] = 3
                elif change == 'wrong_model': plan['subject']['upstream_model'] = 'another-model'
                elif change == 'missing_native': plan['subject']['capabilities'].remove('codex_llama_v1')
                else: plan['subject']['capabilities'].append('qwen_code_v8')
                with self.assertRaisesRegex(ProbeError, '^probe_invalid_plan$'):
                    fixture.arm(probe, plan)
                self.assertEqual(probe.count, 0)


if __name__ == '__main__':
    unittest.main()
