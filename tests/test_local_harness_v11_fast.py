"""Strict type guidance is an explicit treatment, never task-success evidence."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.codex_llama import CodexLlamaRequest
from hormuz.contracts import ContractValidationError, validate_contract
from tests.test_local_harness_v5_transport_fast import synthetic_requests


class LocalHarnessV11Tests(unittest.TestCase):
    def test_v11_adds_type_checks_without_changing_native_work_or_v8_controls(self):
        for name, request in synthetic_requests().items():
            with self.subTest(history=name):
                original = deepcopy(request)
                v8 = CodexLlamaRequest(request, harness='qwen-code.v8').value
                v11 = CodexLlamaRequest(request, harness='qwen-code.v11').value
                self.assertIn('bool is a subclass of int', v11['instructions'])
                self.assertIn('only when the task requires it', v11['instructions'])
                self.assertIn('every stated type and error constraint', v11['instructions'])
                self.assertIn('Do not weaken', v11['instructions'])
                self.assertTrue(v11['instructions'].startswith(v8['instructions']))
                self.assertEqual({k: v for k, v in v11.items() if k != 'instructions'},
                                 {k: v for k, v in v8.items() if k != 'instructions'})
                self.assertEqual(request, original)
        for profile in (None, *('qwen-code.v' + str(i) for i in range(1, 11))):
            with self.subTest(old_profile=profile):
                value = CodexLlamaRequest({'input': 'Follow the original task.'}, harness=profile).value
                self.assertNotIn('bool is a subclass of int', value.get('instructions', ''))

    def test_setup_probe_and_receipt_require_the_exact_native_model_and_one_profile(self):
        for filename in ('local-setup-profile-v5.json', 'coding-probe-plan-v4.json',
                         'local-coding-evidence-v4.json'):
            value = json.loads((Path(__file__).parent / 'fixtures' / filename).read_text())
            subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
            subject['capabilities'].append('qwen_code_v11')
            subject['model' if 'model' in subject else 'upstream_model'] = 'Qwen3-14B-Q4_K_M'

            def validate(record):
                if 'plan' in record:
                    record['plan_sha256'] = canonical_digest(record['plan'])
                validate_contract(record)

            validate(value)
            for change in ('wrong_model', 'missing_native', *range(1, 11)):
                with self.subTest(record=filename, invalid=change):
                    invalid = deepcopy(value)
                    target = invalid['plan']['subject'] if 'plan' in invalid else invalid.get('subject', invalid)
                    if change == 'wrong_model':
                        target['model' if 'model' in target else 'upstream_model'] = 'another-model'
                    elif change == 'missing_native':
                        target['capabilities'].remove('codex_llama_v1')
                    else:
                        target['capabilities'].append('qwen_code_v' + str(change))
                    with self.assertRaises(ContractValidationError):
                        validate(invalid)
