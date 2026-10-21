"""Recovery guidance requires its own explicit, mutually exclusive capability."""
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.contracts import ContractValidationError, validate_contract


class LocalHarnessV3ContractTests(unittest.TestCase):
    def record(self, name, *, version=None):
        value = json.loads((Path(__file__).parent / 'fixtures' / name).read_text())
        subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
        subject['capabilities'].append('qwen_code_v3')
        subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'
        if version is not None:
            value['schema_version'] = version
        return value, subject

    def validate(self, value):
        if 'plan' in value:
            value['plan_sha256'] = canonical_digest(value['plan'])
        validate_contract(value)

    def test_v3_uses_current_envelopes_and_older_envelopes_still_reject_it(self):
        for name, older in [('local-setup-profile-v5.json', 4),
                            ('coding-probe-plan-v4.json', 3),
                            ('local-coding-evidence-v4.json', 3)]:
            with self.subTest(record=name):
                value, _ = self.record(name)
                self.validate(value)
                value['schema_version'] = older
                with self.assertRaises(ContractValidationError):
                    self.validate(value)
        value, _ = self.record('coding-probe-plan-v4.json', version=5)
        value['max_elapsed_seconds'] = 180
        self.validate(value)
        value['schema_version'] = 4
        with self.assertRaises(ContractValidationError):
            self.validate(value)

    def test_v3_cannot_mix_with_either_previous_harness_or_bypass_eligibility(self):
        for name in ['local-setup-profile-v5.json', 'coding-probe-plan-v4.json',
                     'local-coding-evidence-v4.json']:
            for invalid in ['v1', 'v2', 'all_profiles', 'wrong_model', 'missing_transport']:
                with self.subTest(record=name, invalid=invalid):
                    value, subject = self.record(name)
                    if invalid in ('v1', 'v2'):
                        subject['capabilities'].append('qwen_code_' + invalid)
                    elif invalid == 'all_profiles':
                        subject['capabilities'].extend(['qwen_code_v1', 'qwen_code_v2'])
                    elif invalid == 'wrong_model':
                        subject['model' if 'model' in subject else 'upstream_model'] = 'another-model'
                    else:
                        subject['capabilities'].remove('codex_llama_v1')
                    with self.assertRaises(ContractValidationError):
                        self.validate(value)


if __name__ == '__main__':
    unittest.main()
