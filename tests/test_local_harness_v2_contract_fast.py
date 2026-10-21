"""The revised Qwen shape is explicit without changing older envelopes."""
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.contracts import ContractValidationError, validate_contract


class LocalHarnessV2ContractTests(unittest.TestCase):
    def record(self, name):
        value = json.loads((Path(__file__).parent / 'fixtures' / name).read_text())
        subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
        subject['capabilities'].append('qwen_code_v2')
        subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'
        return value, subject

    def validate(self, value):
        if 'plan' in value:
            value['plan_sha256'] = canonical_digest(value['plan'])
        validate_contract(value)

    def test_v2_accepts_only_the_current_bounded_setup_probe_and_evidence(self):
        for name, older in [('local-setup-profile-v5.json', 4),
                            ('coding-probe-plan-v4.json', 3),
                            ('local-coding-evidence-v4.json', 3)]:
            with self.subTest(record=name):
                value, _ = self.record(name)
                self.validate(value)
                value['schema_version'] = older
                with self.assertRaises(ContractValidationError):
                    self.validate(value)

    def test_v2_requires_one_harness_the_exact_model_and_native_transport(self):
        for name in ['local-setup-profile-v5.json', 'coding-probe-plan-v4.json',
                     'local-coding-evidence-v4.json']:
            for invalid in ['both_harnesses', 'wrong_model', 'missing_transport']:
                with self.subTest(record=name, invalid=invalid):
                    value, subject = self.record(name)
                    if invalid == 'both_harnesses':
                        subject['capabilities'].append('qwen_code_v1')
                    elif invalid == 'wrong_model':
                        subject['model' if 'model' in subject else 'upstream_model'] = 'another-model'
                    else:
                        subject['capabilities'].remove('codex_llama_v1')
                    with self.assertRaises(ContractValidationError):
                        self.validate(value)


if __name__ == '__main__':
    unittest.main()
