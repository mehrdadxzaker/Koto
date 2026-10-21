"""The new treatment is explicit and cannot reuse another model or profile's evidence."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.coding_probe import ProbeError
from hormuz.contracts import ContractValidationError, validate_contract
from hormuz.local_harness import profile_for_capabilities
from tests import test_coding_probe_v5_fast as plan_fixture
from tests import test_coding_probe_v8_reasoning_fast as native_fixture


class LocalHarnessV10ContractTests(unittest.TestCase):
    def record(self, filename):
        value = json.loads((Path(__file__).parent / 'fixtures' / filename).read_text())
        subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
        subject['capabilities'].append('qwen_code_v10')
        subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'
        return value

    def validate(self, value):
        if 'plan' in value:
            value['plan_sha256'] = canonical_digest(value['plan'])
        validate_contract(value)

    def test_current_setup_probe_and_evidence_bind_only_the_explicit_v10_treatment(self):
        for filename in ('local-setup-profile-v5.json', 'coding-probe-plan-v4.json',
                         'local-coding-evidence-v4.json'):
            with self.subTest(record=filename):
                original = self.record(filename)
                self.validate(original)
                for change in ('old_schema', 'wrong_model', 'missing_native', *range(1, 10)):
                    with self.subTest(change=change):
                        value = deepcopy(original)
                        subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
                        if change == 'old_schema':
                            value['schema_version'] -= 1
                        elif change == 'wrong_model':
                            subject['model' if 'model' in subject else 'upstream_model'] = 'another-model'
                        elif change == 'missing_native':
                            subject['capabilities'].remove('codex_llama_v1')
                        else:
                            subject['capabilities'].append('qwen_code_v' + str(change))
                        with self.assertRaises(ContractValidationError):
                            self.validate(value)
        self.assertEqual(profile_for_capabilities(['responses', 'codex_llama_v1', 'qwen_code_v10']), 'qwen-code.v10')
        self.assertIsNone(profile_for_capabilities(['responses', 'codex_llama_v1']))
        with self.assertRaisesRegex(ValueError, 'ambiguous_local_harness'):
            profile_for_capabilities(['qwen_code_v9', 'qwen_code_v10'])

    def test_public_probe_rejects_old_or_unbound_subjects_without_submitting_work(self):
        fixture = plan_fixture.CodingProbeV5Tests()
        for change in ('old_schema', 'wrong_model', 'missing_native', 'mixed_profile'):
            with self.subTest(change=change):
                probe, plan, _, _ = fixture.prepare(version=4, seconds=90, capability='qwen_code_v10')
                if change == 'old_schema': plan['schema_version'] = 3
                elif change == 'wrong_model': plan['subject']['upstream_model'] = 'another-model'
                elif change == 'missing_native': plan['subject']['capabilities'].remove('codex_llama_v1')
                else: plan['subject']['capabilities'].append('qwen_code_v9')
                with self.assertRaisesRegex(ProbeError, '^probe_invalid_plan$'):
                    fixture.arm(probe, plan)
                self.assertEqual(probe.count, 0)

    def test_transparent_native_reasoning_continues_but_opaque_state_and_replay_are_denied(self):
        for version in (4, 5):
            with self.subTest(version=version):
                fixture = native_fixture.CodingProbeV8ReasoningTests()
                probe, continuation, _ = fixture.prepare(version=version, capability='qwen_code_v10')
                opaque = deepcopy(continuation)
                opaque['input'][1]['encrypted_content'] = 'opaque-state'
                with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
                    fixture.submit(probe, opaque)
                self.assertEqual(probe.count, 1)
                fixture.submit(probe, continuation)
                self.assertEqual(probe.count, 2)
                with self.assertRaisesRegex(ProbeError, '^probe_request_mismatch$'):
                    fixture.submit(probe, continuation)
                self.assertEqual(probe.count, 2)


if __name__ == '__main__':
    unittest.main()
