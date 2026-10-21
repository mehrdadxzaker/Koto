"""The larger coding envelope is explicit; legacy bounds remain unchanged."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from hormuz.contracts import ContractValidationError, contract_manifest, validate_contract


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
        ensure_ascii=False).encode()).hexdigest()


class CodingOutputFastTests(unittest.TestCase):
    def fixture(self, name):
        return json.loads((Path(__file__).parent/'fixtures'/name).read_text())

    def test_larger_output_versions_are_explicit_public_contracts(self):
        for name in ['local-coding-evidence-v4.json', 'coding-probe-plan-v4.json',
                     'local-setup-profile-v5.json', 'route-admission-v4.json']:
            with self.subTest(fixture=name):
                validate_contract(self.fixture(name))
        identities = {(r['schema_id'], r['schema_version']) for r in contract_manifest()['schemas']}
        for identity in [('hormuz.local-coding-evidence', 4), ('hormuz.coding-probe-plan', 4),
                         ('hormuz.local-setup-profile', 5), ('hormuz.route-admission', 4)]:
            self.assertIn(identity, identities)

    def test_legacy_versions_cannot_inherit_the_larger_output_envelope(self):
        for name, version in [('local-coding-evidence-v4.json', 3),
                              ('coding-probe-plan-v4.json', 3), ('local-setup-profile-v5.json', 4)]:
            with self.subTest(fixture=name):
                record = self.fixture(name)
                record['schema_version'] = version
                with self.assertRaises(ContractValidationError):
                    validate_contract(record)

    def test_new_envelope_retains_byte_and_deadline_limits(self):
        for name in ['local-coding-evidence-v4.json', 'coding-probe-plan-v4.json',
                     'local-setup-profile-v5.json']:
            for field, invalid in [('max_output_tokens', 2049), ('max_request_bytes', 65537),
                                   ('upstream_timeout_seconds', 91)]:
                with self.subTest(fixture=name, field=field):
                    record = self.fixture(name)
                    subject = record['plan']['subject'] if 'plan' in record else record.get('subject', record)
                    subject[field] = invalid
                    if 'plan' in record:
                        record['plan_sha256'] = digest(record['plan'])
                    with self.assertRaises(ContractValidationError):
                        validate_contract(record)

    def test_new_receipts_cannot_relabel_an_older_execution_profile(self):
        original = self.fixture('local-coding-evidence-v4.json')
        for changed in ['criteria', 'runtime']:
            with self.subTest(changed=changed):
                record = deepcopy(original)
                if changed == 'criteria':
                    record['plan']['criteria_version'] = 'local-repair.v1'
                else:
                    record['plan']['subject']['runtime_profile'] = 'managed-llama.v1'
                record['plan_sha256'] = digest(record['plan'])
                with self.assertRaises(ContractValidationError):
                    validate_contract(record)

    def test_legacy_summary_versions_cannot_report_new_criteria(self):
        record = self.fixture('route-admission-v4.json')
        record['schema_version'] = 2
        with self.assertRaises(ContractValidationError):
            validate_contract(record)

    def test_new_summary_criteria_require_a_supported_string(self):
        for criteria in [[], {}, None, 42, True, 'local-repair.v3']:
            with self.subTest(criteria=criteria):
                record = self.fixture('route-admission-v4.json')
                record['routes'][0]['coding_evidence']['criteria_version'] = criteria
                with self.assertRaises(ContractValidationError):
                    validate_contract(record)

    def test_v4_summary_can_preserve_separate_personal_selection_metadata(self):
        record = self.fixture('route-admission-v4.json')
        record['personal_selection'] = {'schema_id':'koto.personal-selection-status', 'schema_version':1,
            'enabled':True, 'mode':'observe', 'examples':0, 'validation':None,
            'validation_status':'not_validated', 'classifier':'nearest-neighbor.v1', 'last_selection':None}
        validate_contract(record)
        record['personal_selection']['schema_id'] = 'unexpected-status'
        with self.assertRaises(ContractValidationError):
            validate_contract(record)


if __name__ == '__main__':
    unittest.main()
