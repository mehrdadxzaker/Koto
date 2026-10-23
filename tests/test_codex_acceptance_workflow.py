"""Operator journey exercised through its CLI, real router and external executables."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

import hormuz

MACOS_CHECKER = unittest.skipUnless(sys.platform == 'darwin', 'Executable independent checks require the macOS sandbox')

CLIENT = r'''#!PYTHON
import http.client,json,os,pathlib,subprocess,sys,tomllib,uuid
from urllib.parse import urlsplit
if '--version' in sys.argv:
 print('codex-cli 0.160.0');sys.exit(0)
config=tomllib.loads((pathlib.Path(os.environ['CODEX_HOME'])/'config.toml').read_text())
provider=config['model_provider'];settings=config['model_providers'][provider]
overrides={}
for index,arg in enumerate(sys.argv[:-1]):
 if arg=='-c':
  raw=sys.argv[index+1]
  key,_,value=raw.partition('=')
  try: overrides[key]=tomllib.loads('value='+value)['value']
  except ValueError: pass
base=overrides.get('model_providers.'+provider+'.base_url',settings['base_url'])
auth=settings['auth']
token=subprocess.run([auth['command'],*auth['args']],capture_output=True,text=True,check=True,timeout=6).stdout.strip()
tool={'type':'function','name':'exec_command','parameters':{'type':'object','properties':{'cmd':{'type':'string'}},'required':['cmd']},'strict':False}
thread=str(uuid.uuid4());session=str(uuid.uuid4())
headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'codex_exec/0.160.0 (fixture)', 'thread-id':thread,'session-id':session}
headers.update(overrides.get('model_providers.'+provider+'.http_headers',{}))
request={'model':config['model'],'stream':True,'reasoning':{'effort':'none'},'tools':[tool],
 'input':[{'role':'user','content':sys.argv[-1]}],'client_metadata':{'thread_id':thread,'session_id':session}}
arg0=pathlib.Path(os.environ['CODEX_HOME'])/'tmp/arg0'
permissions=overrides.get('permissions.acceptance.filesystem',{})
# Native Codex adds a per-launch readable leaf when this parent is denied.
readable=arg0 if permissions.get(str(arg0))=='read' else arg0/('codex-arg0'+uuid.uuid4().hex)
if 'Unstable context control.' in sys.argv[-1]:
 readable=arg0/('unrelated-context-'+uuid.uuid4().hex)
request['input'].insert(0,{'type':'message','role':'user','id':'msg_'+str(uuid.uuid4()),
 'content':[{'type':'input_text','text':'<environment_context><read>'+str(readable)+'</read></environment_context>'}]})
if 'developer_instructions' in overrides:
 request['input'].insert(0,{'role':'developer','content':overrides['developer_instructions']})
if 'model_instructions_file' in overrides:
 request['instructions']=pathlib.Path(overrides['model_instructions_file']).read_text()
project=pathlib.Path(sys.argv[sys.argv.index('-C')+1])
origin=urlsplit(base)
if 'Malformed observation control.' in sys.argv[-1]:
 print('not a JSON event',flush=True)
for attempt in range(8):
 connection=http.client.HTTPConnection(origin.hostname,origin.port,timeout=12)
 try:
  connection.request('POST',origin.path.rstrip('/')+'/responses',json.dumps(request),headers)
  response=connection.getresponse();body=response.read()
  if response.status!=200:
   print(json.dumps({'type':'turn.failed','error':{'message':'controlled HTTP '+str(response.status)}}),flush=True);sys.exit(2)
  events=[json.loads(line[5:]) for line in body.splitlines() if line.startswith(b'data:')]
  result=next(event['response'] for event in events if event['type']=='response.completed')
 finally: connection.close()
 calls=[item for item in result['output'] if item['type']=='function_call']
 if not calls:
  if 'Nested error control.' in sys.argv[-1]:
   print(json.dumps({'type':'item.completed','item':{'type':'error','message':'Retained external error control'}}),flush=True)
  print(json.dumps({'type':'turn.completed'}),flush=True);sys.exit(0)
 for call in calls:
  command=json.loads(call['arguments'])['cmd']
  completed=subprocess.run(command,shell=True,cwd=project,capture_output=True,text=True,timeout=3)
  if 'Case dev-add-positive.' in sys.argv[-1]:
   (project/'auxiliary.txt').write_text('Retained prior synthetic helper.\n')
   (project/'snapshot.json').write_text('{"synthetic":"model-created filename"}\n')
  if 'Checker tamper control.' in sys.argv[-1]:
   (pathlib.Path(os.environ['CODEX_HOME']).parent.parent/'private/checker.py').write_text('# Retained external checker tamper control.\n')
  print(json.dumps({'type':'item.completed','item':{'type':'command_execution','command':command,'exit_code':completed.returncode,'aggregated_output':completed.stdout}}),flush=True)
  if 'Malformed event control.' in sys.argv[-1]:
   print('not a JSON event',flush=True);sys.exit(3)
  if 'Output cap control.' in sys.argv[-1]:
   print('x'*(3*1024*1024),flush=True);sys.exit(3)
  request['input'] += [call,{'type':'function_call_output','call_id':call['call_id'],'output':completed.stdout}]
sys.exit(2)
'''


ENGINE = r'''#!PYTHON
import http.server,json,os,pathlib,signal,sys,time
args=sys.argv[1:];port=int(args[args.index('--port')+1]);model=args[args.index('--alias')+1]
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  raw=b'{"status":"ok"}';self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def do_POST(self):
  request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  with pathlib.Path(__file__).with_name('calls.jsonl').open('a') as output: output.write(json.dumps(request)+'\n')
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
  if 'Cancellation control.' in json.dumps(request):
   self.wfile.write(b'data: {"type":"response.created","response":{"id":"cancel","status":"in_progress"}}\n\n');self.wfile.flush();time.sleep(8)
  continuation=any(item.get('type')=='function_call_output' for item in request['input'])
  # Keep the supplied external reply independent of the tool's checker.
  command='python3 -c '+__import__('shlex').quote('from pathlib import Path; Path("solution.py").write_text('+repr('def bounded_add(a, b):\n    return a + b\n')+')')
  output=([{'type':'message','role':'assistant','content':[{'type':'output_text','text':'Done.'}]}] if continuation else
   [{'type':'function_call','id':'fc-fixture','call_id':'fixture-call','name':'exec_command','status':'completed','arguments':json.dumps({'cmd':command})}])
  result={'id':'fixture','status':'completed','model':model,'output':output,'usage':{'input_tokens':4,'output_tokens':2,'total_tokens':6}}
  try: self.wfile.write(('data: '+json.dumps({'type':'response.completed','response':result})+'\n\n').encode())
  except OSError: pass
server=http.server.HTTPServer(('127.0.0.1',port),Handler);server.timeout=.1;stopping=False
def stop(*args):
 global stopping
 stopping=True
signal.signal(signal.SIGTERM,stop)
print('I srv  llama_server: listening on http://127.0.0.1:'+str(port),file=sys.stderr,flush=True)
try:
 while not stopping: server.handle_request()
finally: server.server_close()
'''


class CodexAcceptanceWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory(prefix='koto-acceptance-suite-')
        cls.wheel = Path(cls.shared.name) / 'koto_router-2.0.0a4-py3-none-any.whl'
        runtime = Path(hormuz.__file__).resolve().parent
        with zipfile.ZipFile(cls.wheel, 'w') as archive:
            for package in (runtime, runtime.parent / 'koto'):
                for path in package.rglob('*'):
                    if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                        archive.write(path, str(path.relative_to(runtime.parent)))
            info = 'koto_router-2.0.0a4.dist-info/'
            archive.writestr(info + 'METADATA', 'Metadata-Version: 2.1\nName: koto-router\nVersion: 2.0.0a4\n')
            archive.writestr(info + 'WHEEL', 'Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
            archive.writestr(info + 'RECORD', '')

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='koto-acceptance-case-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.codex = self.root / 'codex'
        self.codex.write_text(CLIENT.replace('#!PYTHON', '#!' + sys.executable, 1))
        self.codex.chmod(0o700)
        self.engine = self.root / 'llama-server'
        self.engine.write_text(ENGINE.replace('#!PYTHON', '#!' + sys.executable, 1))
        self.engine.chmod(0o700)
        self.archive = self.root / 'runtime.tar.gz'
        with tarfile.open(self.archive, 'w:gz') as archive:
            archive.add(self.engine, arcname='llama-server')
        self.model = self.root / 'model.gguf'
        self.model.write_bytes(b'GGUF external stand-in; no model inference')
        self.profile = self.root / 'profile.json'
        self.profile.write_text(json.dumps({'schema_id': 'hormuz.local-setup-profile', 'schema_version': 2,
            'qualification_id': 'acceptance-external-v1', 'client_version': '0.160.0',
            'system': platform.system(), 'machine': platform.machine(),
            'runtime_sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest(),
            'model_sha256': hashlib.sha256(self.model.read_bytes()).hexdigest(), 'model': 'acceptance-local',
            'capabilities': ['responses', 'text', 'streaming', 'tools', 'codex_http', 'codex_http_0160'],
            'max_request_bytes': 65536, 'max_output_tokens': 512, 'task_types': ['code_change'],
            'upstream_timeout_seconds': 6, 'startup_timeout_seconds': 6, 'coding_evidence': None}))
        self.live = self.root / 'live-home'
        (self.live / '.codex').mkdir(parents=True)
        self.settings = self.live / '.codex/config.toml'
        self.settings.write_text('# Keep this untouched\nmodel = "personal-provider"\n')
        self.output = self.root / 'evidence'

    def tool(self, operation, *arguments, check=True):
        command = [sys.executable, str(Path(__file__).resolve().parents[1] / 'tools/verify_codex_acceptance.py'), operation]
        if operation == 'prepare':
            command += ['--wheel', str(self.wheel), '--codex', str(self.codex), '--runtime-archive', str(self.archive),
                        '--llama-executable', str(self.engine), '--model-file', str(self.model),
                        '--qualification', str(self.profile), '--output', str(self.output)]
        else:
            command += ['--evidence', str(self.output)]
        result = subprocess.run([*command, *arguments], env={**os.environ, 'HOME': str(self.live),
            'CODEX_HOME': str(self.live / '.codex')}, capture_output=True, text=True, timeout=65)
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_prepare_waits_for_native_exit_after_eof_before_signaling_its_group(self):
        # External client control: both pipes close just before natural exit.
        # A signal during that interval is observable without mocking the operator.
        program = self.codex.read_text().replace('import http.client,json,os,pathlib,subprocess,sys,tomllib,uuid',
            'import http.client,json,os,pathlib,signal,subprocess,sys,time,tomllib,uuid')
        program = program.replace(';sys.exit(2)', '''
   signal.signal(signal.SIGINT,lambda *_:pathlib.Path(__file__).with_name('premature-native-signal').write_text('signal before exit'))
   os.close(1);os.close(2)
   time.sleep(.25)
   sys.exit(2)''', 1)
        self.codex.write_text(program)
        before = self.settings.read_bytes()
        self.tool('prepare')
        self.assertFalse((self.root / 'premature-native-signal').exists(),
                         'EOF does not establish process exit; allow natural exit before group cleanup')
        report = json.loads((self.output / 'prepare-result.json').read_text())
        self.assertTrue(report['passed'] and report['settings_restored'] and report['owned_listeners_closed'])
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertFalse((self.engine.parent / 'calls.jsonl').exists())

    def test_prepare_installs_an_isolated_wheel_and_freezes_without_inference(self):
        before = self.settings.read_bytes()
        self.tool('prepare')
        frozen = json.loads((self.output / 'freeze.json').read_text())
        self.assertEqual((frozen['schema_id'], frozen['model_requests']), ('koto.codex-acceptance-freeze', 0))
        self.assertEqual(frozen['schema_version'], 1)
        self.assertNotIn('native_plugin_discovery_disabled', frozen)
        self.assertEqual(frozen['limits'], {'max_requests': 8, 'max_elapsed_seconds': 90, 'max_output_tokens': 512})
        self.assertTrue((self.output / 'installed/hormuz/server.py').is_file())
        self.assertEqual(set(frozen['scenarios']), {'edit', 'cancel', 'deny'})
        self.assertFalse((self.engine.parent / 'calls.jsonl').exists())
        self.assertEqual(self.settings.read_bytes(), before)
        repeated = self.tool('prepare', check=False)
        self.assertEqual(repeated.returncode, 2)
        self.assertEqual(json.loads((self.output / 'freeze.json').read_text()), frozen)

    def test_prepare_freezes_the_existing_extended_output_profile_without_inference(self):
        profile = json.loads(self.profile.read_text())
        profile.update(schema_version=5, max_output_tokens=2048)
        self.profile.write_text(json.dumps(profile))
        before = self.settings.read_bytes()
        self.tool('prepare', '--disable-plugin-discovery')
        frozen = json.loads((self.output / 'freeze.json').read_text())
        self.assertEqual(frozen['schema_version'], 2)
        self.assertEqual(frozen['limits'], {'max_requests': 8, 'max_elapsed_seconds': 90,
                                           'max_output_tokens': 2048})
        self.assertEqual(frozen['model_requests'], 0)
        self.assertTrue(frozen['native_plugin_discovery_disabled'])
        captures = list((self.output / 'captures').rglob('argv.json'))
        self.assertEqual(len(captures), 4)
        for capture in captures:
            argv = json.loads(capture.read_text())
            self.assertEqual(argv[argv.index('plugins') - 1], '--disable')
        self.assertFalse((self.engine.parent / 'calls.jsonl').exists())
        self.assertEqual(self.settings.read_bytes(), before)

    def test_prepare_rejects_output_bounds_before_creating_an_evidence_root(self):
        profile = json.loads(self.profile.read_text())
        before = self.settings.read_bytes()
        for name, version, limit in [('legacy above limit', 2, 513),
                                     ('extended above limit', 5, 2049),
                                     ('boolean is not an integer limit', 5, True)]:
            with self.subTest(case=name):
                self.profile.write_text(json.dumps({**profile, 'schema_version': version,
                                                    'max_output_tokens': limit}))
                result = self.tool('prepare', check=False)
                self.assertEqual(result.returncode, 2)
                self.assertIn('bounded code_change', result.stdout)
                self.assertFalse(self.output.exists())
                self.assertFalse((self.engine.parent / 'calls.jsonl').exists())
                self.assertEqual(self.settings.read_bytes(), before)

    @MACOS_CHECKER
    def test_extended_output_probe_keeps_checked_completion_and_ordinary_denial_separate(self):
        profile = json.loads(self.profile.read_text())
        profile.update(schema_version=5, max_output_tokens=2048)
        self.profile.write_text(json.dumps(profile))
        before = self.settings.read_bytes()
        self.tool('prepare')
        self.tool('run', '--scenario', 'edit')
        result = json.loads((self.output / 'results/edit/result.json').read_text())
        plan = json.loads((self.output / 'results/edit/probe-plan.json').read_text())
        self.assertTrue(result['passed'], result)
        self.assertEqual(plan['schema_version'], 4)
        self.assertEqual(plan['subject']['runtime_profile'], 'managed-llama.v2')
        self.assertEqual(plan['subject']['max_output_tokens'], 2048)
        self.assertEqual((result['baseline']['exit_code'], result['checker']['exit_code']), (1, 0))
        self.assertTrue(result['checker']['assertions_completed'])
        self.assertTrue(result['implementation_changed'])
        self.assertEqual(result['native']['completed_turns'], 1)
        self.assertEqual(result['automatic_admission_effect'], 'none')
        self.assertTrue(result['settings_restored'] and result['owned_listeners_closed'])
        self.tool('run', '--scenario', 'deny')
        denied = json.loads((self.output / 'results/deny/result.json').read_text())
        self.assertTrue(denied['passed'], denied)
        self.assertEqual(denied['probe_after']['submitted_requests'], 0)
        self.assertEqual(denied['history']['entries'], [])
        self.assertEqual(self.settings.read_bytes(), before)

    def test_prepare_repeats_the_first_capture_with_a_stable_narrow_arg0_read_exception(self):
        self.tool('prepare')
        original = json.loads((self.output / 'captures/edit/request.json').read_text())
        repeated = json.loads((self.output / 'captures/edit-repeat/request.json').read_text())
        arg0 = self.output.resolve() / 'home/.codex/tmp/arg0'
        expected = '<environment_context><read>' + str(arg0) + '</read></environment_context>'
        self.assertEqual(original['input'][1]['content'], [{'type': 'input_text', 'text': expected}])
        self.assertEqual(repeated['input'][1]['content'], original['input'][1]['content'])
        frozen = json.loads((self.output / 'freeze.json').read_text())
        repeatability = frozen['repeatability']
        self.assertTrue(repeatability['passed'])
        self.assertEqual(repeatability['first_input_sha256'], repeatability['repeat_input_sha256'])
        self.assertEqual(repeatability['first_profile_sha256'], repeatability['repeat_profile_sha256'])
        self.assertEqual(repeatability['model_requests'], 0)
        argv = json.loads((self.output / 'captures/edit/argv.json').read_text())
        import tomllib
        filesystem = next(item.partition('=')[2] for item in argv
                          if item.startswith('permissions.acceptance.filesystem='))
        permissions = tomllib.loads('value=' + filesystem)['value']
        self.assertEqual(permissions[str(arg0)], 'read')
        self.assertEqual(permissions[str(self.output.resolve())], 'deny')
        self.assertNotIn(str(arg0.parent), permissions)
        self.assertNotIn(str(arg0.parent.parent), permissions)
        self.assertFalse((self.engine.parent / 'calls.jsonl').exists())

    def test_unstable_native_context_is_retained_and_rejected_before_freeze(self):
        case = self.root / 'case.json'
        case.write_text(json.dumps({'id': 'dev-unstable-context', 'partition': 'development', 'family': 'arithmetic',
            'prompt': 'Fix the Python function bounded_add to add integers. Unstable context control.',
            'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
            'checker': 'import runpy,sys\nassert runpy.run_path(sys.argv[1])["bounded_add"](2,5)==7\n'}))
        rejected = self.tool('prepare', '--case', str(case), check=False)
        self.assertEqual(rejected.returncode, 2)
        self.assertIn('not repeatable', rejected.stdout)
        self.assertFalse((self.output / 'freeze.json').exists())
        report = json.loads((self.output / 'prepare-result.json').read_text())
        self.assertFalse(report['passed'])
        self.assertFalse(report['repeatability']['passed'])
        self.assertNotEqual(report['repeatability']['first_input_sha256'], report['repeatability']['repeat_input_sha256'])
        self.assertEqual(report['repeatability']['first_profile_sha256'], report['repeatability']['repeat_profile_sha256'])
        self.assertTrue((self.output / 'captures/edit/request.json').is_file())
        self.assertTrue((self.output / 'captures/edit-repeat/request.json').is_file())
        self.assertFalse((self.output / 'captures/cancel').exists())
        self.assertTrue(report['settings_restored'] and report['owned_listeners_closed'])
        self.assertFalse((self.engine.parent / 'calls.jsonl').exists())

    @MACOS_CHECKER
    def test_edit_journey_retains_checked_outcome_affinity_history_and_cleanup(self):
        before = self.settings.read_bytes()
        self.tool('prepare')
        self.tool('run', '--scenario', 'edit')
        result = json.loads((self.output / 'results/edit/result.json').read_text())
        self.assertTrue(result['passed'], result)
        self.assertEqual((result['baseline']['exit_code'], result['checker']['exit_code']), (1, 0))
        self.assertTrue(result['checker']['assertions_completed'])
        self.assertTrue(result['implementation_changed'])
        self.assertEqual(result['native']['completed_turns'], 1)
        self.assertEqual(result['affinity']['preserved_continuations'], 1)
        self.assertEqual([entry['outcome'] for entry in result['history']['entries']], ['succeeded', 'succeeded'])
        self.assertEqual(result['automatic_admission_effect'], 'none')
        self.assertTrue(result['settings_restored'] and result['owned_listeners_closed'])
        self.assertEqual(self.settings.read_bytes(), before)
        attempted = self.tool('run', '--scenario', 'edit', check=False)
        self.assertEqual(attempted.returncode, 2)
        self.assertEqual(json.loads((self.output / 'results/edit/result.json').read_text()), result)

    @MACOS_CHECKER
    def test_ordinary_local_coding_is_denied_without_inference_or_a_settings_change(self):
        before = self.settings.read_bytes()
        self.tool('prepare')
        self.tool('run', '--scenario', 'deny')
        result = json.loads((self.output / 'results/deny/result.json').read_text())
        self.assertTrue(result['passed'], result)
        self.assertEqual(result['denial']['status'], 503)
        self.assertEqual(result['denial']['code'], 'hormuz_route_local_route_unavailable')
        self.assertEqual(result['probe_after']['submitted_requests'], 0)
        self.assertEqual(result['history']['entries'], [])
        self.assertFalse((self.engine.parent / 'calls.jsonl').exists())
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertTrue(result['settings_restored'] and result['owned_listeners_closed'])

    @MACOS_CHECKER
    def test_cancellation_retains_unknown_outcome_and_stops_only_owned_processes(self):
        before = self.settings.read_bytes()
        self.tool('prepare')
        self.tool('run', '--scenario', 'cancel')
        result = json.loads((self.output / 'results/cancel/result.json').read_text())
        self.assertTrue(result['passed'], result)
        self.assertEqual(result['native']['termination'], 'canceled')
        self.assertEqual(result['native']['completed_turns'], 0)
        self.assertEqual([entry['outcome'] for entry in result['history']['entries']], ['outcome_unknown'])
        self.assertEqual(result['automatic_admission_effect'], 'none')
        self.assertTrue(result['settings_restored'] and result['owned_listeners_closed'])
        self.assertEqual(self.settings.read_bytes(), before)

    @MACOS_CHECKER
    def test_malformed_native_observations_cannot_pass_denial_or_cancellation(self):
        before = self.settings.read_bytes()
        case = self.root / 'case.json'
        case.write_text(json.dumps({'id': 'dev-malformed-observation', 'partition': 'development', 'family': 'arithmetic',
            'prompt': 'Fix the Python function bounded_add to add integers. Malformed observation control.',
            'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
            'checker': 'import runpy,sys\nassert runpy.run_path(sys.argv[1])["bounded_add"](2,5)==7\n'}))
        self.tool('prepare', '--case', str(case))
        for scenario in ('deny', 'cancel'):
            with self.subTest(scenario=scenario):
                completed = self.tool('run', '--scenario', scenario, check=False)
                output = self.output / 'results' / scenario
                result = json.loads((output / 'result.json').read_text())
                self.assertEqual(result['error'], 'native_event_invalid')
                self.assertIn('not a JSON event', (output / 'native.jsonl').read_text())
                self.assertEqual((result['native']['completed_turns'], result['native']['completed_tools']), (0, 0))
                self.assertFalse(result['implementation_changed'])
                self.assertTrue(result['settings_restored'] and result['live_settings_preserved']
                                and result['owned_listeners_closed'])
                self.assertEqual(self.settings.read_bytes(), before)
                if scenario == 'deny':
                    self.assertEqual(result['denial'], {'status': 503, 'code': 'hormuz_route_local_route_unavailable'})
                    self.assertEqual(result['probe_after']['submitted_requests'], 0)
                    self.assertEqual(result['history']['entries'], [])
                    self.assertFalse((self.engine.parent / 'calls.jsonl').exists())
                else:
                    self.assertEqual(result['native']['termination'], 'canceled')
                    self.assertEqual(result['probe_after']['submitted_requests'], 1)
                    self.assertEqual([entry['outcome'] for entry in result['history']['entries']], ['outcome_unknown'])
                self.assertEqual(completed.returncode, 2, completed.stdout + completed.stderr)
                self.assertFalse(result['passed'], result)

    @MACOS_CHECKER
    def test_authored_case_and_shared_guidance_are_frozen_without_exposing_the_checker(self):
        case = self.root / 'case.json'
        case.write_text(json.dumps({'id': 'dev-authored-add', 'partition': 'development', 'family': 'arithmetic',
            'prompt': 'Fix the Python function bounded_add in solution.py so it adds its integer inputs.',
            'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
            'checker': 'import runpy,sys\nfunction=runpy.run_path(sys.argv[1])["bounded_add"]\nassert function(7,9)==16\n',
            'reference_solution': '# PRIVATE_REFERENCE_SENTINEL\ndef bounded_add(a,b): return a+b\n'}))
        instructions = self.root / 'instructions.txt'
        instructions.write_text('Honor exact types and alphabets, edit once, check once, then finish.')
        client_instructions = self.root / 'client-instructions.txt'
        client_instructions.write_text('Use the bounded native function tool workflow.')
        self.tool('prepare', '--case', str(case), '--instructions', str(instructions),
                  '--client-instructions', str(client_instructions))
        self.tool('run', '--scenario', 'edit')
        result = json.loads((self.output / 'results/edit/result.json').read_text())
        self.assertEqual(result['case']['id'], 'dev-authored-add')
        self.assertTrue(result['checker']['assertions_completed'])
        request = json.loads((self.output / 'captures/edit/request.json').read_text())
        self.assertEqual(request['input'][0], {'role': 'developer', 'content': instructions.read_text()})
        self.assertEqual(request['instructions'], client_instructions.read_text())
        self.assertNotIn('PRIVATE_REFERENCE_SENTINEL', json.dumps(request))
        self.assertNotIn('assert function(7,9)', json.dumps(request))

    @MACOS_CHECKER
    def test_failed_native_completion_preserves_the_actual_edit_and_independent_check(self):
        case = self.root / 'case.json'
        case.write_text(json.dumps({'id': 'dev-malformed-event', 'partition': 'development', 'family': 'arithmetic',
            'prompt': 'Fix the Python function bounded_add in solution.py to add integers. Malformed event control.',
            'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
            'checker': 'import runpy,sys\nassert runpy.run_path(sys.argv[1])["bounded_add"](2,5)==7\n'}))
        self.tool('prepare', '--case', str(case))
        failed = self.tool('run', '--scenario', 'edit', check=False)
        self.assertEqual(failed.returncode, 2)
        result = json.loads((self.output / 'results/edit/result.json').read_text())
        self.assertFalse(result['passed'])
        self.assertEqual(result['error'], 'native_event_invalid')
        self.assertTrue(result['implementation_changed'])
        self.assertEqual(result['checker']['exit_code'], 0)
        self.assertTrue((self.output / 'results/edit/implementation.patch').read_text())
        self.assertEqual(result['history']['total'], 1)
        self.assertTrue(result['settings_restored'] and result['owned_listeners_closed'])
        repeated = self.tool('run', '--scenario', 'edit', check=False)
        self.assertEqual(repeated.returncode, 2)
        self.assertEqual(json.loads((self.output / 'results/edit/result.json').read_text()), result)

    @MACOS_CHECKER
    def test_campaign_cases_share_one_frozen_client_profile_and_are_consumed_separately(self):
        cases = []
        for case_id, assertion in (('dev-add-positive', 'function(2,5)==7'), ('held-add-negative', 'function(-4,9)==5')):
            path = self.root / (case_id + '.json')
            path.write_text(json.dumps({'id': case_id, 'partition': 'development' if case_id.startswith('dev') else 'held_out',
                'family': 'arithmetic', 'prompt': 'Fix the Python function bounded_add to add integers. Case ' + case_id + '.',
                'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
                'checker': 'import runpy,sys\nfunction=runpy.run_path(sys.argv[1])["bounded_add"]\nassert ' + assertion + '\n'}))
            cases += ['--case', str(path)]
        self.tool('prepare', *cases)
        frozen_bytes = (self.output / 'freeze.json').read_bytes()
        frozen = json.loads(frozen_bytes)
        self.assertEqual(set(frozen['cases']), {'dev-add-positive', 'held-add-negative'})
        profiles = {case['scenarios']['edit']['profile_sha256'] for case in frozen['cases'].values()}
        self.assertEqual(len(profiles), 1)
        for case_id in frozen['cases']:
            self.tool('run', '--scenario', 'edit', '--case-id', case_id)
            result = json.loads((self.output / 'results' / case_id / 'edit/result.json').read_text())
            self.assertTrue(result['passed'], result)
            self.assertEqual(result['case']['id'], case_id)
        self.assertEqual((self.output / 'results/dev-add-positive/edit/project/auxiliary.txt').read_text(),
                         'Retained prior synthetic helper.\n')
        self.assertEqual((self.output / 'results/dev-add-positive/edit/project/snapshot.json').read_text(),
                         '{"synthetic":"model-created filename"}\n')
        self.assertFalse((self.output / 'project/auxiliary.txt').exists())
        self.assertEqual((self.output / 'freeze.json').read_bytes(), frozen_bytes)
        repeated = self.tool('run', '--scenario', 'edit', '--case-id', 'dev-add-positive', check=False)
        self.assertEqual(repeated.returncode, 2)

    @MACOS_CHECKER
    def test_native_output_is_capped_and_the_failed_edit_is_retained(self):
        case = self.root / 'case.json'
        case.write_text(json.dumps({'id': 'dev-output-cap', 'partition': 'development', 'family': 'arithmetic',
            'prompt': 'Fix the Python function bounded_add to add integers. Output cap control.',
            'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
            'checker': 'import runpy,sys\nassert runpy.run_path(sys.argv[1])["bounded_add"](2,5)==7\n'}))
        self.tool('prepare', '--case', str(case))
        failed = self.tool('run', '--scenario', 'edit', check=False)
        self.assertEqual(failed.returncode, 2)
        result = json.loads((self.output / 'results/edit/result.json').read_text())
        self.assertEqual(result['native']['termination'], 'native_output_limit')
        self.assertLessEqual((self.output / 'results/edit/native.jsonl').stat().st_size, 2 * 1024 * 1024)
        self.assertTrue(result['implementation_changed'])
        self.assertEqual(result['checker']['exit_code'], 0)
        self.assertTrue(result['settings_restored'] and result['owned_listeners_closed'])

    @MACOS_CHECKER
    def test_nested_native_error_cannot_qualify_a_checked_edit(self):
        case = self.root / 'case.json'
        case.write_text(json.dumps({'id': 'dev-nested-error', 'partition': 'development', 'family': 'arithmetic',
            'prompt': 'Fix the Python function bounded_add to add integers. Nested error control.',
            'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
            'checker': 'import runpy,sys\nassert runpy.run_path(sys.argv[1])["bounded_add"](2,5)==7\n'}))
        self.tool('prepare', '--case', str(case))
        failed = self.tool('run', '--scenario', 'edit', check=False)
        self.assertEqual(failed.returncode, 2)
        result = json.loads((self.output / 'results/edit/result.json').read_text())
        self.assertFalse(result['passed'])
        self.assertEqual(result['native']['failed_turns'], 1)
        self.assertEqual(result['checker']['exit_code'], 0)

    def test_an_added_installed_module_blocks_before_consuming_a_case_or_running_a_model(self):
        self.tool('prepare')
        (self.output / 'installed/extra-unfrozen.py').write_text('# Extra executable surface after freeze.\n')
        denied = self.tool('run', '--scenario', 'edit', check=False)
        self.assertEqual(denied.returncode, 2)
        self.assertIn('Frozen artifact inventory changed', denied.stdout)
        self.assertFalse((self.output / 'results/edit/started.json').exists())
        self.assertFalse((self.engine.parent / 'calls.jsonl').exists())

    @MACOS_CHECKER
    def test_changed_independent_assertions_cannot_turn_a_completed_edit_into_a_pass(self):
        case = self.root / 'case.json'
        case.write_text(json.dumps({'id': 'dev-checker-tamper', 'partition': 'development', 'family': 'arithmetic',
            'prompt': 'Fix the Python function bounded_add to add integers. Checker tamper control.',
            'initial_solution': 'def bounded_add(a, b):\n    return a - b\n',
            'checker': 'import runpy,sys\nassert runpy.run_path(sys.argv[1])["bounded_add"](2,5)==7\n'}))
        self.tool('prepare', '--case', str(case))
        failed = self.tool('run', '--scenario', 'edit', check=False)
        self.assertEqual(failed.returncode, 2)
        result = json.loads((self.output / 'results/edit/result.json').read_text())
        self.assertFalse(result['passed'])
        self.assertFalse(result['checks_unchanged'])
        self.assertTrue(result['implementation_changed'])
        self.assertTrue(result['settings_restored'] and result['owned_listeners_closed'])
