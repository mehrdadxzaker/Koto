"""An explicit development probe gets more time without changing qualification."""
from copy import deepcopy
from email.message import Message
import json
from pathlib import Path
import platform
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from hormuz._contract_schemas.local_coding import canonical_digest, coding_input
from hormuz.coding_probe import CodingProbe, HEADER, ProbeError
from hormuz.coding_qualification import request_profile_digest
from hormuz.contracts import ContractValidationError, contract_manifest, validate_contract


MODEL = 'Qwen3-14B-Q4_K_M'


class CodingProbeV5Tests(unittest.TestCase):
    def fixture(self, name):
        return json.loads((Path(__file__).parent / 'fixtures' / name).read_text())

    def prepare(self, *, version=5, capability='qwen_code_v2', seconds=180):
        request = {'model': MODEL, 'input': [
            {'type': 'message', 'id': 'msg_12345678-1234-1234-1234-123456789abc',
             'role': 'user', 'content': 'Fix the Python function.'}],
            'tools': [{'type': 'custom', 'name': 'apply_patch', 'format': {
                'type': 'grammar', 'syntax': 'lark', 'definition': 'start: "PATCH_OK"'}}]}
        plan = self.fixture('coding-probe-plan-v4.json')
        plan.update(schema_version=version, model=MODEL, max_elapsed_seconds=seconds,
                    first_input_sha256=canonical_digest(coding_input(request['input'], schema_version=4)))
        subject = plan['subject']
        subject.update(system=platform.system(), machine=platform.machine(), upstream_model=MODEL,
            capabilities=['responses', 'text', 'codex_llama_v1', capability],
            request_profile_sha256=request_profile_digest(request, schema_version=4))
        route = NS(alias=MODEL, model_revision=subject['model_revision'], upstream_model=MODEL,
                   protocol='openai', capabilities=tuple(subject['capabilities']))
        qualification = NS(max_request_bytes=subject['max_request_bytes'],
                           max_output_tokens=subject['max_output_tokens'], task_types=('code_change',))
        config = NS(route_admission=NS(mode='local_only'), ai_work=NS(enabled=True, cache_enabled=False),
            model_routes={MODEL: route}, upstream_timeout_seconds=subject['upstream_timeout_seconds'],
            managed_llama=NS(schema_version=3, route=MODEL, runtime_sha256=subject['runtime_sha256']))
        target = NS(generation='destination-generation', locality='local')
        probe = CodingProbe(NS(config=config, qualifications={MODEL: qualification},
                               destinations=NS(resolve=lambda _: target)))
        return probe, plan, request, target

    def arm(self, probe, plan, now=100):
        with patch('hormuz.coding_probe.time.monotonic', return_value=now):
            return probe.control(NS(actor_id='actor'), plan=plan)

    def submit(self, probe, request, *, now=101, work_id='work'):
        headers = Message()
        headers[HEADER], headers['User-Agent'] = probe.probe_id, 'codex_exec/0.160.0'
        handler = NS(headers=headers, path='/v1/responses', _work_id=work_id, _work_conversation='conversation')
        decision = NS(requested_model=MODEL, resolved_alias=MODEL, route=object())
        with patch('hormuz.coding_probe.time.monotonic', return_value=now):
            probe.check(handler, NS(actor_id='actor'), decision, request, client='codex', claim=True)
        return handler

    def test_public_plan5_and_status2_are_registered_without_new_coding_evidence(self):
        probe, plan, _, _ = self.prepare()
        validate_contract(plan)
        status = self.arm(probe, plan)
        validate_contract(status)
        identities = {(row['schema_id'], row['schema_version']) for row in contract_manifest()['schemas']}
        self.assertIn(('hormuz.coding-probe-plan', 5), identities)
        self.assertIn(('hormuz.coding-probe-status', 2), identities)
        self.assertNotIn(('hormuz.local-coding-evidence', 5), identities)
        self.assertEqual((status['schema_version'], status['remaining_ms'], status['automatic_admission_effect']),
                         (2, 180000, 'none'))

    def test_older_plan_and_status_budgets_remain_exactly_ninety_seconds(self):
        for version in (1, 2, 3, 4):
            with self.subTest(version=version):
                plan = self.fixture('coding-probe-plan-v%d.json' % version)
                plan['max_elapsed_seconds'] = 90
                validate_contract(plan)
                plan['max_elapsed_seconds'] = 91
                with self.assertRaises(ContractValidationError):
                    validate_contract(plan)
        probe, plan, _, _ = self.prepare(version=4, seconds=90)
        status = self.arm(probe, plan)
        self.assertEqual((status['schema_version'], status['remaining_ms']), (1, 90000))
        validate_contract(status)
        status['remaining_ms'] = 90001
        with self.assertRaises(ContractValidationError):
            validate_contract(status)

    def test_plan5_time_requests_and_existing_subject_limits_are_bounded(self):
        for field, invalid in [('max_elapsed_seconds', 181), ('max_elapsed_seconds', 0),
                               ('max_elapsed_seconds', True), ('max_requests', 33)]:
            with self.subTest(field=field, invalid=invalid):
                _, plan, _, _ = self.prepare()
                plan[field] = invalid
                with self.assertRaises(ContractValidationError):
                    validate_contract(plan)
        for field, invalid in [('max_output_tokens', 2049), ('max_request_bytes', 65537),
                               ('upstream_timeout_seconds', 91)]:
            with self.subTest(field=field):
                _, plan, _, _ = self.prepare()
                plan['subject'][field] = invalid
                with self.assertRaises(ContractValidationError):
                    validate_contract(plan)

    def test_plan5_requires_one_declared_qwen_harness_and_the_existing_native_runtime(self):
        for capability in ('qwen_code_v1', 'qwen_code_v2'):
            _, plan, _, _ = self.prepare(capability=capability)
            validate_contract(plan)
        for invalid in ('no_harness', 'both_harnesses', 'missing_transport', 'wrong_model', 'wrong_runtime', 'cloud'):
            with self.subTest(invalid=invalid):
                _, plan, _, _ = self.prepare()
                subject = plan['subject']
                if invalid == 'no_harness':
                    subject['capabilities'].remove('qwen_code_v2')
                elif invalid == 'both_harnesses':
                    subject['capabilities'].append('qwen_code_v1')
                elif invalid == 'missing_transport':
                    subject['capabilities'].remove('codex_llama_v1')
                elif invalid == 'wrong_model':
                    subject['upstream_model'] = 'another-model'
                elif invalid == 'wrong_runtime':
                    subject['runtime_profile'] = 'managed-llama.v1'
                else:
                    subject['protocol'] = 'anthropic'
                with self.assertRaises(ContractValidationError):
                    validate_contract(plan)

    def test_new_status_has_only_the_declared_larger_budget(self):
        probe, plan, _, _ = self.prepare()
        status = self.arm(probe, plan)
        for field, invalid in [('remaining_ms', 180001), ('remaining_ms', True),
                               ('max_requests', 33), ('automatic_admission_effect', 'qualified')]:
            with self.subTest(field=field):
                changed = {**status, field: invalid}
                with self.assertRaises(ContractValidationError):
                    validate_contract(changed)

    def test_actual_deadline_revocation_exhaustion_and_statuses_stay_bounded(self):
        probe, plan, request, _ = self.prepare()
        self.arm(probe, plan)
        self.submit(probe, request, now=279)
        with patch('hormuz.coding_probe.time.monotonic', return_value=279):
            self.assertEqual(probe.remaining(), 1)
            status = probe.status()
            self.assertEqual((status['state'], status['remaining_ms']), ('running', 1000))
            validate_contract(status)
        with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
            self.submit(probe, request, now=280)
        with patch('hormuz.coding_probe.time.monotonic', return_value=280):
            status = probe.status()
            self.assertEqual((status['state'], status['remaining_ms']), ('expired', 0))
            validate_contract(status)
        revoked = probe.control(NS(actor_id='actor'), revoke=True)
        self.assertEqual((revoked['schema_version'], revoked['remaining_ms']), (2, 0))
        validate_contract(revoked)
        probe, plan, request, _ = self.prepare()
        plan['max_requests'] = 1
        self.arm(probe, plan)
        self.submit(probe, request)
        with patch('hormuz.coding_probe.time.monotonic', return_value=101):
            exhausted = probe.status()
            self.assertEqual(exhausted['state'], 'exhausted')
            validate_contract(exhausted)
        with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
            self.submit(probe, request)

    def test_native_profile_maps5_to4_and_raw_prefix_replay_and_generation_gates_remain(self):
        probe, plan, request, target = self.prepare()
        self.arm(probe, plan)
        with patch('hormuz.coding_probe.request_profile_digest', wraps=request_profile_digest) as profile, \
             patch('hormuz.coding_probe.coding_input', wraps=coding_input) as inputs:
            self.submit(probe, request)
            self.assertEqual(profile.call_args.kwargs, {'schema_version': 4})
            self.assertEqual(inputs.call_args.kwargs, {'schema_version': 4})
        continuation = deepcopy(request)
        continuation['input'] += [
            {'type': 'custom_tool_call', 'call_id': 'patch-call', 'name': 'apply_patch', 'input': 'PATCH_OK'},
            {'type': 'custom_tool_call_output', 'call_id': 'patch-call', 'output': 'Success'}]
        self.submit(probe, continuation)
        self.assertEqual(probe.count, 2)
        altered = deepcopy(continuation)
        altered['input'][1]['input'] = 'CHANGED_PATCH'
        altered['input'].append({'role': 'assistant', 'content': 'Continue'})
        for invalid in (continuation, altered,
                {**continuation, 'input': continuation['input'] + [{'role': 'user', 'content': 'New task'}]}):
            with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
                self.submit(probe, invalid)
        extended = {**continuation, 'input': continuation['input'] + [{'role': 'assistant', 'content': 'Continue'}]}
        with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
            self.submit(probe, extended, work_id='other-work')
        target.generation = 'other-generation'
        with self.assertRaisesRegex(ProbeError, 'probe_request_mismatch'):
            self.submit(probe, extended)
        self.assertEqual(probe.count, 2)


if __name__ == '__main__':
    unittest.main()
