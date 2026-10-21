"""Script verification retains the existing explicit qualification identity."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.contracts import ContractValidationError, validate_contract


class LocalHarnessV8ContractTests(unittest.TestCase):
    def record(self, filename):
        value = json.loads((Path(__file__).parent / 'fixtures' / filename).read_text())
        subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
        subject['capabilities'].append('qwen_code_v8')
        subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'
        return value, subject

    def validate(self, value):
        if 'plan' in value:
            value['plan_sha256'] = canonical_digest(value['plan'])
        validate_contract(value)

    def test_script_profile_does_not_widen_old_evidence_or_model_transport(self):
        for filename, previous in [('local-setup-profile-v5.json', 4),
                                    ('coding-probe-plan-v4.json', 3),
                                    ('local-coding-evidence-v4.json', 3)]:
            original, subject = self.record(filename)
            self.validate(original)
            for change in ('old_schema', 'wrong_model', 'missing_transport',
                           *('v' + str(i) for i in range(1, 8))):
                with self.subTest(record=filename, change=change):
                    value = deepcopy(original)
                    target = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
                    if change == 'old_schema':
                        value['schema_version'] = previous
                    elif change == 'wrong_model':
                        target['model' if 'model' in target else 'upstream_model'] = 'another-model'
                    elif change == 'missing_transport':
                        target['capabilities'].remove('codex_llama_v1')
                    else:
                        target['capabilities'].append('qwen_code_' + change)
                    with self.assertRaises(ContractValidationError):
                        self.validate(value)

    def test_development_probe_does_not_change_the_normal_coding_budget(self):
        value, _ = self.record('coding-probe-plan-v4.json')
        value.update(schema_version=5, max_elapsed_seconds=180)
        self.validate(value)
        value['schema_version'] = 4
        with self.assertRaises(ContractValidationError):
            self.validate(value)


if __name__ == '__main__':
    unittest.main()
