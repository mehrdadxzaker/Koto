"""The semantic-check profile has explicit, exclusive qualification identity."""
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.contracts import ContractValidationError, validate_contract


class LocalHarnessV6ContractTests(unittest.TestCase):
    def record(self, name):
        value = json.loads((Path(__file__).parent / 'fixtures' / name).read_text())
        subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
        subject['capabilities'].append('qwen_code_v6')
        subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'
        return value, subject

    def validate(self, value):
        if 'plan' in value:
            value['plan_sha256'] = canonical_digest(value['plan'])
        validate_contract(value)

    def test_current_envelopes_admit_v6_but_old_envelopes_do_not(self):
        for name, older in [('local-setup-profile-v5.json', 4),
                            ('coding-probe-plan-v4.json', 3),
                            ('local-coding-evidence-v4.json', 3)]:
            with self.subTest(record=name):
                value, _ = self.record(name)
                self.validate(value)
                value['schema_version'] = older
                with self.assertRaises(ContractValidationError):
                    self.validate(value)

    def test_explicit_development_probe_stays_distinct_from_old_budget(self):
        value, _ = self.record('coding-probe-plan-v4.json')
        value.update(schema_version=5, max_elapsed_seconds=180)
        self.validate(value)
        value['schema_version'] = 4
        with self.assertRaises(ContractValidationError):
            self.validate(value)

    def test_v6_rejects_every_previous_profile_and_ineligible_model_or_transport(self):
        previous = ['v1', 'v2', 'v3', 'v4', 'v5']
        for name in ['local-setup-profile-v5.json', 'coding-probe-plan-v4.json',
                     'local-coding-evidence-v4.json']:
            for invalid in previous + ['all_profiles', 'wrong_model', 'missing_transport']:
                with self.subTest(record=name, invalid=invalid):
                    value, subject = self.record(name)
                    if invalid in previous:
                        subject['capabilities'].append('qwen_code_' + invalid)
                    elif invalid == 'all_profiles':
                        subject['capabilities'].extend('qwen_code_' + profile for profile in previous)
                    elif invalid == 'wrong_model':
                        subject['model' if 'model' in subject else 'upstream_model'] = 'another-model'
                    else:
                        subject['capabilities'].remove('codex_llama_v1')
                    with self.assertRaises(ContractValidationError):
                        self.validate(value)


if __name__ == '__main__':
    unittest.main()
