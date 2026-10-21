"""The v9 experiment needs fresh evidence without widening older contracts."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.contracts import ContractValidationError, validate_contract
from hormuz.local_harness import profile_for_capabilities


class LocalHarnessV9ContractTests(unittest.TestCase):
    def record(self, filename):
        value = json.loads((Path(__file__).parent / 'fixtures' / filename).read_text())
        subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
        subject['capabilities'].append('qwen_code_v9')
        subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'
        return value

    def validate(self, value):
        if 'plan' in value:
            value['plan_sha256'] = canonical_digest(value['plan'])
        validate_contract(value)

    def test_fresh_setup_probe_and_evidence_bind_the_explicit_v9_profile(self):
        for filename in ('local-setup-profile-v5.json', 'coding-probe-plan-v4.json',
                         'local-coding-evidence-v4.json'):
            with self.subTest(record=filename):
                self.validate(self.record(filename))
        self.assertEqual(profile_for_capabilities(['responses', 'codex_llama_v1', 'qwen_code_v9']),
                         'qwen-code.v9')
        self.assertIsNone(profile_for_capabilities(['responses', 'codex_llama_v1']))

    def test_old_schemas_wrong_model_missing_native_and_ambiguous_profiles_fail_closed(self):
        for filename, previous in (('local-setup-profile-v5.json', 4),
                                   ('coding-probe-plan-v4.json', 3),
                                   ('local-coding-evidence-v4.json', 3)):
            original = self.record(filename)
            for change in ('old_schema', 'wrong_model', 'missing_native',
                           *('v' + str(i) for i in range(1, 9))):
                with self.subTest(record=filename, change=change):
                    value = deepcopy(original)
                    subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
                    if change == 'old_schema':
                        value['schema_version'] = previous
                    elif change == 'wrong_model':
                        subject['model' if 'model' in subject else 'upstream_model'] = 'another-model'
                    elif change == 'missing_native':
                        subject['capabilities'].remove('codex_llama_v1')
                    else:
                        subject['capabilities'].append('qwen_code_' + change)
                    with self.assertRaises(ContractValidationError):
                        self.validate(value)
        with self.assertRaisesRegex(ValueError, 'ambiguous_local_harness'):
            profile_for_capabilities(['qwen_code_v8', 'qwen_code_v9'])

    def test_v9_does_not_change_the_normal_probe_or_development_limits(self):
        normal = self.record('coding-probe-plan-v4.json')
        self.validate(normal)
        development = deepcopy(normal)
        development.update(schema_version=5, max_elapsed_seconds=180)
        self.validate(development)
        for field, invalid in (('max_elapsed_seconds', 181), ('max_requests', 33)):
            with self.subTest(field=field):
                changed = deepcopy(development)
                changed[field] = invalid
                with self.assertRaises(ContractValidationError):
                    self.validate(changed)
        normal['max_elapsed_seconds'] = 180
        with self.assertRaises(ContractValidationError):
            self.validate(normal)


if __name__ == '__main__':
    unittest.main()
