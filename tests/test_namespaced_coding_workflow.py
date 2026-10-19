"""Native namespace compatibility at the real local connection/admission seam."""
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


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


class NamespacedCodingWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = lifetime.ConnectedClientLifetimeWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def prepare(self, cloud):
        f = self.fixture
        value, _, engine = f.managed_configuration(cloud)
        executable = engine / 'llama-server'
        executable.write_text(executable.read_text().replace(
            '"name":"fixture_tool","arguments":"{}"',
            '"name":"hormuz_mcp__repair__fixture_tool","arguments":"{}"'))
        archive = Path(value['managed_llama']['runtime_archive'])
        with tarfile.open(archive, 'w:gz') as bundle:
            for path in engine.iterdir():
                bundle.add(path, arcname=path.name)
        value['managed_llama']['runtime_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
        value['model_routes']['local-code']['capabilities'] = [
            'responses', 'text', 'streaming', 'tools', 'codex_http', 'codex_http_0160', 'codex_llama_v1']
        value['route_admission']['local_routes']['local-code']['task_types'] = ['code_change']
        value['upstream_timeout_seconds'] = 6
        value['ai_work'] = {'enabled': True, 'database': str(f.root / 'work.sqlite3'),
                            'tool_capable_aliases': ['local-code']}
        (f.root / 'client-version.txt').write_text('0.160.0')
        request = {'model': 'local-code', 'max_output_tokens': 8, 'reasoning': {'effort': 'none'},
            'input': [{'type': 'message', 'role': 'user', 'content': 'Fix the arithmetic function in this Python code.'}],
            'tools': [{'type': 'namespace', 'name': 'mcp__repair', 'tools': [{
                'type': 'function', 'name': 'fixture_tool', 'parameters': {'type': 'object'}}]}]}
        return value, engine, request

    def install_synthetic_evidence(self, value, request):
        evidence = self.fixture.coding_evidence(value)
        evidence.update(schema_version=3, evidence_id='synthetic-namespaced-local-repair-v3')
        evidence['plan']['subject'].update(client_version='0.160.0',
            request_profile_sha256=request_profile_digest(request, schema_version=3))
        evidence['plan_sha256'] = digest(evidence['plan'])
        value['route_admission']['local_routes']['local-code']['coding_evidence'] = evidence
        self.fixture.path.write_text(json.dumps(value))
        return evidence

    def test_v4_setup_keeps_non_thinking_limits_and_automatic_coding_disabled_without_evidence(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, _ = self.prepare(cloud)
            options = f.local_setup_options(value)
            path = Path(options[1])
            profile = json.loads(path.read_text())
            profile.update(schema_version=4, client_version='0.160.0', coding_evidence=None,
                capabilities=value['model_routes']['local-code']['capabilities'], task_types=['code_change'])
            path.write_text(json.dumps(profile))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('setup', *options)
            configured = json.loads(f.path.read_text())
            self.assertEqual(configured['managed_llama']['schema_version'], 1)
            route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((route['coding_readiness'], route['automatic_task_types']), ('unknown', []))
            self.assertEqual(f.client('code-change')['status'], 503)
            self.assertFalse((engine / 'inference-count').exists())
            origin = urlsplit(f.client('inspect')['base_url'])
            connection = http.client.HTTPConnection(origin.hostname, origin.port, timeout=3)
            try:
                connection.request('GET', origin.path + '/models', headers={
                    'Authorization': 'Bearer ' + f.environment['DESTINATION_WORKFLOW_TOKEN']})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                catalog = json.loads(response.read())['models'][0]
            finally:
                connection.close()
            self.assertFalse(catalog.get('supports_search_tool', False))
            self.assertIsNone(catalog['apply_patch_tool_type'])
            self.assertEqual(catalog['default_reasoning_level'], 'none')
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')
            self.assertEqual(cloud_requests, [])

    def test_synthetic_v3_receipt_binds_raw_namespaces_and_real_tool_continuation(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = self.prepare(cloud)
            self.install_synthetic_evidence(value, request)
            path = f.root / 'request.json'
            path.write_text(json.dumps(request))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((route['coding_readiness'], route['automatic_task_types']),
                             ('qualified', ['code_change']))
            first = f.client('request-file', str(path), 'bound-conversation')
            self.assertEqual(first['status'], 200, first)
            call = first['body']['output'][0]
            self.assertEqual((call['namespace'], call['name']), ('mcp__repair', 'fixture_tool'))
            continuation = deepcopy(request)
            continuation['input'].extend([call, {'type': 'function_call_output', 'call_id': call['call_id'],
                                                'output': 'Synthetic tool check passed'}])
            path.write_text(json.dumps(continuation))
            second = f.client('request-file', str(path), 'bound-conversation')
            self.assertEqual(second['status'], 200, second)
            self.assertIn('MANAGED_LOCAL', json.dumps(second['body']))
            drifted = deepcopy(request)
            drifted['tools'][0]['name'] = 'different_namespace'
            path.write_text(json.dumps(drifted))
            self.assertEqual(f.client('request-file', str(path), 'bound-conversation')['status'], 503)
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1', '1'])
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')

    def test_thinking_runtime_flags_cannot_inherit_non_thinking_coding_evidence(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = self.prepare(cloud)
            value['managed_llama']['schema_version'] = 2
            self.install_synthetic_evidence(value, request)
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((route['coding_readiness'], route['automatic_task_types']), ('subject_mismatch', []))
            self.assertEqual(f.client('code-change')['status'], 503)
            self.assertFalse((engine / 'inference-count').exists())
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')

    def test_v3_probe_permits_only_the_frozen_namespace_without_installing_coding_evidence(self):
        f = self.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = self.prepare(cloud)
            evidence = self.install_synthetic_evidence(value, request)
            del value['route_admission']['local_routes']['local-code']['coding_evidence']
            f.path.write_text(json.dumps(value))
            plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 3,
                    'campaign_id': 'synthetic-namespace-probe-v3', 'plan_sha256': evidence['plan_sha256'],
                    'case_id': 'synthetic-case', 'task_sha256': 'a' * 64, 'checks_sha256': 'b' * 64,
                    'model': 'local-code', 'first_input_sha256': digest(request['input']),
                    'max_requests': 2, 'max_elapsed_seconds': 6, 'subject': evidence['plan']['subject']}
            validate_contract(plan)
            plan_path, request_path = f.root / 'probe.json', f.root / 'request.json'
            plan_path.write_text(json.dumps(plan))
            request_path.write_text(json.dumps(request))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            self.assertEqual(f.client('request-file', str(request_path), 'bound-conversation')['status'], 503)
            armed = json.loads(f.command('qualify', '--plan', str(plan_path)).stdout)
            result = f.client('request-file', str(request_path), 'bound-conversation',
                              'qualification-probe', armed['probe_id'])
            self.assertEqual(result['status'], 200, result)
            self.assertEqual(result['body']['output'][0]['namespace'], 'mcp__repair')
            route = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((route['coding_readiness'], route['automatic_task_types']), ('unknown', []))
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'])
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')


if __name__ == '__main__':
    unittest.main()
