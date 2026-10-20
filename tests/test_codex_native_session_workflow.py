"""Native sessions observed through the public runner and an external Codex process."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


NATIVE = r'''#!PYTHON
import json,os,pathlib,signal,sys,time,tomllib
home=pathlib.Path(os.environ['CODEX_HOME'])
mode=(home/'mode').read_text() if (home/'mode').exists() else 'normal'
if '--version' in sys.argv:
 print('codex-cli 0.160.0',flush=True)
 if mode=='interrupt_version_cleanup':
  signal.signal(signal.SIGTERM,signal.SIG_IGN)
  sys.stdin.read()
  (home/'cleanup-ready').write_text(str(os.getpid()))
  time.sleep(12)
 sys.exit(0)
if mode=='interrupt_during_cleanup': signal.signal(signal.SIGTERM,signal.SIG_IGN)
for line in sys.stdin:
 request=json.loads(line)
 with (home/'requests.jsonl').open('a') as output: output.write(json.dumps({**request,'nativePid':os.getpid()})+'\n')
 if 'id' not in request: continue
 method=request['method'];params=request.get('params',{})
 if method=='initialize': result={'userAgent':'codex-cli/0.160.0'}
 elif method=='config/read': result={'config':tomllib.loads((home/'config.toml').read_text())}
 elif method=='account/read':
  assert params=={'refreshToken':False}
  result={'account':{'type':'chatgpt','email':'private-account@example.test','planType':'pro'},'requiresOpenaiAuth':True}
  if mode=='api_account': result['account']={'type':'apiKey'}
  if mode=='malformed_account': result['account']['planType']={}
  if mode=='surrogate_account': result['account']['planType']='\ud800'
 elif method=='model/list':
  result={'data':[{'id':'commercial-default','model':'commercial-default','isDefault':True},
                  {'id':'other-model','model':'other-model','isDefault':False}],'nextCursor':None}
  if mode=='default_missing': result['data']=[]
  if mode=='default_ambiguous': result['data'][1]['isDefault']=True
  if mode=='default_paginated': result['nextCursor']='another-page'
 elif method=='thread/start':
  if mode=='gateway_environment':
   assert os.environ.get('KOTO_SESSION_GATEWAY_TOKEN')=='SYNTHETIC_GATEWAY_ONLY'
   assert 'OPENAI_API_KEY' not in os.environ and 'CODEX_API_KEY' not in os.environ and 'CODEX_ACCESS_TOKEN' not in os.environ
   (home/'gateway-verified').write_text('Gateway environment verified without serialization.')
  result={'thread':{'id':'thread-one','modelProvider':params['modelProvider']},
          'model':params['model'],'modelProvider':params['modelProvider']}
  if mode=='null_ids': result['thread']['id']=None
  if mode=='empty_ids': result['thread']['id']=''
  if mode=='nul_thread': result['thread']['id']='bad\x00thread'
  if mode=='malformed_thread_model': result['model']={}
  if mode=='malformed_thread_provider': result['modelProvider']={}
 elif method=='turn/start': result={'turn':{'id':'turn-one','status':'inProgress','items':[],'error':None}}
 else: raise RuntimeError('Unexpected native request: '+method)
 if method=='turn/start' and mode in ('null_ids','null_turn'): result['turn']['id']=None
 if method=='turn/start' and mode=='empty_ids': result['turn']['id']=''
 if method=='turn/start' and mode=='empty_turn': result['turn']['id']=''
 if method=='config/read' and mode=='malformed_native_model': result['config']['model']={}
 if method=='config/read' and mode=='malformed_native_provider': result['config']['model_provider']=['openai']
 print(json.dumps({'id':request['id'],'result':result}),flush=True)
 if method=='thread/start' and mode=='blocked_input': time.sleep(4);sys.exit(0)
 if method=='turn/start':
  events=[
   ('item/agentMessage/delta',{'threadId':'thread-one','turnId':'turn-one','itemId':'message-one','delta':'Partial '}),
   ('item/completed',{'threadId':'thread-one','turnId':'turn-one','item':{'type':'agentMessage','id':'message-one','text':'Native final answer.','phase':'final_answer'}}),
   ('thread/tokenUsage/updated',{'threadId':'thread-one','turnId':'turn-one','tokenUsage':{'last':{'inputTokens':10,'cachedInputTokens':2,'outputTokens':3,'reasoningOutputTokens':1,'totalTokens':13},'total':{'inputTokens':10,'cachedInputTokens':2,'outputTokens':3,'reasoningOutputTokens':1,'totalTokens':13},'modelContextWindow':32768}}),
   ('turn/completed',{'threadId':'thread-one','turn':{'id':'turn-one','status':'completed','error':None}})]
  if mode in ('failed','interrupted','partial_failed','partial_interrupted'):
   events[-1][1]['turn']['status']=mode.removeprefix('partial_')
  if mode in ('failed','terminal_error','partial_failed'):
   events[-1][1]['turn']['error']={'message':'PRIVATE_ERROR_SENTINEL'}
  if mode=='wrong_thread': events[-1][1]['threadId']='another-thread'
  if mode=='wrong_turn': events[-1][1]['turn']['id']='another-turn'
  if mode=='surrogate_answer': events[1][1]['item']['text']='\ud800'
  if mode=='missing_usage': events=[event for event in events if event[0]!='thread/tokenUsage/updated']
  if mode=='negative_usage': events[2][1]['tokenUsage']['last']['inputTokens']=-1
  if mode=='boolean_usage': events[2][1]['tokenUsage']['total']['outputTokens']=True
  if mode=='repeated_usage': events.insert(2,events[2])
  if mode=='commentary': events.insert(1,('item/completed',{'threadId':'thread-one','turnId':'turn-one',
    'item':{'type':'agentMessage','id':'commentary-one','text':'Native progress commentary.','phase':'commentary'}}))
  if mode in ('rerouted','other_turn_rerouted'):
   events.insert(0,('model/rerouted',{'threadId':'thread-one',
    'turnId':'turn-one' if mode=='rerouted' else 'other-turn',
    'fromModel':'commercial-fixture','toModel':'commercial-fallback','reason':'PRIVATE_ROUTING_REASON'}))
  if mode in ('null_ids','empty_ids','null_turn'):
   for _,params in events:
    if mode!='null_turn':
     if mode=='null_ids': params.pop('threadId',None)
     else: params['threadId']=''
    params.pop('turnId',None)
    if 'turn' in params: params['turn']['id']=None if mode!='empty_ids' else ''
  if mode=='malformed': print('not a JSON event',flush=True)
  if mode=='oversized_frame': print(json.dumps({'method':'notice','params':{'data':'x'*(1024*1024+1)}}),flush=True)
  if mode=='unterminated_frame':
   print('x'*(1024*1024+1),end='',flush=True);sys.exit(0)
  if mode=='stderr_limit':
   sys.stderr.write('x'*(3*1024*1024));sys.stderr.flush()
  if mode=='client_action':
   print(json.dumps({'id':99,'method':'item/tool/call','params':{'threadId':'thread-one','turnId':'turn-one'}}),flush=True)
  if mode in ('missing_terminal','truncated_terminal'): events=events[:-1]
  if mode in ('interrupt_after_partial','interrupt_during_cleanup','partial_failed','partial_interrupted','partial_completed'):
   events[1][1]['item'].update(text='Native retained partial answer.',phase='partial_answer')
  if mode in ('interrupt_after_partial','interrupt_during_cleanup'): events=events[:2]
  for method,params in events:
   print(json.dumps({'method':method,'params':params}),flush=True)
  if mode=='interrupt_after_partial':
   for _ in range(160): print(json.dumps({'method':'notice','params':{'data':'x'*8192}}),flush=True)
   (home/'partial-ready').write_text('The partial item preceded bounded pipe backpressure.')
   time.sleep(12)
  if mode=='interrupt_during_cleanup':
   os.close(sys.stdout.fileno());os.close(sys.stderr.fileno())
   continue
  if mode=='truncated_terminal': print('{"method":"turn/completed"',end='',flush=True)
  if mode!='normal': sys.exit(0)
if mode=='interrupt_during_cleanup':
 (home/'cleanup-ready').write_text(str(os.getpid()))
 time.sleep(12)
'''

WRAPPER = '''import json,signal,sys
from hormuz.codex_native_session import run_session
previous=signal.getsignal(signal.SIGINT)
result=run_session(*sys.argv[1:], 'An ordinary user prompt.', timeout_seconds=8)
assert signal.getsignal(signal.SIGINT)==previous
print(json.dumps({'schema_id':'koto.native-task','schema_version':1,
 'status':result['status'],'text':result['text'],'model':None,'locality':'cloud',
 'selection':None,'history_entry':None,
 'execution':{'verified':False,'source':'native_provider_binding','local_attempts':None},
 'native':result,'error':result['error']}),flush=True)
'''


class CodexNativeSessionWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='koto-native-session-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / 'native-home'
        self.home.mkdir(mode=0o700)
        self.cwd = self.root / 'project'
        self.cwd.mkdir()
        self.config = self.home / 'config.toml'
        self.config.write_text('model = "commercial-fixture"\nmodel_provider = "openai"\nmodel_reasoning_effort = "max"\n')
        self.auth = self.home / 'auth.json'
        self.auth.write_text('SYNTHETIC_NATIVE_AUTH_MUST_STAY_PRIVATE')
        self.executable = self.root / 'codex-fixture'
        self.executable.write_text(NATIVE.replace('#!PYTHON', '#!' + sys.executable, 1))
        self.executable.chmod(0o700)

    def test_existing_native_account_and_model_complete_without_changing_settings_or_executing_tools_in_koto(self):
        from hormuz.codex_native_session import run_session
        original = (self.config.read_bytes(), self.auth.read_bytes())
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=6)
        self.assertEqual(result['status'], 'completed', result)
        self.assertEqual((result['provider'], result['model']), ('openai', 'commercial-fixture'))
        self.assertEqual(result['text'], 'Native final answer.')
        self.assertEqual(result['usage']['last']['inputTokens'], 10)
        self.assertEqual(result['account'], {'type': 'chatgpt', 'planType': 'pro'})
        self.assertTrue(result['cleanup']['owned_processes_stopped'])
        self.assertGreaterEqual(result['latency_ms'], 0)
        self.assertEqual((self.config.read_bytes(), self.auth.read_bytes()), original)
        self.assertNotIn('private-account@example.test', json.dumps(result))
        self.assertNotIn('SYNTHETIC_NATIVE_AUTH', json.dumps(result))
        requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
        self.assertEqual([item['method'] for item in requests],
                         ['initialize', 'initialized', 'config/read', 'account/read', 'thread/start', 'turn/start'])
        thread = next(item['params'] for item in requests if item['method'] == 'thread/start')
        self.assertEqual((thread['model'], thread['modelProvider'], thread['ephemeral']),
                         ('commercial-fixture', 'openai', True))
        self.assertEqual(thread['approvalPolicy'], 'never')
        self.assertEqual(next(item['params']['input'] for item in requests if item['method'] == 'turn/start'),
                         [{'type': 'text', 'text': 'An ordinary user prompt.'}])

    def test_selection_uses_native_facts_before_creating_the_thread_in_the_same_process(self):
        from hormuz.codex_native_session import run_session
        provider = {'name': 'Koto', 'base_url': 'http://127.0.0.1:4567/v1', 'wire_api': 'responses',
                    'requires_openai_auth': False}
        catalog = str(self.root / 'owned-model-catalog.json')
        def select(facts):
            self.assertEqual((facts['native_model'], facts['native_provider']), ('commercial-fixture', 'openai'))
            self.assertEqual(len(facts['account_identity_digest']), 64)
            self.assertEqual(len(facts['declared_controls_digest']), 64)
            requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
            self.assertNotIn('thread/start', [item['method'] for item in requests])
            return {'model': 'local-fixture', 'provider': 'koto_fixture', 'provider_config': provider,
                    'config': {'model_catalog_json': catalog}}
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', select=select)
        self.assertEqual((result['status'], result['provider'], result['model']),
                         ('completed', 'koto_fixture', 'local-fixture'), result)
        self.assertEqual(result['requested'], {'provider': 'koto_fixture', 'model': 'local-fixture'})
        requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
        self.assertEqual(len({item['nativePid'] for item in requests}), 1)
        thread = next(item['params'] for item in requests if item['method'] == 'thread/start')
        self.assertEqual(thread['config']['model_providers.koto_fixture'], provider)
        self.assertEqual(thread['config']['model_catalog_json'], catalog)
        self.assertNotIn('koto_fixture', self.config.read_text())

    def test_raw_credentials_and_permission_overrides_cannot_enter_a_native_thread(self):
        from hormuz.codex_native_session import run_session
        cases = [
            {'provider_config': {'experimental_bearer_token': 'PRIVATE_TOKEN_SENTINEL'}},
            {'provider_config': {'http_headers': {'Authorization': 'Bearer PRIVATE_TOKEN_SENTINEL'}}},
            {'config': {'sandbox_mode': 'danger-full-access'}},
            {'config': {'approval_policy': 'on-request'}},
        ]
        for override in cases:
            with self.subTest(override=override):
                log = self.home / 'requests.jsonl'
                log.unlink(missing_ok=True)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
                    select=lambda facts: {'provider': 'koto_fixture', 'model': 'local-fixture', **override})
                self.assertEqual(result['status'], 'unknown', result)
                self.assertEqual(result['error'], 'native_selection_invalid')
                requests = [json.loads(line) for line in log.read_text().splitlines()]
                self.assertNotIn('thread/start', [item['method'] for item in requests])
                self.assertNotIn('PRIVATE_TOKEN_SENTINEL', log.read_text() + json.dumps(result))
                self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_only_a_bound_successful_terminal_can_report_completion(self):
        from hormuz.codex_native_session import run_session
        for mode, expected in [('wrong_thread', 'unknown'), ('wrong_turn', 'unknown'),
                               ('terminal_error', 'unknown'), ('malformed', 'unknown'),
                               ('failed', 'failed'), ('interrupted', 'interrupted'),
                               ('missing_usage', 'completed')]:
            with self.subTest(native_mode=mode):
                (self.home / 'mode').write_text(mode)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
                self.assertEqual(result['status'], expected, result)
                if mode == 'missing_usage':
                    self.assertIsNone(result['usage'])
                self.assertNotIn('PRIVATE_ERROR_SENTINEL', json.dumps(result))
                self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_native_binary_is_bound_and_replacement_after_preflight_blocks_before_thread_start(self):
        from hormuz.codex_native_session import run_session
        expected = hashlib.sha256(self.executable.read_bytes()).hexdigest()
        def select(facts):
            replacement = self.root / 'replaced-codex'
            replacement.write_bytes(self.executable.read_bytes() + b'\n# Different binary identity\n')
            replacement.chmod(0o700)
            replacement.replace(self.executable)
            return {}
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', select=select)
        self.assertEqual((result['status'], result['error']), ('unknown', 'native_binary_changed'), result)
        self.assertEqual(result['facts']['native_sha256'], expected)
        requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
        self.assertNotIn('thread/start', [item['method'] for item in requests])
        self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_a_complete_oversized_native_frame_is_rejected_with_owned_cleanup(self):
        from hormuz.codex_native_session import run_session
        (self.home / 'mode').write_text('oversized_frame')
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
        self.assertEqual((result['status'], result['error']), ('unknown', 'native_frame_limit'), result)
        self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_native_deadline_also_bounds_a_child_that_stops_reading_prompt_input(self):
        from hormuz.codex_native_session import run_session
        (self.home / 'mode').write_text('blocked_input')
        started = time.monotonic()
        result = run_session(self.executable, self.home, self.cwd, 'x' * 65536, timeout_seconds=2)
        self.assertEqual((result['status'], result['error']), ('unknown', 'native_deadline'), result)
        self.assertLess(time.monotonic() - started, 3.5)
        requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
        self.assertIn('thread/start', [item['method'] for item in requests])
        self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_a_transient_process_group_probe_denial_still_finishes_owned_cleanup(self):
        from hormuz.codex_native_session import run_session
        (self.home / 'mode').write_text('blocked_input')
        kill_group = os.killpg
        denied = []

        def probe(group, action):
            requests = self.home / 'requests.jsonl'
            owned = {json.loads(line)['nativePid'] for line in requests.read_text().splitlines()} if requests.exists() else set()
            if action == 0 and group in owned and not denied:
                denied.append(group)
                raise PermissionError(1, 'External process-group observation temporarily unavailable')
            return kill_group(group, action)

        try:
            started = time.monotonic()
            with patch.object(os, 'killpg', side_effect=probe):
                result = run_session(self.executable, self.home, self.cwd, 'x' * 65536, timeout_seconds=2)
            self.assertEqual(len(denied), 1)
            self.assertEqual((result['status'], result['error']), ('unknown', 'native_deadline'), result)
            self.assertTrue(result['cleanup']['owned_processes_stopped'], result)
            self.assertLess(time.monotonic() - started, 3.5)
            with self.assertRaises(ProcessLookupError):
                os.kill(denied[0], 0)
        finally:
            for pid in denied:
                try:
                    kill_group(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    try:
                        reaped, _ = os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        break
                    if reaped == pid:
                        break
                    time.sleep(.02)
                else:
                    self.fail('Owned native fixture could not be reaped within cleanup deadline')

    def test_only_explicit_gateway_credentials_reach_the_selected_local_provider_environment(self):
        from hormuz.codex_native_session import run_session
        (self.home / 'mode').write_text('gateway_environment')
        definition = {'name': 'Koto', 'base_url': 'http://127.0.0.1:4567/v1', 'wire_api': 'responses',
                      'requires_openai_auth': False, 'env_key': 'KOTO_SESSION_GATEWAY_TOKEN'}
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'UNRELATED_NATIVE_API_SECRET',
                                    'CODEX_API_KEY': 'UNRELATED_NATIVE_API_SECRET',
                                    'CODEX_ACCESS_TOKEN': 'UNRELATED_NATIVE_AUTH_SECRET'}):
            result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
                gateway_environment={'KOTO_SESSION_GATEWAY_TOKEN': 'SYNTHETIC_GATEWAY_ONLY'},
                select=lambda facts: {'provider': 'koto_fixture', 'model': 'local-fixture', 'provider_config': definition})
        self.assertEqual(result['status'], 'completed', result)
        self.assertTrue((self.home / 'gateway-verified').exists())
        requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
        thread = next(item['params'] for item in requests if item['method'] == 'thread/start')
        self.assertIn('KOTO_SESSION_GATEWAY_TOKEN', thread['config']['shell_environment_policy.exclude'])
        self.assertNotIn('SYNTHETIC_GATEWAY_ONLY', json.dumps(result) + (self.home / 'requests.jsonl').read_text())

    def test_unknown_usage_is_not_fabricated_and_cumulative_updates_are_not_summed(self):
        from hormuz.codex_native_session import run_session
        for mode in ('negative_usage', 'boolean_usage', 'repeated_usage'):
            with self.subTest(native_usage=mode):
                (self.home / 'mode').write_text(mode)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
                self.assertEqual(result['status'], 'completed', result)
                if mode == 'repeated_usage':
                    self.assertEqual((result['usage']['total']['inputTokens'], result['usage']['total']['outputTokens']), (10, 3))
                else:
                    self.assertIsNone(result['usage'])

    def test_owned_local_routing_headers_reach_the_native_provider_without_allowing_arbitrary_headers(self):
        from hormuz.codex_native_session import run_session
        headers = {'X-Hormuz-Routing-Mode': 'local_only', 'X-Hormuz-Task-Selection': 'model',
                   'X-Hormuz-Work-ID': 'native-task:fixture-1'}
        provider = {'name': 'Koto', 'base_url': 'http://127.0.0.1:4567/v1', 'wire_api': 'responses',
                    'requires_openai_auth': False, 'http_headers': headers}
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
            select=lambda facts: {'provider': 'koto_fixture', 'model': 'local-fixture', 'provider_config': provider})
        self.assertEqual(result['status'], 'completed', result)
        requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
        thread = next(item['params'] for item in requests if item['method'] == 'thread/start')
        self.assertEqual(thread['config']['model_providers.koto_fixture']['http_headers'], headers)
        for invalid in ({**headers, 'Authorization': 'PRIVATE_TOKEN_SENTINEL'},
                        {**headers, 'X-Hormuz-Routing-Mode': 'cloud_allowed'},
                        {**headers, 'X-Hormuz-Task-Selection': 'automatic'},
                        {**headers, 'X-Hormuz-Work-ID': 'a\r\nPrivate: value'}):
            with self.subTest(invalid_headers=invalid):
                log = self.home / 'requests.jsonl'
                log.unlink()
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
                    select=lambda facts: {'provider': 'koto_fixture', 'model': 'local-fixture',
                                          'provider_config': {**provider, 'http_headers': invalid}})
                self.assertEqual((result['status'], result['error']), ('unknown', 'native_selection_invalid'), result)
                self.assertNotIn('thread/start', [json.loads(line)['method'] for line in log.read_text().splitlines()])
                self.assertNotIn('PRIVATE_TOKEN_SENTINEL', log.read_text() + json.dumps(result))
                self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_missing_configured_model_uses_only_a_proven_unique_native_default_before_selection(self):
        from hormuz.codex_native_session import run_session
        self.config.write_text('model_provider = "openai"\n')
        for mode in ('normal', 'default_missing', 'default_ambiguous', 'default_paginated'):
            with self.subTest(native_default=mode):
                (self.home / 'mode').write_text(mode)
                log = self.home / 'requests.jsonl'
                log.unlink(missing_ok=True)
                selected_facts = []
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
                                     select=lambda facts: selected_facts.append(facts) or {}, timeout_seconds=3)
                requests = [json.loads(line) for line in log.read_text().splitlines()]
                methods = [item['method'] for item in requests]
                self.assertIn('model/list', methods)
                if mode == 'normal':
                    self.assertEqual((result['status'], result['model']), ('completed', 'commercial-default'), result)
                    self.assertEqual(selected_facts[0]['native_model'], 'commercial-default')
                    self.assertLess(methods.index('model/list'), methods.index('thread/start'))
                else:
                    self.assertEqual((result['status'], result['error']), ('unknown', 'native_default_model_unavailable'), result)
                    self.assertEqual(selected_facts, [])
                    self.assertNotIn('thread/start', methods)
                self.assertEqual(self.config.read_text(), 'model_provider = "openai"\n')
                self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_missing_or_empty_native_identifiers_cannot_bind_a_terminal(self):
        from hormuz.codex_native_session import run_session
        from hormuz.contracts import validate_contract
        for mode in ('null_ids', 'empty_ids', 'null_turn'):
            with self.subTest(native_identifiers=mode):
                (self.home / 'mode').write_text(mode)
                log = self.home / 'requests.jsonl'
                log.unlink(missing_ok=True)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
                self.assertEqual(result['status'], 'unknown', result)
                self.assertEqual(result['error'], 'native_turn_invalid' if mode == 'null_turn' else 'native_thread_invalid')
                if mode != 'null_turn':
                    self.assertNotIn('turn/start', [json.loads(line)['method'] for line in log.read_text().splitlines()])
                self.assertTrue(result['cleanup']['owned_processes_stopped'])
                validate_contract({'schema_id': 'koto.native-task', 'schema_version': 1,
                    'status': 'unknown', 'text': result['text'], 'model': None, 'locality': 'cloud',
                    'selection': None, 'history_entry': None,
                    'execution': {'verified': False, 'source': 'native_provider_binding', 'local_attempts': None},
                    'native': result, 'error': result['error']})

    def test_native_final_answer_is_kept_separate_from_progress_commentary(self):
        from hormuz.codex_native_session import run_session
        (self.home / 'mode').write_text('commentary')
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
        self.assertEqual(result['status'], 'completed', result)
        self.assertEqual(result['text'], 'Native final answer.')

    def test_native_model_rerouting_preserves_the_observed_answer_without_claiming_selected_model_success(self):
        from hormuz.codex_native_session import run_session
        for mode in ('rerouted', 'other_turn_rerouted'):
            with self.subTest(native_rerouting=mode):
                (self.home / 'mode').write_text(mode)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
                if mode == 'rerouted':
                    self.assertEqual((result['status'], result['error']), ('unknown', 'native_selection_changed'), result)
                    self.assertEqual(result['model'], 'commercial-fallback')
                    self.assertEqual(result['native_terminal_status'], 'completed')
                    self.assertEqual(result['reroutes'], [{'from_model': 'commercial-fixture', 'to_model': 'commercial-fallback'}])
                else:
                    self.assertEqual((result['status'], result['model']), ('completed', 'commercial-fixture'), result)
                    self.assertEqual(result['reroutes'], [])
                self.assertEqual(result['text'], 'Native final answer.')
                self.assertNotIn('PRIVATE_ROUTING_REASON', json.dumps(result))
                self.assertTrue(result['cleanup']['owned_processes_stopped'])

    def test_native_protocol_failures_remain_unknown_and_stop_the_owned_process_group(self):
        from hormuz.codex_native_session import run_session
        cases = [('missing_terminal', 'native_eof'), ('truncated_terminal', 'native_frame_incomplete'),
                 ('unterminated_frame', 'native_frame_limit'), ('stderr_limit', 'native_output_limit'),
                 ('client_action', 'native_client_action_required'), ('api_account', 'native_chatgpt_account_required')]
        for mode, expected in cases:
            with self.subTest(native_failure=mode):
                (self.home / 'mode').write_text(mode)
                log = self.home / 'requests.jsonl'
                log.unlink(missing_ok=True)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
                self.assertEqual((result['status'], result['error']), ('unknown', expected), result)
                self.assertEqual(result['cleanup'], {'owned_processes_stopped': True, 'scope': 'owned_process_group'})
                requests = [json.loads(line) for line in log.read_text().splitlines()]
                for pid in {item['nativePid'] for item in requests}:
                    with self.assertRaises(ProcessLookupError):
                        os.kill(pid, 0)
                if mode == 'api_account':
                    self.assertNotIn('thread/start', [item['method'] for item in requests])
                if mode in ('missing_terminal', 'truncated_terminal'):
                    self.assertEqual(result['text'], 'Native final answer.')

    def test_only_declared_local_profile_controls_can_override_the_native_thread(self):
        from hormuz.codex_native_session import run_session
        provider = {'name': 'Koto', 'base_url': 'http://127.0.0.1:4567/v1', 'wire_api': 'responses',
                    'requires_openai_auth': False}
        controls = {'model_reasoning_effort': 'none', 'model_reasoning_summary': 'none', 'agents.enabled': False,
                    'features.multi_agent_v2': False, 'features.multi_agent': False}
        original = self.config.read_bytes()
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
            select=lambda facts: {'provider': 'koto_fixture', 'model': 'local-fixture',
                                  'provider_config': provider, 'config': controls})
        self.assertEqual(result['status'], 'completed', result)
        log = self.home / 'requests.jsonl'
        thread = next(json.loads(line)['params'] for line in log.read_text().splitlines()
                      if json.loads(line)['method'] == 'thread/start')
        self.assertEqual({key: thread['config'][key] for key in controls}, controls)
        self.assertEqual(thread['approvalPolicy'], 'never')
        self.assertEqual(self.config.read_bytes(), original)
        for invalid in ({'model_reasoning_effort': 'high'}, {'model_reasoning_summary': 'auto'},
                        {'agents.enabled': True}, {'features.multi_agent_v2': True}, {'features.multi_agent': True},
                        {'features.multi_agent': 0}, {'features.web_search': False}):
            with self.subTest(profile_override=invalid):
                log.unlink()
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
                    select=lambda facts: {'provider': 'koto_fixture', 'model': 'local-fixture',
                                          'provider_config': provider, 'config': invalid})
                self.assertEqual((result['status'], result['error']), ('unknown', 'native_selection_invalid'), result)
                self.assertNotIn('thread/start', [json.loads(line)['method'] for line in log.read_text().splitlines()])
                self.assertTrue(result['cleanup']['owned_processes_stopped'])
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.',
                             select=lambda facts: {'config': controls})
        self.assertEqual((result['status'], result['error']), ('unknown', 'native_selection_invalid'), result)

    def test_malformed_account_summary_is_rejected_before_recording_or_creating_a_native_thread(self):
        from hormuz.codex_native_session import run_session
        from hormuz.contracts import validate_contract
        (self.home / 'mode').write_text('malformed_account')
        result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
        self.assertEqual((result['status'], result['error']), ('unknown', 'native_account_invalid'), result)
        self.assertIsNone(result['account'])
        self.assertTrue(result['cleanup']['owned_processes_stopped'])
        log = self.home / 'requests.jsonl'
        self.assertNotIn('thread/start', [json.loads(line)['method'] for line in log.read_text().splitlines()])
        validate_contract({'schema_id': 'koto.native-task', 'schema_version': 1,
            'status': 'unknown', 'text': result['text'], 'model': None, 'locality': 'cloud',
            'selection': None, 'history_entry': None,
            'execution': {'verified': False, 'source': 'native_provider_binding', 'local_attempts': None},
            'native': result, 'error': result['error']})

    def test_other_malformed_native_summaries_still_return_a_valid_failure_receipt(self):
        from hormuz.codex_native_session import run_session
        from hormuz.contracts import validate_contract
        for mode in ('surrogate_account', 'malformed_native_model', 'malformed_native_provider',
                     'malformed_thread_model', 'malformed_thread_provider', 'nul_thread', 'empty_turn', 'surrogate_answer'):
            with self.subTest(native_summary=mode):
                (self.home / 'mode').write_text(mode)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=3)
                self.assertEqual(result['status'], 'unknown', result)
                self.assertTrue(result['cleanup']['owned_processes_stopped'])
                validate_contract({'schema_id': 'koto.native-task', 'schema_version': 1,
                    'status': 'unknown', 'text': result['text'], 'model': None, 'locality': 'cloud',
                    'selection': None, 'history_entry': None,
                    'execution': {'verified': False, 'source': 'native_provider_binding', 'local_attempts': None},
                    'native': result, 'error': result['error']})

    def test_callback_diagnostics_cannot_enter_a_failure_receipt_as_an_error_code(self):
        from hormuz.codex_native_session import NativeSessionError, run_session
        from hormuz.contracts import validate_contract
        for diagnostic in ('PRIVATE_CALLBACK_DIAGNOSTIC', 'native_private_callback_diagnostic'):
            with self.subTest(callback_diagnostic=diagnostic):
                def select(facts):
                    raise NativeSessionError(diagnostic)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', select=select, timeout_seconds=3)
                self.assertEqual((result['status'], result['error']), ('unknown', 'native_protocol_error'), result)
                self.assertNotIn(diagnostic, json.dumps(result))
                validate_contract({'schema_id': 'koto.native-task', 'schema_version': 1,
                    'status': 'unknown', 'text': result['text'], 'model': None, 'locality': 'cloud',
                    'selection': None, 'history_entry': None,
                    'execution': {'verified': False, 'source': 'native_provider_binding', 'local_attempts': None},
                    'native': result, 'error': result['error']})

    def test_ctrl_c_retains_the_partial_native_observation_and_stops_owned_processes(self):
        from hormuz.contracts import validate_contract
        (self.home / 'mode').write_text('interrupt_after_partial')
        process = subprocess.Popen([sys.executable, '-c', WRAPPER, str(self.executable), str(self.home), str(self.cwd)],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            deadline = time.monotonic() + 5
            while not (self.home / 'partial-ready').exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue((self.home / 'partial-ready').exists(), 'Native partial-output fixture was not ready')
            process.send_signal(signal.SIGINT)
            output, errors = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, errors or output)
            receipt = json.loads(output)
            validate_contract(receipt)
            self.assertEqual((receipt['status'], receipt['error']), ('interrupted', 'native_interrupted'))
            self.assertEqual(receipt['text'], 'Native retained partial answer.')
            self.assertIsNone(receipt['native']['native_terminal_status'])
            self.assertTrue(receipt['native']['cleanup']['owned_processes_stopped'])
            requests = [json.loads(line) for line in (self.home / 'requests.jsonl').read_text().splitlines()]
            for pid in {item['nativePid'] for item in requests}:
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
                try:
                    process.communicate(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=2)
            process.stdout.close()
            process.stderr.close()

    def test_ctrl_c_during_native_cleanup_finishes_cleanup_and_preserves_the_interrupted_receipt(self):
        from hormuz.contracts import validate_contract
        for mode in ('interrupt_during_cleanup', 'interrupt_version_cleanup'):
            with self.subTest(interrupted_cleanup=mode):
                (self.home / 'mode').write_text(mode)
                marker = self.home / 'cleanup-ready'
                marker.unlink(missing_ok=True)
                process = subprocess.Popen([sys.executable, '-c', WRAPPER, str(self.executable), str(self.home), str(self.cwd)],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
                owned_pid = None
                try:
                    deadline = time.monotonic() + 5
                    while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
                        time.sleep(.01)
                    self.assertTrue(marker.exists(), 'Native owned cleanup did not start')
                    owned_pid = int(marker.read_text())
                    process.send_signal(signal.SIGINT)
                    output, errors = process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 0, errors or output)
                    receipt = json.loads(output)
                    validate_contract(receipt)
                    self.assertEqual((receipt['status'], receipt['error']), ('interrupted', 'native_interrupted'))
                    self.assertEqual(receipt['text'], '' if mode == 'interrupt_version_cleanup' else 'Native retained partial answer.')
                    self.assertIsNone(receipt['native']['native_terminal_status'])
                    self.assertTrue(receipt['native']['cleanup']['owned_processes_stopped'])
                    with self.assertRaises(ProcessLookupError):
                        os.kill(owned_pid, 0)
                finally:
                    if process.poll() is None:
                        process.send_signal(signal.SIGINT)
                        try:
                            process.communicate(timeout=12)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.communicate(timeout=2)
                    if owned_pid is not None:
                        try:
                            os.kill(owned_pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    process.stdout.close()
                    process.stderr.close()

    def test_fixed_selection_alias_and_router_failures_keep_their_recovery_codes(self):
        from hormuz.codex_native_session import NativeSessionError, run_session
        from hormuz.contracts import validate_contract
        for code in ('native_model_alias_invalid', 'native_router_deadline'):
            with self.subTest(selection_failure=code):
                def select(facts):
                    raise NativeSessionError(code)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', select=select, timeout_seconds=3)
                self.assertEqual((result['status'], result['error']), ('unknown', code), result)
                self.assertTrue(result['cleanup']['owned_processes_stopped'])
                validate_contract({'schema_id': 'koto.native-task', 'schema_version': 1,
                    'status': 'unknown', 'text': result['text'], 'model': None, 'locality': 'cloud',
                    'selection': None, 'history_entry': None,
                    'execution': {'verified': False, 'source': 'native_provider_binding', 'local_attempts': None},
                    'native': result, 'error': result['error']})

    def test_deadlines_and_failed_native_terminals_retain_partial_text_without_treating_it_as_a_final_answer(self):
        from hormuz.codex_native_session import run_session
        from hormuz.contracts import validate_contract
        cases = [('interrupt_after_partial', 'unknown', 'native_deadline'),
                 ('partial_failed', 'failed', 'native_turn_failed'), ('partial_interrupted', 'interrupted', None),
                 ('partial_completed', 'completed', None)]
        for mode, status, error in cases:
            with self.subTest(native_partial=mode):
                (self.home / 'mode').write_text(mode)
                result = run_session(self.executable, self.home, self.cwd, 'An ordinary user prompt.', timeout_seconds=2)
                self.assertEqual((result['status'], result['error']), (status, error), result)
                self.assertEqual(result['text'], '' if status == 'completed' else 'Native retained partial answer.')
                self.assertTrue(result['cleanup']['owned_processes_stopped'])
                if status != 'completed':
                    validate_contract({'schema_id': 'koto.native-task', 'schema_version': 1,
                        'status': status, 'text': result['text'], 'model': None, 'locality': 'cloud',
                        'selection': None, 'history_entry': None,
                        'execution': {'verified': False, 'source': 'native_provider_binding', 'local_attempts': None},
                        'native': result, 'error': result['error']})
