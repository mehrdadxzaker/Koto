"""Explicit coding through the public CLI and an external native tool owner."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import signal
import time
import unittest
from urllib.parse import urlsplit

from hormuz.contracts import validate_contract
from tests import test_execution_destination_workflow as workflow
from tests import test_personal_native_workflow as personal
from tests import test_connected_client_lifetime_workflow as lifetime
from hormuz.coding_qualification import request_profile_digest


NATIVE = personal.NATIVE.replace(
    "{'Content-Type':'application/json','Authorization':",
    "{'Content-Type':'application/json','User-Agent':'codex_exec/0.160.0','Authorization':").replace(
    "emit({'id':request['id'],'result':result})",
    """if method=='thread/start':
  sandbox=({'type':'workspaceWrite','writableRoots':[params['cwd']],
   'networkAccess':False,'excludeTmpdirEnvVar':True,'excludeSlashTmp':True}
   if params.get('sandbox')=='workspace-write' else {'type':'readOnly'})
  result.update(cwd=params['cwd'],approvalPolicy=params['approvalPolicy'],sandbox=sandbox)
  if mode=='unsafe-sandbox': result['sandbox']['networkAccess']=True
  if mode=='replace-workspace':
   pathlib.Path(params['cwd']).rename(params['cwd']+'-replaced')
   pathlib.Path(params['cwd']).mkdir()
 emit({'id':request['id'],'result':result})""").replace(
    "answer=(home/'fixture-answer')",
    """if mode=='coding-callback':
  emit({'id':99,'method':'item/commandExecution/requestApproval','params':{}})
  continue
 answer=(home/'fixture-answer')""").replace(
    "emit({'method':'item/completed'",
    """if not failed and params['sandboxPolicy']['type']=='workspaceWrite':
  expected={'type':'workspaceWrite','writableRoots':[selected['cwd']],
   'networkAccess':False,'excludeTmpdirEnvVar':True,'excludeSlashTmp':True}
  assert params['sandboxPolicy']==expected
  pathlib.Path(selected['cwd'],'changed.py').write_text('answer = 7\\n')
  if mode=='coding-wait':
   (home/'coding-ready').write_text('Native edit completed; turn still in progress.')
   time.sleep(30)
 emit({'method':'item/completed'""")


class NativeCodingWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = personal.PersonalNativeWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.project = self.fixture.root / 'caller-project'
        self.project.mkdir()
        (self.project / 'original.txt').write_text('keep this project')
        self.fixture.prompt.write_text('Fix the Python answer function and run its tests.')
        import sys
        self.fixture.native.write_text(NATIVE.replace('#!PYTHON', '#!' + sys.executable, 1))

    def command(self, *arguments):
        return self.fixture.command('chat', 'code', '--workspace', str(self.project),
            '--executable', str(self.fixture.native), '--client-home', str(self.fixture.home),
            '--prompt-file', str(self.fixture.prompt), *arguments)

    def configure_coding(self, cloud):
        managed = lifetime.ConnectedClientLifetimeWorkflowTests()
        managed.setUp()
        self.addCleanup(managed.doCleanups)
        value, _, engine = managed.managed_configuration(cloud)
        value['route_admission']['mode'] = 'auto'
        value['upstream_timeout_seconds'] = 6
        value['policies']['organization'].pop('max_output_tokens', None)
        value['upstreams']['openai'] = {'protocol': 'openai',
            'base_url': 'https://chatgpt.com/backend-api/codex', 'locality': 'cloud',
            'authentication': 'codex_chatgpt'}
        value['model_routes']['cloud-code'] = {'protocol': 'openai', 'upstream_model': 'commercial-fixture'}
        value['policies']['organization']['allowed_models'].append('cloud-code')
        value['model_routes']['local-code']['capabilities'] = [
            'responses', 'text', 'streaming', 'tools', 'codex_http', 'codex_http_0160']
        value['route_admission']['local_routes']['local-code']['task_types'] = ['code_change']
        request = {'model': 'local-code', 'max_output_tokens': 8,
                   'input': self.fixture.prompt.read_text(), 'reasoning': {'effort': 'none'}}
        (self.fixture.home / 'native-wire.json').write_text(json.dumps(request))
        evidence = managed.coding_evidence(value)
        evidence['plan']['subject'].update(client_version='0.160.0',
            request_profile_sha256=request_profile_digest(request))
        evidence['plan_sha256'] = hashlib.sha256(json.dumps(evidence['plan'], sort_keys=True,
            separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        value['route_admission']['local_routes']['local-code']['coding_evidence'] = evidence
        self.fixture.path.write_text(json.dumps(value))
        origin = urlsplit(value['upstreams']['local-llama']['base_url'])
        process = subprocess.Popen([str(engine / 'llama-server'), '--port', str(origin.port),
            '--alias', value['model_routes']['local-code']['upstream_model']],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={key: os.environ[key] for key in ('PATH', 'HOME') if key in os.environ})
        def stop():
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        self.addCleanup(stop)
        deadline = time.monotonic() + 3
        while True:
            connection = http.client.HTTPConnection(origin.hostname, origin.port, timeout=.2)
            try:
                connection.request('GET', '/health')
                if connection.getresponse().status == 200:
                    break
            except OSError:
                if process.poll() is not None or time.monotonic() >= deadline:
                    self.fail('Disposable managed runtime did not become ready')
                time.sleep(.02)
            finally:
                connection.close()
        return value, evidence, engine

    def test_explicit_coding_uses_caller_workspace_and_native_tools_without_settings_changes(self):
        with workflow.provider('LOCAL_UNUSED') as (local, local_calls), \
                workflow.provider('CLOUD_UNUSED') as (cloud, cloud_calls):
            self.fixture.configure(local, cloud)
            before_config = (self.fixture.home / 'config.toml').read_bytes()
            before_auth = (self.fixture.home / 'auth.json').read_bytes()
            result = self.command()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            validate_contract(receipt)
            self.assertEqual(receipt['schema_version'], 2)
            self.assertEqual(receipt['context']['task_type'], 'code_change')
            self.assertEqual(receipt['context']['sandbox_mode'], 'workspace-write')
            self.assertFalse(receipt['context']['tool_network_access'])
            self.assertEqual((receipt['model'], receipt['locality']), ('cloud-code', 'cloud'))
            self.assertEqual((self.project / 'changed.py').read_text(), 'answer = 7\n')
            self.assertEqual((self.project / 'original.txt').read_text(), 'keep this project')
            self.assertEqual((self.fixture.home / 'config.toml').read_bytes(), before_config)
            self.assertEqual((self.fixture.home / 'auth.json').read_bytes(), before_auth)
            self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_explicit_qualified_coding_uses_the_owned_router_and_preserves_task_quality_as_unchecked(self):
        with lifetime.provider('CLOUD_UNUSED') as (cloud, cloud_calls):
            _, _, engine = self.configure_coding(cloud)
            self.assertEqual(self.fixture.command('history', 'enable').returncode, 0)
            self.assertEqual(self.fixture.command('history', 'learning', 'enable').returncode, 0)
            result = self.command('--model', 'local-code')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual((receipt['model'], receipt['locality'], receipt['text']),
                             ('local-code', 'local', 'MANAGED_LOCAL'))
            self.assertTrue(receipt['execution']['verified'])
            self.assertEqual(receipt['execution']['local_attempts'], 1)
            self.assertEqual((self.project / 'changed.py').read_text(), 'answer = 7\n')
            entry = json.loads(self.fixture.command('history', 'show', receipt['history_entry']).stdout)['entry']
            self.assertTrue(entry['selection']['verified_response'])
            self.assertNotIn('quality', entry)
            self.assertEqual((engine / 'inference-count').read_text().splitlines(), ['1'])
            self.assertEqual(cloud_calls, [])

    def test_missing_or_relative_workspace_is_rejected_before_native_start(self):
        for workspace in ('relative-project', str(self.fixture.root / 'missing-project'), '/'):
            with self.subTest(workspace=workspace):
                result = self.fixture.command('chat', 'code', '--workspace', workspace,
                    '--executable', str(self.fixture.native), '--client-home', str(self.fixture.home),
                    '--prompt-file', str(self.fixture.prompt))
                self.assertEqual(result.returncode, 2)
                self.assertIn('native_workspace_invalid', result.stderr or result.stdout)
                self.assertFalse((self.fixture.home / 'requests.jsonl').exists())

    def test_unverified_native_sandbox_cannot_start_a_coding_turn(self):
        (self.fixture.home / 'fixture-mode').write_text('unsafe-sandbox')
        with workflow.provider('UNUSED') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.fixture.configure(local, cloud)
            result = self.command()
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['error'], 'native_sandbox_unverified')
            self.assertFalse(receipt['execution']['verified'])
            requests = [json.loads(line) for line in (self.fixture.home / 'requests.jsonl').read_text().splitlines()]
            self.assertNotIn('turn/start', [row.get('method') for row in requests])
            self.assertFalse((self.project / 'changed.py').exists())
            self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_replaced_workspace_and_unsupported_callback_fail_without_edits_or_replay(self):
        with workflow.provider('UNUSED') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.fixture.configure(local, cloud)
            for mode, expected in (('replace-workspace', 'native_workspace_changed'),
                                   ('coding-callback', 'native_client_action_required')):
                with self.subTest(mode=mode):
                    log = self.fixture.home / 'requests.jsonl'
                    log.unlink(missing_ok=True)
                    (self.fixture.home / 'fixture-mode').write_text(mode)
                    result = self.command()
                    self.assertEqual(result.returncode, 2, result.stderr or result.stdout)
                    receipt = json.loads(result.stdout)
                    self.assertEqual(receipt['error'], expected)
                    self.assertFalse(receipt['execution']['verified'])
                    self.assertTrue(receipt['native']['cleanup']['owned_processes_stopped'])
                    self.assertFalse((self.project / 'changed.py').exists())
                    starts = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertEqual(sum(row.get('method') == 'turn/start' for row in starts),
                                     1 if mode == 'coding-callback' else 0)
            self.assertFalse((Path(str(self.project) + '-replaced') / 'changed.py').exists())
            self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_missing_failed_and_other_client_coding_evidence_rejects_explicit_local_before_turn(self):
        with lifetime.provider('UNUSED') as (cloud, cloud_calls):
            value, evidence, engine = self.configure_coding(cloud)
            for variant in ('missing', 'failed', 'other-client'):
                with self.subTest(evidence=variant):
                    changed = json.loads(json.dumps(evidence))
                    if variant == 'missing':
                        changed = None
                    elif variant == 'failed':
                        changed['outcomes'][0]['check_exit_code'] = 1
                    else:
                        changed['plan']['subject']['client_version'] = '0.147.0'
                        changed['plan_sha256'] = hashlib.sha256(json.dumps(changed['plan'], sort_keys=True,
                            separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
                    qualification = value['route_admission']['local_routes']['local-code']
                    if changed is None:
                        qualification.pop('coding_evidence', None)
                    else:
                        qualification['coding_evidence'] = changed
                    self.fixture.path.write_text(json.dumps(value))
                    log = self.fixture.home / 'requests.jsonl'
                    log.unlink(missing_ok=True)
                    result = self.command('--model', 'local-code')
                    self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                    self.assertEqual(json.loads(result.stdout)['error'], 'native_local_model_not_qualified')
                    requests = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertNotIn('thread/start', [row.get('method') for row in requests])
                    self.assertFalse((self.project / 'changed.py').exists())
                    self.assertFalse((engine / 'inference-count').exists())
            self.assertEqual(cloud_calls, [])

    def test_changed_native_wire_profile_is_denied_before_model_inference_or_edits(self):
        with lifetime.provider('UNUSED') as (cloud, cloud_calls):
            _, _, engine = self.configure_coding(cloud)
            wire = self.fixture.home / 'native-wire.json'
            request = json.loads(wire.read_text())
            request['instructions'] = 'Different unqualified coding instructions.'
            wire.write_text(json.dumps(request))
            result = self.command('--model', 'local-code')
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['error'], 'native_turn_failed')
            self.assertFalse(receipt['execution']['verified'])
            self.assertFalse((engine / 'inference-count').exists())
            self.assertFalse((self.project / 'changed.py').exists())
            self.assertEqual(cloud_calls, [])

    def test_legacy_route_stays_read_only_and_uses_a_different_learning_context(self):
        with workflow.provider('UNUSED') as (local, _), workflow.provider('UNUSED') as (cloud, _):
            self.fixture.configure(local, cloud)
            self.assertEqual(self.fixture.command('history', 'enable').returncode, 0)
            self.assertEqual(self.fixture.command('history', 'learning', 'enable').returncode, 0)
            coding = json.loads(self.command().stdout)
            (self.project / 'changed.py').unlink()
            legacy = self.fixture.command('chat', 'route', '--executable', str(self.fixture.native),
                '--client-home', str(self.fixture.home), '--prompt-file', str(self.fixture.prompt))
            self.assertEqual(legacy.returncode, 0, legacy.stderr or legacy.stdout)
            receipt = json.loads(legacy.stdout)
            self.assertEqual(receipt['schema_version'], 1)
            self.assertNotIn('context', receipt)
            self.assertFalse((self.project / 'changed.py').exists())
            coding_entry = json.loads(self.fixture.command('history', 'show', coding['history_entry']).stdout)['entry']
            text_entry = json.loads(self.fixture.command('history', 'show', receipt['history_entry']).stdout)['entry']
            self.assertNotEqual(coding_entry['selection']['profile'], text_entry['selection']['profile'])

    def test_checked_coding_history_selects_local_but_new_work_and_changed_context_keep_the_baseline(self):
        (self.fixture.home / 'fixture-answer').write_text('MANAGED_LOCAL')
        with lifetime.provider('UNUSED') as (cloud, cloud_calls):
            value, _, engine = self.configure_coding(cloud)
            for arguments in (('history', 'enable'), ('history', 'learning', 'enable')):
                result = self.fixture.command(*arguments)
                self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            checks = self.fixture.root / 'checks.json'
            checks.write_text(json.dumps([{'metric': 'answer', 'kind': 'text_equals', 'value': 'MANAGED_LOCAL'}]))
            for partition, suffix in (('development', ''), ('held_out', ' today')):
                for text in ('Fix invoice tally Python code for boxes', 'Fix invoice tally Python code for crates',
                             'Fix invoice tally Python code for packages'):
                    self.fixture.prompt.write_text(text + suffix)
                    for model in ('local-code', None):
                        result = self.command(*(() if model is None else ('--model', model)))
                        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                        receipt = json.loads(result.stdout)
                        if model is not None:
                            local_latency = receipt['native']['latency_ms']
                            delay = (local_latency + 100) / 1000
                            self.assertLess(delay, 5, receipt)
                            (self.fixture.home / 'cloud-delay').write_text(str(delay))
                        else:
                            self.assertGreater(receipt['native']['latency_ms'], local_latency, receipt)
                        feedback = self.fixture.command('history', 'feedback', receipt['history_entry'],
                            '--checks', str(checks), '--partition', partition)
                        self.assertEqual(feedback.returncode, 0, feedback.stderr or feedback.stdout)
            validation = self.fixture.command('history', 'learning', 'validate', '--baseline', 'cloud-code', '--activate')
            self.assertEqual(validation.returncode, 0, validation.stderr or validation.stdout)
            validation_receipt = json.loads(validation.stdout)
            self.assertEqual((validation_receipt['passed'], validation_receipt['held_out_cases'],
                              validation_receipt['local_selections']), (True, 3, 3))
            before = len((engine / 'inference-count').read_text().splitlines())
            for text, model in (('Fix invoice tally Python code for boxes tomorrow', 'local-code'),
                                ('Implement Unicode normalization across grapheme clusters', 'cloud-code')):
                self.fixture.prompt.write_text(text)
                result = self.command()
                self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                self.assertEqual(json.loads(result.stdout)['model'], model, result.stdout)
            self.assertEqual(len((engine / 'inference-count').read_text().splitlines()), before + 1)
            # A different caller workspace cannot inherit this workspace's validated selector.
            other_project = self.fixture.root / 'another-project'
            other_project.mkdir()
            self.fixture.prompt.write_text('Fix invoice tally Python code for boxes tomorrow')
            changed = self.fixture.command('chat', 'code', '--workspace', str(other_project),
                '--executable', str(self.fixture.native), '--client-home', str(self.fixture.home),
                '--prompt-file', str(self.fixture.prompt))
            self.assertEqual(changed.returncode, 0, changed.stderr or changed.stdout)
            self.assertEqual(json.loads(changed.stdout)['model'], 'cloud-code')
            value['route_admission']['mode'] = 'local_only'
            self.fixture.path.write_text(json.dumps(value))
            self.fixture.prompt.write_text('Implement Unicode normalization across grapheme clusters')
            blocked = self.command()
            self.assertEqual(blocked.returncode, 2, blocked.stderr or blocked.stdout)
            self.assertEqual(json.loads(blocked.stdout)['error'], 'native_local_only_requires_qualified_selection')
            self.assertEqual(len((engine / 'inference-count').read_text().splitlines()), before + 1)
            self.assertEqual(cloud_calls, [])

    def test_validated_read_only_text_history_does_not_authorize_writable_coding_selection(self):
        (self.fixture.home / 'fixture-answer').write_text('MANAGED_LOCAL')
        with lifetime.provider('UNUSED') as (cloud, cloud_calls):
            value, _, engine = self.configure_coding(cloud)
            value['route_admission']['local_routes']['local-code']['task_types'] = ['summarization', 'code_change']
            self.fixture.path.write_text(json.dumps(value))
            for arguments in (('history', 'enable'), ('history', 'learning', 'enable')):
                self.assertEqual(self.fixture.command(*arguments).returncode, 0)
            checks = self.fixture.root / 'checks.json'
            checks.write_text(json.dumps([{'metric': 'answer', 'kind': 'text_equals', 'value': 'MANAGED_LOCAL'}]))
            def text_command(*arguments):
                return self.fixture.command('chat', 'route', '--executable', str(self.fixture.native),
                    '--client-home', str(self.fixture.home), '--prompt-file', str(self.fixture.prompt), *arguments)
            for partition, suffix in (('development', ''), ('held_out', ' today')):
                for text in ('Summarize invoice tally seven boxes', 'Summarize invoice tally seven crates',
                             'Summarize invoice tally seven packages'):
                    self.fixture.prompt.write_text(text + suffix)
                    for model in ('local-code', None):
                        result = text_command(*(() if model is None else ('--model', model)))
                        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                        receipt = json.loads(result.stdout)
                        if model is not None:
                            delay = (receipt['native']['latency_ms'] + 100) / 1000
                            self.assertLess(delay, 5, receipt)
                            (self.fixture.home / 'cloud-delay').write_text(str(delay))
                        feedback = self.fixture.command('history', 'feedback', receipt['history_entry'],
                            '--checks', str(checks), '--partition', partition)
                        self.assertEqual(feedback.returncode, 0, feedback.stderr or feedback.stdout)
            validation = self.fixture.command('history', 'learning', 'validate', '--baseline', 'cloud-code', '--activate')
            self.assertEqual(validation.returncode, 0, validation.stderr or validation.stdout)
            self.assertTrue(json.loads(validation.stdout)['passed'])
            self.fixture.prompt.write_text('Summarize invoice tally seven boxes tomorrow')
            text = text_command()
            self.assertEqual(text.returncode, 0, text.stderr or text.stdout)
            self.assertEqual(json.loads(text.stdout)['model'], 'local-code')
            before = len((engine / 'inference-count').read_text().splitlines())
            coding = self.command()
            self.assertEqual(coding.returncode, 0, coding.stderr or coding.stdout)
            self.assertEqual(json.loads(coding.stdout)['model'], 'cloud-code')
            self.assertFalse(json.loads(coding.stdout)['selection']['validated'])
            self.assertEqual(len((engine / 'inference-count').read_text().splitlines()), before)
            self.assertEqual(cloud_calls, [])

    def test_cancellation_preserves_partial_edits_and_retains_an_unknown_outcome_without_replay(self):
        (self.fixture.home / 'fixture-mode').write_text('coding-wait')
        with workflow.provider('UNUSED') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.fixture.configure(local, cloud)
            self.assertEqual(self.fixture.command('history', 'enable').returncode, 0)
            self.assertEqual(self.fixture.command('history', 'learning', 'enable').returncode, 0)
            import sys
            process = subprocess.Popen([sys.executable, '-m', 'koto', '--config', str(self.fixture.path),
                'chat', 'code', '--workspace', str(self.project), '--executable', str(self.fixture.native),
                '--client-home', str(self.fixture.home), '--prompt-file', str(self.fixture.prompt)],
                env=self.fixture.environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                marker = self.fixture.home / 'coding-ready'
                deadline = time.monotonic() + 5
                while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(marker.exists(), 'Native coding host did not reach its edit boundary')
                process.send_signal(signal.SIGINT)
                output, error = process.communicate(timeout=6)
                self.assertEqual(process.returncode, 2, output + error)
                receipt = json.loads(output)
                validate_contract(receipt)
                self.assertEqual(receipt['error'], 'native_interrupted')
                self.assertTrue(receipt['native']['cleanup']['owned_processes_stopped'])
                self.assertEqual((self.project / 'changed.py').read_text(), 'answer = 7\n')
                entry = json.loads(self.fixture.command('history', 'show', receipt['history_entry']).stdout)['entry']
                self.assertEqual(entry['outcome'], 'outcome_unknown')
                self.assertFalse(entry['selection']['verified_response'])
                requests = [json.loads(line) for line in (self.fixture.home / 'requests.jsonl').read_text().splitlines()]
                self.assertEqual(sum(row.get('method') == 'turn/start' for row in requests), 1)
                self.assertEqual((local_calls, cloud_calls), ([], []))
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=6)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=2)
                process.stdout.close()
                process.stderr.close()
