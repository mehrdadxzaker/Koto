"""The longer development probe crosses public controls without qualification."""
from copy import deepcopy
import json
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest, coding_input
from hormuz.contracts import validate_contract
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime


class CodingProbeV5WorkflowTests(unittest.TestCase):
    def exercise(self, max_request_bytes, *, allowed):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = fixture.prepare(cloud)
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v2')
            # The complete model-facing request includes the selected guidance.
            # The actual setup-v5 experiment declares 65536; the inherited
            # synthetic fixture's 4096 bytes deliberately tests rejection.
            value['route_admission']['local_routes']['local-code']['max_request_bytes'] = max_request_bytes
            evidence = fixture.evidence(value, request)
            plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 5,
                'campaign_id': 'synthetic-development-probe-v5', 'plan_sha256': evidence['plan_sha256'],
                'case_id': 'synthetic-case', 'task_sha256': 'a' * 64, 'checks_sha256': 'b' * 64,
                'model': 'local-code', 'max_requests': 2, 'max_elapsed_seconds': 180,
                'first_input_sha256': canonical_digest(coding_input(request['input'], schema_version=4)),
                'subject': deepcopy(evidence['plan']['subject'])}
            validate_contract(plan)
            f.path.write_text(json.dumps(value))
            plan_path, path = f.root / 'probe-v5.json', f.root / 'request.json'
            plan_path.write_text(json.dumps(plan))
            path.write_text(json.dumps(request))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            options = ('request-file', str(path), 'bound-conversation')
            self.assertEqual(f.client(*options)['status'], 503)
            armed = json.loads(f.command('qualify', '--plan', str(plan_path)).stdout)
            validate_contract(armed)
            self.assertEqual((armed['schema_version'], armed['automatic_admission_effect']), (2, 'none'))
            self.assertGreater(armed['remaining_ms'], 90000)
            self.assertLessEqual(armed['remaining_ms'], 180000)
            result = f.client(*options, 'qualification-probe', armed['probe_id'])
            self.assertEqual(result['status'], 200 if allowed else 403,
                             {'status': result['status'], 'body': result.get('body')})
            if not allowed:
                self.assertEqual(result['body']['error']['code'], 'hormuz_route_probe_request_mismatch')
            self.assertEqual(f.client(*options)['status'], 503)
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            revoked = json.loads(f.command('qualify', '--revoke').stdout)
            validate_contract(revoked)
            self.assertEqual((revoked['schema_version'], revoked['state'], revoked['remaining_ms']), (2, 'revoked', 0))
            self.assertNotEqual(f.client(*options, 'qualification-probe', armed['probe_id'])['status'], 200)
            if allowed:
                self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'])
            else:
                self.assertFalse((engine / 'inference-count').exists())
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')

    def test_explicit_long_probe_restores_settings_and_never_admits_ordinary_coding(self):
        self.exercise(65536, allowed=True)

    def test_long_probe_still_rejects_a_shaped_request_larger_than_its_byte_limit(self):
        self.exercise(4096, allowed=False)


if __name__ == '__main__':
    unittest.main()
