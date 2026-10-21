"""V9 reasoning continues through the public router without granting admission."""
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


class CodingProbeV9ReasoningWorkflowTests(unittest.TestCase):
    def test_explicit_v9_probe_continues_and_restores_the_native_connection(self):
        fixture = coding.CodingOutputWorkflowTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.fixture
        with lifetime.provider('CLOUD_MUST_STAY_UNUSED') as (cloud, cloud_requests):
            value, engine, request = fixture.prepare(cloud)
            executable = engine / 'llama-server'
            # The controlled provider emits only tools declared by this native
            # host. Capture the real adapted boundary, without executing a model
            # or the scripted native commands.
            scripted = '''        capture=pathlib.Path(__file__).with_name("provider-requests.jsonl")
        with capture.open("a") as observed:
            observed.write(json.dumps(body)+"\\n")
        step=len(capture.read_text().splitlines())
        calls=[
            {"type":"function_call","call_id":"patch-saved","name":"apply_patch", "arguments":json.dumps({"input":"*** Begin Patch\\n*** Update File: solution.py\\n@@\\n-    return value\\n+    return value + 1\\n*** End Patch"})},
            {"type":"function_call","call_id":"print-check","name":"exec_command", "arguments":json.dumps({"cmd":"python3 -c 'print(4)'"})},
            {"type":"function_call","call_id":"exception-check","name":"exec_command", "arguments":json.dumps({"cmd":"python3 -c 'try:\\n    {}[\\\"missing\\\"]\\nexcept KeyError as error:\\n    assert str(error) == \\\"missing\\\"'"})},
            {"type":"function_call","call_id":"assert-check","name":"exec_command", "arguments":json.dumps({"cmd":"python3 -c 'assert 2 + 2 == 4'"})}]
        if step <= len(calls):
            result["output"]=[calls[step-1]]
            if step == 1:
                result["output"].insert(0, {"type":"reasoning","id":"rs-native","summary":[], "content":[{"type":"reasoning_text","text":"Inspect the actual saved source."}]})
'''
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
            route['capabilities'].append('qwen_code_v9')
            value['route_admission']['local_routes']['local-code']['max_request_bytes'] = 65536
            native = json.loads((Path(__file__).parent / 'fixtures/codex-0160-native-progress.json').read_text())
            request['tools'] = [native['declarations']['exec_command'], native['declarations']['apply_patch']]
            request['reasoning'] = {'effort': 'low'}
            evidence = fixture.evidence(value, request)
            plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 5,
                'campaign_id': 'synthetic-v9-reasoning', 'plan_sha256': evidence['plan_sha256'],
                'case_id': 'synthetic-case', 'task_sha256': 'a' * 64, 'checks_sha256': 'b' * 64,
                'model': 'local-code', 'max_requests': 5, 'max_elapsed_seconds': 180,
                'first_input_sha256': canonical_digest(coding_input(request['input'], schema_version=4)),
                'subject': deepcopy(evidence['plan']['subject'])}
            validate_contract(plan)
            f.path.write_text(json.dumps(value))
            plan_path, request_path = f.root / 'probe-v9.json', f.root / 'request-v9.json'
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
            self.assertEqual((call['type'], call['name']), ('custom_tool_call', 'apply_patch'))
            continuation = deepcopy(request)
            patch_output = 'Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM solution.py\n'
            continuation['input'] += first['body']['output'] + [
                {'type': 'custom_tool_call_output', 'call_id': call['call_id'], 'output': patch_output}]
            opaque = deepcopy(continuation)
            opaque['input'][1]['encrypted_content'] = 'opaque-not-authorized'
            request_path.write_text(json.dumps(opaque))
            self.assertNotEqual(f.client(*options)['status'], 200)
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'])
            request_path.write_text(json.dumps(continuation))
            second = f.client(*options)
            self.assertEqual(second['status'], 200, second)
            self.assertEqual(first['headers']['x-hormuz-work-id'], second['headers']['x-hormuz-work-id'])
            self.assertEqual(second['headers']['x-hormuz-routing-reason'], 'session_affinity')
            captured = lambda: [json.loads(line) for line in (engine / 'provider-requests.jsonl').read_text().splitlines()]
            self.assertEqual([body['reasoning_budget_tokens'] for body in captured()], [32, 64])
            # Reject an exact replay while the probe still has capacity.
            self.assertNotEqual(f.client(*options)['status'], 200)
            self.assertEqual(len(captured()), 2)
            self.assertEqual([item['output'] for item in captured()[-1]['input']
                if item.get('type') == 'function_call_output'], [patch_output])

            command_output = lambda code, text: ('Chunk ID: native-check\nWall time: 0.0001 seconds\n'
                f'Process exited with code {code}\nOutput:\n{text}')
            print_output = command_output(0, '4\n')
            failure_output = command_output(1, 'Traceback (most recent call last):\nKeyError: \'missing\'\n'
                '\nDuring handling of the above exception, another exception occurred:\n\n'
                'Traceback (most recent call last):\nAssertionError\n')
            outputs = [print_output, failure_output, command_output(0, '')]
            expected_budgets = [256, 256, 16]
            previous = second
            for index, (output, budget) in enumerate(zip(outputs, expected_budgets)):
                call = previous['body']['output'][0]
                self.assertEqual((call['type'], call['name']), ('function_call', 'exec_command'))
                continuation['input'] += previous['body']['output'] + [
                    {'type': 'function_call_output', 'call_id': call['call_id'], 'output': output}]
                request_path.write_text(json.dumps(continuation))
                previous = f.client(*options)
                self.assertEqual(previous['status'], 200, previous)
                body = captured()[-1]
                self.assertEqual(body['reasoning_budget_tokens'], budget)
                checkpoint = '\n'.join(part['text'] for part in body['input'][-1]['content'])
                if index == 0:
                    self.assertIn('Recognized assertion intent in the latest successful command: not observed.', checkpoint)
                elif index == 1:
                    self.assertIn('assertRaises(KeyError, callable, ...)', checkpoint)
                    self.assertIn('original specification', checkpoint)
                else:
                    self.assertIn('Recognized assertion intent in the latest successful command: observed.', checkpoint)
                # Native feedback stays intact; it is not copied into advice.
                self.assertEqual([item['output'] for item in body['input']
                    if item.get('type') == 'function_call_output'][-1], output)
                self.assertNotIn('Traceback (most recent call last):', checkpoint)
            self.assertIn('MANAGED_LOCAL', json.dumps(previous['body']))
            self.assertNotEqual(f.client(*options)['status'], 200)
            status = json.loads(f.command('qualify').stdout)
            self.assertEqual((status['submitted_requests'], status['automatic_admission_effect']), (5, 'none'))
            self.assertEqual(f.client(*ordinary)['status'], 503)
            state = json.loads(f.command('status', '--routing').stdout)['routes'][0]
            self.assertEqual((state['coding_readiness'], state['automatic_task_types']), ('unknown', []))
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'] * 5)
            self.assertEqual(cloud_requests, [])
            f.command('disconnect')
            self.assertEqual(f.client('inspect')['model'], 'original-model')


if __name__ == '__main__':
    unittest.main()
