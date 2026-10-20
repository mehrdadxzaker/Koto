"""Personal native sessions through the CLI, real router, history and native process."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest

from tests import test_execution_destination_workflow as workflow
from hormuz.contracts import validate_contract

NATIVE = r'''#!PYTHON
import http.client,json,os,pathlib,sys,time,tomllib
from urllib.parse import urlsplit
if '--version' in sys.argv:
 print('codex-cli 0.160.0');sys.exit(0)
home=pathlib.Path(os.environ['CODEX_HOME'])
def emit(value): print(json.dumps(value),flush=True)
for line in sys.stdin:
 request=json.loads(line)
 with (home/'requests.jsonl').open('a') as output: output.write(json.dumps(request)+'\n')
 if 'id' not in request: continue
 method=request['method'];params=request.get('params',{})
 if method=='initialize': result={'userAgent':'fixture-codex/0.160.0'}
 elif method=='config/read': result={'config':tomllib.loads((home/'config.toml').read_text())}
 elif method=='account/read':
  mode=(home/'fixture-mode').read_text() if (home/'fixture-mode').exists() else ''
  result={'account':{'type':'chatgpt','email':'fixture@example.test','planType':{} if mode=='bad-account' else 'pro'},'requiresOpenaiAuth':True}
 elif method=='thread/start':
  selected=params
  mode=(home/'fixture-mode').read_text() if (home/'fixture-mode').exists() else ''
  result={'thread':{'id':'' if mode=='bad-thread' else 'thread-one','modelProvider':params['modelProvider']},'model':params['model'],'modelProvider':params['modelProvider']}
 elif method=='turn/start': result={'turn':{'id':'turn-one','status':'inProgress','items':[],'error':None}}
 else: raise RuntimeError('Unexpected native request: '+method)
 emit({'id':request['id'],'result':result})
 if method!='turn/start': continue
 mode=(home/'fixture-mode').read_text() if (home/'fixture-mode').exists() else ''
 answer=(home/'fixture-answer').read_text() if (home/'fixture-answer').exists() else 'Native final answer.'
 failed=False
 if selected['modelProvider'].startswith('koto_') and mode!='skip-router':
  provider=selected['config']['model_providers.'+selected['modelProvider']]
  origin=urlsplit(provider['base_url']);connection=http.client.HTTPConnection(origin.hostname,origin.port,timeout=4)
  try:
   wire=home/'native-wire.json'
   body=json.loads(wire.read_text()) if wire.exists() else {'max_output_tokens':8}
   body.update(model=selected['model'],input=params['input'][0]['text'])
   connection.request('POST',origin.path+'/responses',json.dumps(body),
    {'Content-Type':'application/json','Authorization':'Bearer '+os.environ[provider['env_key']],**provider.get('http_headers',{})})
   response=connection.getresponse()
   if mode=='early-terminal' and response.status==200:
    raw=b''
    while b'"type": "response.completed"' not in raw:
     line=response.readline()
     if not line: break
     raw+=line
   else: raw=response.read()
   if response.status==200 and body.get('stream'):
    events=[json.loads(line[6:]) for line in raw.decode().splitlines() if line.startswith('data: {')]
    value=next(event['response'] for event in events if event.get('type')=='response.completed')
   else: value=json.loads(raw)
   (home/'router-observation.json').write_text(json.dumps({'status':response.status,'body':value}))
   failed=response.status!=200
   if not failed: answer=value['output'][0]['content'][0]['text']
  finally: connection.close()
 elif (home/'cloud-delay').exists(): time.sleep(float((home/'cloud-delay').read_text()))
 if mode=='evidence-error':
  for path in pathlib.Path.cwd().glob('work.sqlite3*'): path.unlink(missing_ok=True)
 emit({'method':'item/completed','params':{'threadId':'thread-one','turnId':'turn-one',
  'item':{'type':'agentMessage','id':'message-one','text':answer,'phase':'final_answer'}}})
 emit({'method':'thread/tokenUsage/updated','params':{'threadId':'thread-one','turnId':'turn-one',
  'tokenUsage':{'last':{'inputTokens':10,'cachedInputTokens':0,'outputTokens':3,'reasoningOutputTokens':0,'totalTokens':13},
                'total':{'inputTokens':10,'cachedInputTokens':0,'outputTokens':3,'reasoningOutputTokens':0,'totalTokens':13},'modelContextWindow':32768}}})
 emit({'method':'turn/completed','params':{'threadId':'thread-one','turn':{'id':'turn-one',
  'status':'failed' if failed else 'completed','error':{'message':'Controlled local rejection'} if failed else None}}})
'''


class PersonalNativeWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = workflow.ExecutionDestinationWorkflowTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root.resolve()
        self.home = self.root / 'native-home'
        self.home.mkdir(mode=0o700)
        self.original = b'model = "commercial-fixture"\nmodel_provider = "openai"\n'
        (self.home / 'config.toml').write_bytes(self.original)
        (self.home / 'auth.json').write_text('SYNTHETIC_NATIVE_AUTH_DO_NOT_COPY')
        self.native = self.root / 'native-codex'
        self.native.write_text(NATIVE.replace('#!PYTHON', '#!' + sys.executable, 1))
        self.native.chmod(0o700)
        self.path = self.root / 'gateway.json'
        self.prompt = self.root / 'prompt.txt'
        self.prompt.write_text('Summarize invoice tally seven boxes.')
        self.environment = {**os.environ, **self.fixture.environment,
            'KOTO_HISTORY_HOME': str(self.root / 'history'), 'CODEX_HOME': str(self.home)}

    def command(self, *arguments):
        result = subprocess.run([sys.executable, '-m', 'koto', '--config', str(self.path),
            *arguments], capture_output=True, text=True, env=self.environment, timeout=15)
        output = result.stdout or result.stderr
        if output.startswith('{'):
            receipt = json.loads(output)
            if receipt.get('schema_id', '').startswith('koto.native-task'):
                validate_contract(receipt)
        return result

    def configure(self, local, cloud):
        value = self.fixture.admission_configuration(local, cloud, mode='auto')
        value['model_routes']['local-code']['capabilities'].extend(['streaming', 'tools', 'codex_http_0160'])
        value['policies']['organization'].pop('max_output_tokens', None)
        value['upstreams']['openai'] = {'protocol': 'openai',
            'base_url': 'https://chatgpt.com/backend-api/codex',
            'locality': 'cloud', 'authentication': 'codex_chatgpt'}
        value['model_routes']['cloud-code']['upstream_model'] = 'commercial-fixture'
        self.path.write_text(json.dumps(value))

    def routing_native(self):
        self.native.write_text(NATIVE.replace('#!PYTHON', '#!' + sys.executable, 1))

    def test_fresh_session_uses_the_current_subscription_and_retains_checked_history_without_settings_changes(self):
        with workflow.provider('LOCAL') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            owned_ledger = self.root / 'usage.sqlite3'
            ledger_evidence = b'Existing owner ledger evidence must stay byte-for-byte unchanged.'
            owned_ledger.write_bytes(ledger_evidence)
            self.assertEqual(self.command('history', 'enable').returncode, 0)
            self.assertEqual(self.command('history', 'learning', 'enable').returncode, 0)
            result = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt))
            diagnostic = self.home / 'router-observation.json'
            self.assertEqual(result.returncode, 0, (result.stderr or result.stdout) +
                (diagnostic.read_text() if diagnostic.exists() else ''))
            receipt = json.loads(result.stdout)
            self.assertEqual((receipt['locality'], receipt['model'], receipt['text']),
                ('cloud', 'cloud-code', 'Native final answer.'))
            self.assertEqual(receipt['selection']['executed_model'], 'cloud-code')
            self.assertEqual((local_calls, cloud_calls), ([], []))
            entries = json.loads(self.command('history', 'list').stdout)['entries']
            self.assertEqual(len(entries), 1)
            entry = json.loads(self.command('history', 'show', entries[0]['id']).stdout)['entry']
            self.assertEqual((entry['schema_version'], entry['protocol'], entry['outcome']),
                (4, 'codex_app_server', 'succeeded'))
            self.assertIsNone(entry['http_status'])
            self.assertIsNone(entry['estimated_cost_microusd'])
            self.assertEqual((entry['input_tokens'], entry['output_tokens']), (10, 3))
            self.assertTrue(entry['selection']['verified_response'])
            self.assertNotIn('quality', entry)
            self.assertEqual((self.home / 'config.toml').read_bytes(), self.original)
            self.assertEqual((self.home / 'auth.json').read_text(), 'SYNTHETIC_NATIVE_AUTH_DO_NOT_COPY')
            self.assertNotIn('SYNTHETIC_NATIVE_AUTH', result.stdout)
            self.assertEqual(owned_ledger.read_bytes(), ledger_evidence)

    def test_explicit_qualified_local_native_turn_executes_the_real_router_and_retains_its_outcome(self):
        self.routing_native()
        with workflow.provider('LOCAL checked answer') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            self.assertEqual(self.command('history', 'enable').returncode, 0)
            self.assertEqual(self.command('history', 'learning', 'enable').returncode, 0)
            result = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt), '--model', 'local-code')
            diagnostic = self.home / 'router-observation.json'
            self.assertEqual(result.returncode, 0, (result.stderr or result.stdout) +
                (diagnostic.read_text() if diagnostic.exists() else ''))
            receipt = json.loads(result.stdout)
            self.assertEqual((receipt['locality'], receipt['model'], receipt['text']),
                ('local', 'local-code', 'LOCAL checked answer'))
            self.assertEqual(len(local_calls), 1)
            self.assertEqual(cloud_calls, [])
            entry = json.loads(self.command('history', 'show', receipt['history_entry']).stdout)['entry']
            self.assertTrue(entry['selection']['verified_response'])
            self.assertEqual((entry['protocol'], entry['locality'], entry['routed_model']),
                ('codex_app_server', 'local', 'fixture-local-model'))
            self.assertEqual((self.home / 'config.toml').read_bytes(), self.original)

    def test_malformed_native_summaries_remain_controlled_unknown_results(self):
        with workflow.provider('UNUSED') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            self.assertEqual(self.command('history', 'enable').returncode, 0)
            for mode, code in (('bad-thread', 'native_thread_invalid'), ('bad-account', 'native_account_invalid')):
                with self.subTest(mode=mode):
                    (self.home / 'fixture-mode').write_text(mode)
                    result = self.command('chat', 'route', '--executable', str(self.native),
                        '--client-home', str(self.home), '--prompt-file', str(self.prompt))
                    self.assertEqual(result.returncode, 2, result.stderr or result.stdout)
                    receipt = json.loads(result.stdout)
                    self.assertEqual((receipt['status'], receipt['error']), ('unknown', code))
                    self.assertFalse(receipt['execution']['verified'])
            self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_native_alias_outside_receipt_bounds_is_rejected_before_generation(self):
        with workflow.provider('UNUSED') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            value = json.loads(self.path.read_text())
            alias = 'c' * 129
            value['model_routes'][alias] = value['model_routes'].pop('cloud-code')
            value['policies']['organization']['allowed_models'] = ['local-code', alias]
            self.path.write_text(json.dumps(value))
            result = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt))
            self.assertEqual(result.returncode, 2, result.stderr or result.stdout)
            self.assertTrue(result.stdout, result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['error'], 'native_model_alias_invalid')
            requests = (self.home / 'requests.jsonl').read_text()
            self.assertNotIn('turn/start', requests)
            self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_native_completion_without_a_local_router_attempt_remains_unverified_and_retained(self):
        (self.home / 'fixture-mode').write_text('skip-router')
        with workflow.provider('LOCAL') as (local, local_calls), workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            self.assertEqual(self.command('history', 'enable').returncode, 0)
            self.assertEqual(self.command('history', 'learning', 'enable').returncode, 0)
            result = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt), '--model', 'local-code')
            self.assertEqual(result.returncode, 2, result.stderr or result.stdout)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['error'], 'native_local_execution_unverified')
            self.assertEqual(receipt['native']['status'], 'completed')
            entry = json.loads(self.command('history', 'show', receipt['history_entry']).stdout)['entry']
            self.assertEqual(entry['outcome'], 'outcome_unknown')
            self.assertEqual(entry['response_text'], 'Native final answer.')
            self.assertFalse(entry['selection']['verified_response'])
            self.assertEqual((local_calls, cloud_calls), ([], []))

    def test_checked_native_work_history_selects_local_and_unfamiliar_work_stays_commercial(self):
        (self.home / 'fixture-answer').write_text('7')
        available = [True]

        def slower_local(_body):
            time.sleep(.35)
            return '7'

        with workflow.provider(slower_local, health_status=lambda: 200 if available[0] else 503) as (local, local_calls), \
             workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            for args in (('history', 'enable'), ('history', 'learning', 'enable')):
                result = self.command(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
            checks = self.root / 'checks.json'
            checks.write_text(json.dumps([{'metric': 'answer', 'kind': 'text_equals', 'value': '7'}]))
            held_out_savings = []
            for partition, suffix in (('development', ''), ('held_out', ' today')):
                for text in ('Summarize invoice tally seven boxes', 'Summarize invoice tally seven crates',
                             'Summarize invoice tally seven packages'):
                    self.prompt.write_text(text + suffix)
                    local_latency = None
                    for model in ('local-code', None):
                        arguments = () if model is None else ('--model', model)
                        result = self.command('chat', 'route', '--executable', str(self.native),
                            '--client-home', str(self.home), '--prompt-file', str(self.prompt), *arguments)
                        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                        receipt = json.loads(result.stdout)
                        print(json.dumps({'training_partition': partition, 'prompt': text + suffix,
                            'model': receipt['model'], 'latency_ms': receipt['native']['latency_ms']}), flush=True)
                        if model == 'local-code':
                            local_latency = receipt['native']['latency_ms']
                            # The external stand-in waits longer than the whole paired
                            # local observation. Real process/network deadlines stay intact.
                            delay_seconds = (local_latency + 100) / 1000
                            self.assertLess(delay_seconds, 5, receipt)
                            (self.home / 'cloud-delay').write_text(str(delay_seconds))
                        else:
                            self.assertGreater(receipt['native']['latency_ms'], local_latency, receipt)
                            if partition == 'held_out':
                                held_out_savings.append(receipt['native']['latency_ms'] - local_latency)
                        feedback = self.command('history', 'feedback', receipt['history_entry'],
                            '--checks', str(checks), '--partition', partition)
                        self.assertEqual(feedback.returncode, 0, feedback.stderr or feedback.stdout)
            validation = self.command('history', 'learning', 'validate', '--baseline', 'cloud-code', '--activate')
            self.assertEqual(validation.returncode, 0, validation.stderr or validation.stdout)
            validation_receipt = json.loads(validation.stdout)
            self.assertEqual((validation_receipt['passed'], validation_receipt['held_out_cases'],
                validation_receipt['local_selections']), (True, 3, 3))
            self.assertEqual(validation_receipt['latency_saved_ms'], sum(held_out_savings))
            before = len(local_calls)
            for text, model, locality in (('Summarize invoice tally seven boxes tomorrow', 'local-code', 'local'),
                                           ('Translate bonjour into English', 'cloud-code', 'cloud'),
                                           ('Fix the invoice tally function in Python code', 'cloud-code', 'cloud')):
                self.prompt.write_text(text)
                result = self.command('chat', 'route', '--executable', str(self.native),
                    '--client-home', str(self.home), '--prompt-file', str(self.prompt))
                self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                receipt = json.loads(result.stdout)
                self.assertEqual((receipt['model'], receipt['locality']), (model, locality), receipt)
            self.assertEqual(len(local_calls) - before, 1)
            self.assertEqual(cloud_calls, [])
            self.assertEqual((self.home / 'config.toml').read_bytes(), self.original)
            available[0] = False
            self.prompt.write_text('Summarize invoice tally seven boxes tomorrow')
            offline = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt))
            self.assertEqual(offline.returncode, 0, offline.stderr or offline.stdout)
            self.assertEqual(json.loads(offline.stdout)['model'], 'cloud-code')
            requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
            starts = [row['params'] for row in requests if row.get('method') == 'thread/start']
            self.assertEqual(starts[-1]['modelProvider'], 'openai')
            explicit = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt), '--model', 'local-code')
            self.assertEqual(explicit.returncode, 2, explicit.stderr or explicit.stdout)
            self.assertEqual(json.loads(explicit.stdout)['error'], 'native_local_model_not_qualified')
            value = json.loads(self.path.read_text())
            value['route_admission']['mode'] = 'local_only'
            self.path.write_text(json.dumps(value))
            blocked = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt))
            self.assertEqual(blocked.returncode, 2, blocked.stderr or blocked.stdout)
            self.assertEqual(json.loads(blocked.stdout)['error'], 'native_local_only_requires_qualified_selection')
            after = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
            self.assertEqual(sum(row.get('method') == 'thread/start' for row in after), len(starts))
            self.assertEqual(len(local_calls) - before, 1)
            self.assertEqual(cloud_calls, [])
            available[0] = True
            value = json.loads(self.path.read_text())
            value['route_admission']['mode'] = 'auto'
            value['route_admission']['local_routes']['local-code']['max_output_tokens'] = 4
            self.path.write_text(json.dumps(value))
            self.prompt.write_text('Summarize invoice tally seven boxes tomorrow')
            changed = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt))
            self.assertEqual(changed.returncode, 0, changed.stderr or changed.stdout)
            self.assertEqual(json.loads(changed.stdout)['model'], 'cloud-code')
            self.assertEqual(len(local_calls) - before, 1)
            self.assertEqual(self.command('history', 'learning', 'disable').returncode, 0)
            retained = json.loads(self.command('history', 'list').stdout)['entries']
            self.assertTrue(retained)

    def test_captured_native_wire_uses_scoped_output_cap_and_local_profile_without_settings_changes(self):
        wire = json.loads((Path(__file__).parent / 'fixtures/codex-http-request-0.160.json').read_text())
        wire['reasoning'] = {'effort': 'none'}
        wire['instructions'] = 'PRIVATE_NATIVE_INSTRUCTION_OUTSIDE_HOST_HISTORY'
        (self.home / 'native-wire.json').write_text(json.dumps(wire))
        with workflow.provider('Native-shaped local answer', event_stream=True) as (local, local_calls), \
             workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            value = json.loads(self.path.read_text())
            self.path.write_text(json.dumps(value))
            original_config = self.path.read_bytes()
            self.assertEqual(self.command('history', 'enable').returncode, 0)
            self.assertEqual(self.command('history', 'learning', 'enable').returncode, 0)
            result = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt), '--model', 'local-code')
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['text'], 'Native-shaped local answer')
            self.assertTrue(receipt['execution']['verified'])
            self.assertEqual(local_calls[0]['body']['max_output_tokens'], 8)
            requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
            start = next(row['params'] for row in requests if row.get('method') == 'thread/start')
            self.assertEqual(start['config']['model_reasoning_effort'], 'none')
            self.assertEqual(start['config']['features.multi_agent'], False)
            self.assertTrue(Path(start['config']['model_catalog_json']).is_absolute())
            self.assertEqual(self.path.read_bytes(), original_config)
            self.assertEqual((self.home / 'config.toml').read_bytes(), self.original)
            self.assertEqual(cloud_calls, [])
            entries = json.loads(self.command('history', 'list').stdout)['entries']
            self.assertEqual(len(entries), 1)
            retained = json.loads(self.command('history', 'show', receipt['history_entry']).stdout)['entry']
            self.assertEqual(retained['schema_version'], 4)
            self.assertNotIn('PRIVATE_NATIVE_INSTRUCTION_OUTSIDE_HOST_HISTORY', json.dumps(retained))

    def test_native_deadline_cleans_owned_router_and_retains_unknown_attempt(self):
        entered, release = threading.Event(), threading.Event()
        with workflow.provider('Late answer', hold_first=(entered, release)) as (local, _), \
             workflow.provider('UNUSED') as (cloud, cloud_calls):
            self.configure(local, cloud)
            value = json.loads(self.path.read_text())
            value['upstream_timeout_seconds'] = 30
            self.path.write_text(json.dumps(value))
            self.assertEqual(self.command('history', 'enable').returncode, 0)
            started = time.monotonic()
            try:
                result = self.command('chat', 'route', '--executable', str(self.native),
                    '--client-home', str(self.home), '--prompt-file', str(self.prompt),
                    '--model', 'local-code', '--timeout-seconds', '1')
            finally:
                elapsed = time.monotonic() - started
                release.set()
            self.assertTrue(entered.is_set())
            self.assertLess(elapsed, 4, result.stderr or result.stdout)
            self.assertEqual(result.returncode, 2)
            receipt = json.loads(result.stdout)
            self.assertIn(receipt['error'], ('native_deadline', 'native_turn_failed'))
            self.assertFalse(receipt['execution']['verified'])
            entry = json.loads(self.command('history', 'show', receipt['history_entry']).stdout)['entry']
            self.assertIn(entry['outcome'], ('outcome_unknown', 'failed'))
            self.assertEqual(cloud_calls, [])

    def test_post_execution_evidence_failure_retains_native_answer_as_unknown(self):
        (self.home / 'fixture-mode').write_text('evidence-error')
        with workflow.provider('Retained local answer') as (local, _), workflow.provider('UNUSED') as (cloud, _):
            self.configure(local, cloud)
            self.assertEqual(self.command('history', 'enable').returncode, 0)
            result = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt), '--model', 'local-code')
            self.assertEqual(result.returncode, 2, result.stderr or result.stdout)
            self.assertTrue(result.stdout, result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual((receipt['status'], receipt['text']), ('unknown', 'Retained local answer'))
            self.assertFalse(receipt['execution']['verified'])
            entry = json.loads(self.command('history', 'show', receipt['history_entry']).stdout)['entry']
            self.assertEqual((entry['outcome'], entry['response_text']), ('outcome_unknown', 'Retained local answer'))

    def test_native_completion_waits_for_actual_gateway_settlement(self):
        wire = json.loads((Path(__file__).parent / 'fixtures/codex-http-request-0.160.json').read_text())
        wire['reasoning'] = {'effort': 'none'}
        (self.home / 'native-wire.json').write_text(json.dumps(wire))
        (self.home / 'fixture-mode').write_text('early-terminal')
        with workflow.provider('Settled answer', event_stream=True, hold_after_terminal=True) as (local, local_calls), \
             workflow.provider('UNUSED') as (cloud, _):
            self.configure(local, cloud)
            result = self.command('chat', 'route', '--executable', str(self.native),
                '--client-home', str(self.home), '--prompt-file', str(self.prompt), '--model', 'local-code')
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['execution'], {'verified': True, 'source': 'owned_router_receipts', 'local_attempts': 1})
            self.assertEqual(receipt['text'], 'Settled answer')
            self.assertEqual(len(local_calls), 1)
