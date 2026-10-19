"""Versioned namespace compatibility preserves the coding acceptance bounds."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from hormuz.contracts import ContractValidationError, contract_manifest, validate_contract
from hormuz.coding_qualification import request_profile_digest


class NamespacedCodingFastTests(unittest.TestCase):
    def fixture(self, name):
        return json.loads((Path(__file__).parent / 'fixtures' / name).read_text())

    def test_versioned_namespace_records_are_public_contracts(self):
        for name in ['local-coding-evidence-v3.json', 'coding-probe-plan-v3.json', 'local-setup-profile-v4.json']:
            with self.subTest(fixture=name):
                validate_contract(self.fixture(name))
        identities = {(row['schema_id'], row['schema_version']) for row in contract_manifest()['schemas']}
        for identity in [('hormuz.local-coding-evidence', 3), ('hormuz.coding-probe-plan', 3),
                         ('hormuz.local-setup-profile', 4)]:
            self.assertIn(identity, identities)

    def test_older_record_versions_do_not_inherit_adapter_compatibility(self):
        for filename, version in [('local-coding-evidence-v3.json', 2), ('coding-probe-plan-v3.json', 2),
                                  ('local-setup-profile-v4.json', 2)]:
            with self.subTest(fixture=filename):
                record = self.fixture(filename)
                record['schema_version'] = version
                with self.assertRaises(ContractValidationError):
                    validate_contract(record)

    def test_namespaces_do_not_increase_any_coding_budget(self):
        for filename in ['local-coding-evidence-v3.json', 'coding-probe-plan-v3.json', 'local-setup-profile-v4.json']:
            for field, value in [('max_request_bytes', 65537), ('max_output_tokens', 513),
                                 ('upstream_timeout_seconds', 91)]:
                with self.subTest(fixture=filename, field=field):
                    record = self.fixture(filename)
                    subject = record['plan']['subject'] if 'plan' in record else record.get('subject', record)
                    subject[field] = value
                    if 'plan' in record:
                        record['plan_sha256'] = hashlib.sha256(json.dumps(record['plan'], sort_keys=True,
                            separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
                    with self.assertRaises(ContractValidationError):
                        validate_contract(record)

    def test_raw_namespace_identity_and_child_schema_remain_bound(self):
        request = {'instructions': 'Repair the selected project.', 'reasoning': {'effort': 'none'},
                   'tools': [{'type': 'namespace', 'name': 'mcp__repair', 'tools': [{
                       'type': 'function', 'name': 'save', 'parameters': {'type': 'object',
                           'properties': {'content': {'type': 'string'}}, 'required': ['content']}}]}]}
        expected = request_profile_digest(request, schema_version=3)
        changed = deepcopy(request)
        changed['tools'][0]['name'] = 'another_server'
        self.assertNotEqual(expected, request_profile_digest(changed, schema_version=3))
        changed = deepcopy(request)
        changed['tools'][0]['tools'][0]['parameters']['properties']['content']['type'] = 'array'
        self.assertNotEqual(expected, request_profile_digest(changed, schema_version=3))
        changed = deepcopy(request)
        changed['reasoning']['effort'] = 'low'
        self.assertNotEqual(expected, request_profile_digest(changed, schema_version=3))


if __name__ == '__main__':
    unittest.main()
