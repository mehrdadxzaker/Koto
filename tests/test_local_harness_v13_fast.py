"""A separately bound Coder candidate preserves the existing native treatment."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest
from hormuz.codex_llama import CodexLlamaRequest
from hormuz.contracts import ContractValidationError, validate_contract
from tests.test_local_harness_v5_transport_fast import synthetic_requests


CODER = 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M'


class LocalHarnessV13Tests(unittest.TestCase):
    def test_coder_request_preserves_v12_guidance_native_tools_and_compute(self):
        for name, request in synthetic_requests().items():
            with self.subTest(history=name):
                original = deepcopy(request)
                previous = CodexLlamaRequest(request, harness='qwen-code.v12')
                candidate = CodexLlamaRequest(request, harness='qwen-code.v13')
                self.assertEqual(candidate.value, previous.value)
                self.assertEqual(candidate.derived_checks, previous.derived_checks)
                self.assertEqual(request, original)

    def test_setup_probe_and_receipt_bind_every_profile_to_its_original_model(self):
        for filename in ('local-setup-profile-v5.json', 'coding-probe-plan-v4.json',
                         'local-coding-evidence-v4.json'):
            for selected in range(1, 15):
                with self.subTest(record=filename, selected=selected):
                    value = json.loads((Path(__file__).parent / 'fixtures' / filename).read_text())
                    subject = value['plan']['subject'] if 'plan' in value else value.get('subject', value)
                    field = 'model' if 'model' in subject else 'upstream_model'
                    subject['capabilities'].append('qwen_code_v' + str(selected))
                    subject[field] = CODER if selected >= 13 else 'Qwen3-14B-Q4_K_M'

                    def validate(record):
                        if 'plan' in record:
                            record['plan_sha256'] = canonical_digest(record['plan'])
                        validate_contract(record)

                    validate(value)
                    for wrong in ('another-model', 'Qwen3-14B-Q4_K_M' if selected >= 13 else CODER):
                        invalid = deepcopy(value)
                        target = invalid['plan']['subject'] if 'plan' in invalid else invalid.get('subject', invalid)
                        target[field] = wrong
                        with self.assertRaises(ContractValidationError):
                            validate(invalid)
                    for change in ('missing_native', 'qwen_code_v12' if selected >= 13 else 'qwen_code_v13'):
                        invalid = deepcopy(value)
                        target = invalid['plan']['subject'] if 'plan' in invalid else invalid.get('subject', invalid)
                        if change == 'missing_native':
                            target['capabilities'].remove('codex_llama_v1')
                        else:
                            target['capabilities'].append(change)
                        with self.assertRaises(ContractValidationError):
                            validate(invalid)
