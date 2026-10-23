"""The Router returns native checks; an external host executes their type probes."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest, coding_input
from hormuz.contracts import validate_contract
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime


class IntegerChecksWorkflowTests(unittest.TestCase):
    def test_integer_subclass_policy_reports_actual_host_failure_then_success(self):
        exact = 'def transform(value):\n    if type(value) is not int: raise TypeError()\n    return value + 1\n'
        family = 'def transform(value):\n    if not isinstance(value,int) or isinstance(value,bool): raise TypeError()\n    return value + 1\n'
        for policy, before, after in [('reject', family, exact), ('allow', exact, family)]:
            with self.subTest(subclasses=policy):
                fixture = coding.CodingOutputWorkflowTests()
                fixture.setUp()
                self.addCleanup(fixture.doCleanups)
                f = fixture.fixture
                with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
                    value, engine, request = fixture.prepare(cloud)
                    project = f.root / 'native-project'; project.mkdir()
                    (project / 'solution.py').write_text(before)
                    spec = {'module_path': 'solution.py', 'function': 'transform', 'arguments': {'value': 3},
                            'policies': [{'argument': 'value', 'subclasses': policy, 'booleans': 'reject'}]}
                    scripted = f'        spec={spec!r}\n' + '''        capture=pathlib.Path(__file__).with_name('type-requests.jsonl')
        with capture.open('a') as observed: observed.write(json.dumps(body)+'\\n')
        step=len(capture.read_text().splitlines())
        if step <= 2:
            result['output']=[{'type':'function_call','id':'type-item-'+str(step),'call_id':'type-call-'+str(step),
                'name':'koto_integer_checks','arguments':json.dumps({'checks':spec})}]
'''
                    executable = engine / 'llama-server'; program = executable.read_text()
                    start = program.index('        items=body.get("input", [])')
                    end = program.index('        data=json.dumps(result).encode()', start)
                    executable.write_text(program[:start] + scripted + program[end:])
                    archive = Path(value['managed_llama']['runtime_archive'])
                    with tarfile.open(archive, 'w:gz') as bundle:
                        for path in engine.iterdir(): bundle.add(path, arcname=path.name)
                    value['managed_llama']['runtime_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
                    route = value['model_routes']['local-code']
                    route['upstream_model'] = 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M'
                    route['capabilities'].append('qwen_code_v15')
                    value['route_admission']['local_routes']['local-code']['max_request_bytes'] = 65536
                    native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
                    request['tools'] = [native['declarations']['exec_command'], native['declarations']['apply_patch']]
                    request.update(reasoning={'effort': 'none'}, tool_choice='auto')
                    evidence = fixture.evidence(value, request)
                    plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 5,
                        'campaign_id': 'synthetic-integer-' + policy, 'plan_sha256': evidence['plan_sha256'],
                        'case_id': 'synthetic-type-case', 'task_sha256': 'a' * 64, 'checks_sha256': 'b' * 64,
                        'model': 'local-code', 'max_requests': 3, 'max_elapsed_seconds': 180,
                        'first_input_sha256': canonical_digest(coding_input(request['input'], schema_version=4)),
                        'subject': deepcopy(evidence['plan']['subject'])}
                    validate_contract(plan)
                    f.path.write_text(json.dumps(value))
                    plan_path = f.root / 'integer-plan.json'; plan_path.write_text(json.dumps(plan))
                    request_path = f.root / 'integer-request.json'; request_path.write_text(json.dumps(request))
                    self.addCleanup(lambda f=f: f.command('disconnect', check=False))
                    f.command('connect')
                    ordinary = ('request-file', str(request_path), 'bound-conversation')
                    self.assertEqual(f.client(*ordinary)['status'], 503)
                    armed = json.loads(f.command('qualify', '--plan', str(plan_path)).stdout)
                    options = (*ordinary, 'qualification-probe', armed['probe_id'])
                    response = f.client(*options)
                    feedbacks = []
                    for step, expected_exit in [(1, 1), (2, 0)]:
                        self.assertEqual(response['status'], 200, response)
                        call = response['body']['output'][0]
                        self.assertEqual((call['type'], call['name'], call['call_id']),
                                         ('function_call', 'exec_command', 'type-call-' + str(step)))
                        arguments = json.loads(call['arguments']); self.assertEqual(set(arguments), {'cmd'})
                        run = subprocess.run(shlex.split(arguments['cmd']), cwd=project,
                            env={'HOME': str(project), 'PATH': str(Path(sys.executable).parent) + ':/usr/bin:/bin',
                                 'PYTHONDONTWRITEBYTECODE': '1'}, capture_output=True, text=True, timeout=4)
                        self.assertEqual(run.returncode, expected_exit, run.stdout + run.stderr)
                        self.assertLess(len(run.stdout) + len(run.stderr), 8192)
                        if step == 1:
                            self.assertNotIn('KOTO_INTEGER_CHECKS_OK', run.stdout)
                            (project / 'solution.py').write_text(after)  # External host repair control.
                        else:
                            self.assertEqual(run.stdout, 'KOTO_INTEGER_CHECKS_OK 4\n')
                        feedback = f'Chunk ID: integer-{step}\nWall time: 0 seconds\nProcess exited with code {run.returncode}\nOutput:\n' + run.stdout + run.stderr
                        feedbacks.append(feedback)
                        request['input'] += response['body']['output'] + [
                            {'type': 'function_call_output', 'call_id': call['call_id'], 'output': feedback}]
                        request_path.write_text(json.dumps(request))
                        response = f.client(*options)
                    self.assertEqual(response['status'], 200, response)
                    self.assertIn('MANAGED_LOCAL', json.dumps(response['body']))
                    captured = [json.loads(line) for line in (engine / 'type-requests.jsonl').read_text().splitlines()]
                    self.assertEqual(len(captured), 3)
                    self.assertEqual([item['output'] for item in captured[-1]['input']
                        if item.get('type') == 'function_call_output'], feedbacks)
                    self.assertEqual(cloud_requests, [])
                    status = json.loads(f.command('qualify').stdout)
                    self.assertEqual((status['submitted_requests'], status['automatic_admission_effect']), (3, 'none'))
                    state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
                    self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
                    self.assertEqual(f.client(*ordinary)['status'], 503)
                    f.command('disconnect')
                    self.assertEqual(f.client('inspect')['model'], 'original-model')
