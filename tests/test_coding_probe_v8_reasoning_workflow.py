"""Explicit native probes carry cleartext reasoning without widening admission."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tarfile
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest, coding_input
from hormuz.contracts import validate_contract
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime


class CodingProbeV8ReasoningWorkflowTests(unittest.TestCase):
    def test_same_public_probe_continues_after_reasoning_and_native_tool_result(self):
        for capability, version, seconds, requests in (
                ('qwen_code_v8', 5, 180, 2), ('qwen_code_v11', 4, 90, 3)):
            with self.subTest(capability=capability):
                self.check_public_continuation(capability, version, seconds, requests)

    def check_public_continuation(self, capability, version, seconds, requests):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = fixture.prepare(cloud)
            executable = engine / 'llama-server'
            executable.write_text(executable.read_text().replace(
                'hormuz_mcp__repair__fixture_tool', 'exec_command').replace(
                '"arguments":"{}"', '"arguments":json.dumps({"cmd":"cat solution.py"})'))
            archive = Path(value['managed_llama']['runtime_archive'])
            with tarfile.open(archive, 'w:gz') as bundle:
                for path in engine.iterdir():
                    bundle.add(path, arcname=path.name)
            value['managed_llama']['runtime_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append(capability)
            value['route_admission']['local_routes']['local-code']['max_request_bytes'] = 65536
            native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
            request['tools'] = [native['declarations']['exec_command']]
            request['reasoning'] = {'effort': 'low'}
            evidence = fixture.evidence(value, request)
            plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': version,
                'campaign_id': 'synthetic-v8-reasoning', 'plan_sha256': evidence['plan_sha256'],
                'case_id': 'synthetic-case', 'task_sha256': 'a' * 64, 'checks_sha256': 'b' * 64,
                'model': 'local-code', 'max_requests': requests, 'max_elapsed_seconds': seconds,
                'first_input_sha256': canonical_digest(coding_input(request['input'], schema_version=4)),
                'subject': deepcopy(evidence['plan']['subject'])}
            validate_contract(plan)
            f.path.write_text(json.dumps(value))
            plan_path, request_path = f.root / 'probe-v8.json', f.root / 'request-v8.json'
            plan_path.write_text(json.dumps(plan))
            request_path.write_text(json.dumps(request))
            self.addCleanup(lambda: f.command('disconnect', check=False))
            f.command('connect')
            ordinary = ('request-file', str(request_path), 'bound-conversation')
            self.assertEqual(f.client(*ordinary)['status'], 503)
            armed = json.loads(f.command('qualify', '--plan', str(plan_path)).stdout)
            options = (*ordinary, 'qualification-probe', armed['probe_id'])
            first = f.client(*options)
            self.assertEqual(first['status'], 200, first)
            call = first['body']['output'][0]
            self.assertEqual(call['name'], 'exec_command')
            self.assertEqual(json.loads(call['arguments']), {'cmd': 'cat solution.py'})
            continuation = deepcopy(request)
            continuation['input'] += [
                {'type': 'reasoning', 'id': 'rs-native', 'summary': [],
                 'content': [{'type': 'reasoning_text', 'text': 'Read the current saved function.'}]},
                call, {'type': 'function_call_output', 'call_id': call['call_id'],
                       'output': 'Actual host read succeeded; native process exited with code 0.'}]
            opaque = deepcopy(continuation)
            opaque['input'][1]['encrypted_content'] = 'opaque-not-authorized'
            request_path.write_text(json.dumps(opaque))
            self.assertNotEqual(f.client(*options)['status'], 200)
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'])
            request_path.write_text(json.dumps(continuation))
            second = f.client(*options)
            self.assertEqual(second['status'], 200, second)
            self.assertIn('MANAGED_LOCAL', json.dumps(second['body']))
            self.assertEqual(first['headers']['x-hormuz-work-id'], second['headers']['x-hormuz-work-id'])
            self.assertEqual(second['headers']['x-hormuz-routing-reason'], 'session_affinity')
            self.assertNotEqual(f.client(*options)['status'], 200)
            status = json.loads(f.command('qualify').stdout)
            self.assertEqual((status['submitted_requests'], status['automatic_admission_effect']), (2, 'none'))
            self.assertEqual(f.client(*ordinary)['status'], 503)
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1', '1'])
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')


if __name__ == '__main__':
    unittest.main()
