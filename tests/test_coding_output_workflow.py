"""The opt-in output profile crosses the real owner, runtime and admission seams."""
from copy import deepcopy
import hashlib
import http.client
import json
from pathlib import Path
import tarfile
import unittest
from urllib.parse import urlsplit

from hormuz.coding_qualification import request_profile_digest
from hormuz.contracts import validate_contract
from tests import test_connected_client_lifetime_workflow as lifetime
from tests import test_namespaced_coding_workflow as namespaces

digest = namespaces.digest


class CodingOutputWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.namespace_fixture = namespaces.NamespacedCodingWorkflowTests()
        self.namespace_fixture.setUp()
        self.addCleanup(self.namespace_fixture.doCleanups)
        self.fixture = self.namespace_fixture.fixture

    def prepare(self, cloud):
        value, engine, request = self.namespace_fixture.prepare(cloud)
        executable = engine/'llama-server'
        executable.write_text(executable.read_text().replace('args=sys.argv[1:]',
            'args=sys.argv[1:]\npathlib.Path(__file__).with_name("launch-arguments.json").write_text(json.dumps(args))'))
        archive = Path(value['managed_llama']['runtime_archive'])
        with tarfile.open(archive, 'w:gz') as bundle:
            for path in engine.iterdir():
                bundle.add(path, arcname=path.name)
        value['managed_llama'].update(schema_version=3,
            runtime_sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
        value['route_admission']['local_routes']['local-code']['max_output_tokens'] = 2048
        value['policies']['organization']['max_output_tokens'] = 2048
        request['max_output_tokens'] = 2048
        return value, engine, request

    def evidence(self, value, request):
        evidence = self.fixture.coding_evidence(value)
        evidence.update(schema_version=4, evidence_id='synthetic-output-2048-local-repair-v2')
        evidence['plan']['criteria_version'] = 'local-repair.v2'
        evidence['plan']['subject'].update(client_version='0.160.0', runtime_profile='managed-llama.v2',
            request_profile_sha256=request_profile_digest(request, schema_version=4))
        evidence['plan_sha256'] = digest(evidence['plan'])
        return evidence

    def test_v5_setup_uses_bounded_non_thinking_flags_and_stays_unqualified(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, _ = self.prepare(cloud)
            options = f.local_setup_options(value)
            path = Path(options[1])
            profile = json.loads(path.read_text())
            profile.update(schema_version=5, client_version='0.160.0', coding_evidence=None,
                capabilities=value['model_routes']['local-code']['capabilities'], task_types=['code_change'],
                max_output_tokens=2048)
            path.write_text(json.dumps(profile))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('setup', *options)
            configured = json.loads(f.path.read_text())
            self.assertEqual(configured['managed_llama']['schema_version'], 3)
            route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((route['coding_readiness'], route['automatic_task_types']), ('unknown', []))
            self.assertEqual(route['max_output_tokens'], 2048)
            self.assertEqual(f.client('code-change')['status'], 503)
            self.assertFalse((engine/'inference-count').exists())
            args = json.loads((engine/'launch-arguments.json').read_text())
            for flag, expected in [('--n-predict', '2048'), ('--parallel', '1'), ('--ctx-size', '32768')]:
                self.assertEqual(args[args.index(flag)+1], expected)
            self.assertEqual(json.loads(args[args.index('--chat-template-kwargs')+1]), {'enable_thinking':False})
            self.assertNotIn('--reasoning-budget', args)
            origin = urlsplit(f.client('inspect')['base_url'])
            connection = http.client.HTTPConnection(origin.hostname, origin.port, timeout=3)
            try:
                connection.request('GET', origin.path+'/models', headers={
                    'Authorization':'Bearer '+f.environment['DESTINATION_WORKFLOW_TOKEN']})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                catalog = json.loads(response.read())['models'][0]
            finally:
                connection.close()
            self.assertFalse(catalog.get('supports_search_tool', False))
            self.assertEqual(catalog['default_reasoning_level'], 'none')
            self.assertIsNone(catalog['apply_patch_tool_type'])
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')
            self.assertEqual(cloud_requests, [])

    def test_v4_synthetic_evidence_admits_only_its_exact_profile_and_keeps_continuation(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = self.prepare(cloud)
            evidence = self.evidence(value, request)
            value['route_admission']['local_routes']['local-code']['coding_evidence'] = evidence
            f.path.write_text(json.dumps(value))
            path = f.root/'request.json'
            path.write_text(json.dumps(request))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            state = json.loads(f.command('status', '--routing').stdout)
            validate_contract(state)
            self.assertEqual(state['schema_version'], 4)
            route = state['routes'][0]
            self.assertEqual((route['coding_readiness'], route['automatic_task_types']), ('qualified', ['code_change']))
            self.assertEqual(route['coding_evidence']['criteria_version'], 'local-repair.v2')
            origin = urlsplit(f.client('inspect')['base_url'])
            connection = http.client.HTTPConnection(origin.hostname, origin.port, timeout=3)
            try:
                connection.request('GET', origin.path+'/router/state', headers={
                    'Authorization':'Bearer '+f.environment['DESTINATION_WORKFLOW_TOKEN']})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader('X-Hormuz-Contract'), 'hormuz.route-admission;v=4')
                validate_contract(json.loads(response.read()))
            finally:
                connection.close()
            first = f.client('request-file', str(path), 'bound-conversation')
            self.assertEqual(first['status'], 200, first)
            call = first['body']['output'][0]
            continuation = deepcopy(request)
            continuation['input'].extend([call, {'type':'function_call_output', 'call_id':call['call_id'], 'output':'Synthetic check passed'}])
            path.write_text(json.dumps(continuation))
            self.assertEqual(f.client('request-file', str(path), 'bound-conversation')['status'], 200)
            drift = deepcopy(request)
            drift['instructions'] = 'Changed instructions'
            path.write_text(json.dumps(drift))
            self.assertEqual(f.client('request-file', str(path), 'bound-conversation')['status'], 503)
            self.assertEqual((engine/'inference-count').read_text().splitlines(), ['1','1'])
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')

    def test_v4_probe_remains_temporary_and_does_not_admit_unmarked_coding(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = self.prepare(cloud)
            evidence = self.evidence(value, request)
            f.path.write_text(json.dumps(value))
            plan = {'schema_id':'hormuz.coding-probe-plan', 'schema_version':4,
                'campaign_id':'synthetic-output-probe-v4', 'plan_sha256':evidence['plan_sha256'],
                'case_id':'synthetic-case', 'task_sha256':'a'*64, 'checks_sha256':'b'*64,
                'model':'local-code', 'first_input_sha256':digest(request['input']),
                'max_requests':2, 'max_elapsed_seconds':6, 'subject':evidence['plan']['subject']}
            validate_contract(plan)
            plan_path, path = f.root/'probe.json', f.root/'request.json'
            plan_path.write_text(json.dumps(plan))
            path.write_text(json.dumps(request))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            self.assertEqual(f.client('request-file', str(path), 'bound-conversation')['status'], 503)
            armed = json.loads(f.command('qualify', '--plan', str(plan_path)).stdout)
            result = f.client('request-file', str(path), 'bound-conversation', 'qualification-probe', armed['probe_id'])
            self.assertEqual(result['status'], 200, result)
            self.assertEqual(f.client('request-file', str(path), 'bound-conversation')['status'], 503)
            route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((route['coding_readiness'], route['automatic_task_types']), ('unknown', []))
            self.assertEqual(json.loads(f.command('qualify', '--revoke').stdout)['state'], 'revoked')
            self.assertEqual((engine/'inference-count').read_text().splitlines(), ['1'])
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')

    def test_runtime_profile_changes_cannot_inherit_receipts(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = self.prepare(cloud)
            value['route_admission']['local_routes']['local-code']['max_output_tokens'] = 8
            value['policies']['organization']['max_output_tokens'] = 8
            request['max_output_tokens'] = 8
            original = self.evidence(value, request)
            for runtime_version, evidence_version in [(1,4), (2,4), (3,3)]:
                with self.subTest(runtime=runtime_version, evidence=evidence_version):
                    evidence = deepcopy(original)
                    if evidence_version == 3:
                        evidence.update(schema_version=3)
                        evidence['plan']['criteria_version'] = 'local-repair.v1'
                        evidence['plan']['subject']['runtime_profile'] = 'managed-llama.v1'
                        evidence['plan_sha256'] = digest(evidence['plan'])
                    value['managed_llama']['schema_version'] = runtime_version
                    value['route_admission']['local_routes']['local-code']['coding_evidence'] = evidence
                    f.path.write_text(json.dumps(value))
                    try:
                        f.command('connect')
                        route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
                        self.assertEqual((route['coding_readiness'], route['automatic_task_types']), ('subject_mismatch', []))
                        path = f.root/'request.json'
                        path.write_text(json.dumps(request))
                        self.assertEqual(f.client('request-file', str(path), 'bound-conversation')['status'], 503)
                    finally:
                        f.command('disconnect', check=False)
            self.assertFalse((engine/'inference-count').exists())
            self.assertEqual(cloud_requests, [])

    def test_new_criteria_preserve_all_cases_and_family_coverage_requirements(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = self.prepare(cloud)
            complete = self.evidence(value, request)
            for scenario, expected in [('missing_outcome','incomplete'), ('failed_check','failed'),
                                       ('missing_held_out_case','incomplete')]:
                with self.subTest(scenario=scenario):
                    evidence = deepcopy(complete)
                    if scenario == 'missing_outcome':
                        evidence['outcomes'].pop()
                    elif scenario == 'failed_check':
                        evidence['outcomes'][0]['check_exit_code'] = 1
                    else:
                        missing = evidence['plan']['cases'].pop()
                        evidence['outcomes'] = [row for row in evidence['outcomes']
                            if row['case_id'] != missing['case_id']]
                        evidence['plan_sha256'] = digest(evidence['plan'])
                    value['route_admission']['local_routes']['local-code']['coding_evidence'] = evidence
                    f.path.write_text(json.dumps(value))
                    try:
                        f.command('connect')
                        route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
                        self.assertEqual((route['coding_readiness'], route['automatic_task_types']), (expected, []))
                        path = f.root/'request.json'
                        path.write_text(json.dumps(request))
                        self.assertEqual(f.client('request-file', str(path), 'bound-conversation')['status'], 503)
                    finally:
                        f.command('disconnect', check=False)
            self.assertFalse((engine/'inference-count').exists())
            self.assertEqual(cloud_requests, [])


if __name__ == '__main__':
    unittest.main()
