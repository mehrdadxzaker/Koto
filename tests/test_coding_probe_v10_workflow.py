"""The opt-in v10 probe crosses the public Router while the Coding client owns execution."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tarfile
import unittest

from hormuz._contract_schemas.local_coding import canonical_digest, coding_input
from hormuz.codex_llama import CodexLlamaRequest
from hormuz.contracts import validate_contract
from hormuz.local_python_script import compile_script
from hormuz.local_text_patch import compile_text_patch
from tests import test_coding_output_workflow as coding
from tests import test_connected_client_lifetime_workflow as lifetime


class CodingProbeV10WorkflowTests(unittest.TestCase):
    def test_two_helpers_round_trip_native_feedback_without_automatic_admission(self):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = fixture.prepare(cloud)
            edit = {'path': 'solution.py', 'old_text': '    return value', 'new_text': '    return value + 1'}
            scripts = ['print(4)', 'from solution import transform\nassert transform(3) == 4\n']
            workdir = '/native/workspace'
            # A bounded mock provider observes the actual offered interface.
            # Native feedback below is supplied by this host fixture; no real
            # model or scripted native command is executed by this test.
            scripted = (f'        edit={edit!r}\n'
                        f'        scripts={scripts!r}\n'
                        f'        workdir={workdir!r}\n') + '''        capture=pathlib.Path(__file__).with_name("provider-requests.jsonl")
        with capture.open("a") as observed:
            observed.write(json.dumps(body)+"\\n")
        step=len(capture.read_text().splitlines())
        calls=[
            {"type":"function_call","id":"patch-item","call_id":"patch-saved","name":"koto_replace","arguments":json.dumps({"edit":edit})},
            {"type":"function_call","id":"print-item","call_id":"print-call","name":"koto_python","arguments":json.dumps({"script":scripts[0],"workdir":workdir})},
            {"type":"function_call","id":"assert-item","call_id":"assert-call","name":"koto_python","arguments":json.dumps({"script":scripts[1],"workdir":workdir})}]
        if step <= len(calls):
            result["output"]=[calls[step-1]]
            if step == 1:
                result["output"].insert(0, {"type":"reasoning","id":"rs-native","summary":[],"content":[{"type":"reasoning_text","text":"Inspect the actual saved source."}]})
'''
            executable = engine / 'llama-server'
            program = executable.read_text()
            start = program.index('        items=body.get("input", [])')
            end = program.index('        data=json.dumps(result).encode()', start)
            executable.write_text(program[:start] + scripted + program[end:])
            archive = Path(value['managed_llama']['runtime_archive'])
            with tarfile.open(archive, 'w:gz') as bundle:
                for path in engine.iterdir():
                    bundle.add(path, arcname=path.name)
            value['managed_llama']['runtime_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
            route = value['model_routes']['local-code']
            route['upstream_model'] = 'Qwen3-14B-Q4_K_M'
            route['capabilities'].append('qwen_code_v10')
            value['route_admission']['local_routes']['local-code']['max_request_bytes'] = 65536
            native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
            request['tools'] = [native['declarations']['exec_command'], native['declarations']['apply_patch']]
            request.update(reasoning={'effort': 'low'}, tool_choice='auto')
            original_tools = CodexLlamaRequest(request).value['tools']
            evidence = fixture.evidence(value, request)
            plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 5,
                'campaign_id': 'synthetic-v10-native-feedback', 'plan_sha256': evidence['plan_sha256'],
                'case_id': 'synthetic-case', 'task_sha256': 'a' * 64, 'checks_sha256': 'b' * 64,
                'model': 'local-code', 'max_requests': 4, 'max_elapsed_seconds': 180,
                'first_input_sha256': canonical_digest(coding_input(request['input'], schema_version=4)),
                'subject': deepcopy(evidence['plan']['subject'])}
            validate_contract(plan)
            f.path.write_text(json.dumps(value))
            plan_path, request_path = f.root / 'probe-v10.json', f.root / 'request-v10.json'
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
            call = first['body']['output'][-1]
            self.assertEqual((call['type'], call['name'], call['input']),
                             ('custom_tool_call', 'apply_patch', compile_text_patch(edit)))
            self.assertEqual((call['id'], call['call_id']), ('patch-item', 'patch-saved'))
            self.assertNotIn('arguments', call)
            continuation = deepcopy(request)
            patch_feedback = native['cases']['patch_success']['result']['output']
            continuation['input'] += first['body']['output'] + [
                {'type': 'custom_tool_call_output', 'call_id': call['call_id'], 'output': patch_feedback}]
            opaque = deepcopy(continuation)
            opaque['input'][1]['encrypted_content'] = 'opaque-not-authorized'
            request_path.write_text(json.dumps(opaque))
            self.assertNotEqual(f.client(*options)['status'], 200)
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'])
            request_path.write_text(json.dumps(continuation))
            previous = f.client(*options)
            self.assertEqual(previous['status'], 200, previous)
            self.assertEqual(previous['headers']['x-hormuz-work-id'], first['headers']['x-hormuz-work-id'])
            self.assertEqual(previous['headers']['x-hormuz-routing-reason'], 'session_affinity')
            self.assertNotEqual(f.client(*options)['status'], 200)  # Exact replay before exhaustion.
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'] * 2)
            feedbacks = [
                'Chunk ID: native-print\nWall time: 0 seconds\nProcess exited with code 0\nOutput:\n4\n',
                'Chunk ID: native-assert\nWall time: 0 seconds\nProcess exited with code 0\nOutput:\n']
            for index, (script, feedback) in enumerate(zip(scripts, feedbacks)):
                call = previous['body']['output'][0]
                self.assertEqual((call['type'], call['name']), ('function_call', 'exec_command'))
                self.assertEqual(call['call_id'], 'print-call' if index == 0 else 'assert-call')
                self.assertEqual(json.loads(call['arguments']),
                                 {'cmd': compile_script(script), 'workdir': workdir})
                self.assertNotIn('namespace', call)
                continuation['input'] += previous['body']['output'] + [
                    {'type': 'function_call_output', 'call_id': call['call_id'], 'output': feedback}]
                request_path.write_text(json.dumps(continuation))
                previous = f.client(*options)
                self.assertEqual(previous['status'], 200, previous)
            captured = [json.loads(line) for line in (engine / 'provider-requests.jsonl').read_text().splitlines()]
            self.assertEqual([body['reasoning_budget_tokens'] for body in captured], [256, 256, 256, 256])
            for body in captured:
                self.assertEqual([tool['name'] for tool in body['tools'][:2]], ['koto_replace', 'koto_python'])
                self.assertEqual(body['tools'][2:], original_tools)
                self.assertEqual(body['tool_choice'], 'auto')
                self.assertNotIn('koto_python_checks', body['instructions'])
            self.assertEqual([item['output'] for item in captured[-1]['input']
                if item.get('type') == 'function_call_output'], [patch_feedback, *feedbacks])
            self.assertIn('MANAGED_LOCAL', json.dumps(previous['body']))
            self.assertNotEqual(f.client(*options)['status'], 200)
            status = json.loads(f.command('qualify').stdout)
            self.assertEqual((status['submitted_requests'], status['automatic_admission_effect']), (4, 'none'))
            self.assertEqual(f.client(*ordinary)['status'], 503)
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'] * 4)
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')


if __name__ == '__main__':
    unittest.main()
