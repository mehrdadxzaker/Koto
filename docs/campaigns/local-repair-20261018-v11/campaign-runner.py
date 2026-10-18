"""Frozen native repair campaign; one canary, then one episode per remaining case.

No model-quality retries or automatic admission. Checkers and references remain
outside the native sandbox. The trace tap saves bodies, never request headers.
"""
import argparse
import copy
import difflib
import gzip
import hashlib
import http.client
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import stat
import subprocess
import secrets
import tempfile
import threading
import time

DIRECTORY = Path(__file__).resolve().parent
SOURCE = DIRECTORY.parents[2]
PRIVATE = Path('/private/tmp/koto-devstral-v11-preparation-20261018')
ASSETS = Path('/private/tmp/koto-devstral-preparation-20261018')
ROOT = Path('/private/tmp/koto-native-v11-20261018')
PYTHON = Path('/Users/mehrdadz/Downloads/memoWiki/hormuz/.venv/bin/python')
CAMPAIGN = 'local-repair-20261018-v11'
ALIAS = 'Devstral-Small-2-24B-Instruct-2512-Q4_K_M-codex-roles-v1'
BYTE_LIMIT = 2 * 1024 * 1024
spec = importlib.util.spec_from_file_location('retained_v7_support',
    SOURCE / 'docs/campaigns/local-repair-20261017-v7/development-runner.py')
retained = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retained)
retained.ROOT = ROOT
retained.PYTHON = PYTHON
date_spec = importlib.util.spec_from_file_location('native_date_binding',
    SOURCE / 'docs/diagnostics/native-tool-compat-20261017/native-date-binding.py')
date_binding = importlib.util.module_from_spec(date_spec)
date_spec.loader.exec_module(date_binding)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    data = path.read_bytes()
    if len(data) > BYTE_LIMIT:
        raise RuntimeError('JSON input exceeds its bound')
    return json.loads(data)


def write(path, value, *, exclusive=False):
    with path.open('x' if exclusive else 'w') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write('\n')
    path.chmod(0o600)


def file_hash(path):
    digest = hashlib.sha256()
    deadline = time.monotonic() + 120
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            if time.monotonic() > deadline:
                raise RuntimeError('File checksum deadline exceeded')
            digest.update(chunk)
    return digest.hexdigest()


def checker(case):
    oracle = PRIVATE / 'checkers' / (case['case_id'] + '.py')
    if file_hash(oracle) != case['checks_sha256']:
        raise RuntimeError('Independent checker changed')
    completion = secrets.token_hex(24)
    code = ('import runpy,sys\noracle=sys.argv.pop(1)\nsys.argv[0]=oracle\ntry:\n'
            ' runpy.run_path(oracle,run_name="__main__")\nexcept AssertionError:\n sys.exit(1)\n'
            'except BaseException:\n sys.exit(2)\nprint(' + repr(completion) + ',flush=True)\n')
    with tempfile.TemporaryFile(dir=ROOT / 'tmp') as output:
        process = subprocess.Popen(['/usr/bin/sandbox-exec', '-p',
            '(version 1)(allow default)(deny network*)(deny file-write*)', str(PYTHON),
            '-I', '-B', '-c', code, str(oracle), str(ROOT / 'project/solution.py')],
            cwd=ROOT / 'tmp', env={'PATH': '/usr/bin:/bin', 'HOME': str(ROOT / 'tmp')},
            stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + 2
        bounded = True
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline or os.fstat(output.fileno()).st_size > 8192:
                    bounded = False
                    break
                try:
                    process.wait(timeout=0.05)
                except subprocess.TimeoutExpired:
                    pass
        finally:
            retained.stop(process)
        output.seek(0)
        observed = output.read(8193)
        receipt = {'process_exit_code': process.returncode,
                   'assertions_completed': observed == (completion + '\n').encode(),
                   'output_bytes': os.fstat(output.fileno()).st_size, 'within_budget': bounded}
        if not bounded or len(observed) > 8192:
            return {**receipt, 'exit_code': None}
        # Exit zero alone can be produced by os._exit before any assertion.
        # A fresh completion receipt is emitted only after the oracle returns.
        if process.returncode == 0:
            return {**receipt, 'exit_code': 0 if receipt['assertions_completed'] else 2}
        return {**receipt, 'exit_code': 1 if process.returncode == 1 else 2}


def prepare_case(case):
    project = ROOT / 'project'
    info = project.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError('Only the owned project can be reset')
    # The previous episode is retained before this exclusively owned workspace
    # is reset. No user checkout or asset path is a cleanup target.
    for path in project.iterdir():
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    (project / 'solution.py').write_text(case['files']['solution.py'])
    (ROOT / 'prompt.txt').write_text(case['goal'])


def permission_overrides():
    # Use the client's own sandbox once: macOS rejects nested seatbelt sandboxes.
    # Exact deny rules keep the independent checker and held-out inventory out of
    # tool execution while allowing writes only in the disposable project/temp.
    filesystem = {':root': 'read', '/private/tmp': 'deny', str(ROOT): 'read',
                  str(ROOT / 'project'): 'write', str(ROOT / 'tmp'): 'write',
                  str(PRIVATE): 'deny', str(SOURCE): 'deny',
                  '/Users/mehrdadz/Downloads/memoWiki': 'deny',
                  '/Users/mehrdadz/.codex': 'deny'}
    table = '{' + ','.join(json.dumps(key) + '=' + json.dumps(value)
                          for key, value in filesystem.items()) + '}'
    return ['-c', 'default_permissions="bounded-repair"',
            '-c', 'permissions.bounded-repair.filesystem=' + table,
            '-c', 'permissions.bounded-repair.network.enabled=false',
            '-c', 'shell_environment_policy.set={TMPDIR=' + json.dumps(str(ROOT / 'tmp'))
                  + ',TMPPREFIX=' + json.dumps(str(ROOT / 'tmp/zsh')) + '}']


def launch(experiment, label, *, base_url=None, probe=None, timeout=90):
    args = [experiment.pins['client']['path'],
            'exec', '--skip-git-repo-check', '--ephemeral', '--json',
            '-c', 'approval_policy="never"', '-c', 'agents.enabled=false', '--disable', 'multi_agent_v2',
            *permission_overrides(),
            '-c', 'model_instructions_file=' + json.dumps(str(ROOT / 'client-instructions.txt')),
            '-c', 'model_reasoning_summary="none"', '-c', 'model_reasoning_effort="none"',
            '-c', 'developer_instructions=' + json.dumps((ROOT / 'developer-instructions.txt').read_text()),
            '-c', 'analytics.enabled=false', '-C', str(ROOT / 'project')]
    if base_url:
        args += ['-c', 'model_providers.' + experiment.provider_id + '.base_url=' + json.dumps(base_url)]
    if probe:
        args += ['-c', 'model_providers.' + experiment.provider_id + '.http_headers={"X-Hormuz-Qualification-Probe"=' + json.dumps(probe) + '}']
    args.append((ROOT / 'prompt.txt').read_text())
    write(ROOT / (label + '-argv.json'), [x.replace(probe, '<RUN_MARKER>') if probe else x for x in args])
    started = time.monotonic()
    termination = 'completed'
    stdout_path, stderr_path = ROOT / (label + '.jsonl'), ROOT / (label + '.stderr')
    with stdout_path.open('x') as stdout, stderr_path.open('x') as stderr:
        process = subprocess.Popen(args, env=experiment.env, cwd=ROOT / 'project', stdin=subprocess.DEVNULL,
                                   stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            while process.poll() is None:
                if time.monotonic() - started >= timeout:
                    termination = 'timeout'
                    break
                if stdout_path.stat().st_size > BYTE_LIMIT or stderr_path.stat().st_size > BYTE_LIMIT:
                    termination = 'output_bound'
                    break
                try:
                    process.wait(timeout=0.25)
                except subprocess.TimeoutExpired:
                    pass
        finally:
            retained.stop(process)
    return {'exit_code': process.returncode, 'termination': termination,
            'elapsed_ms': int((time.monotonic() - started) * 1000)}


class TraceTap:
    """One bounded local relay retaining request/response bodies without headers."""
    def __init__(self, router_port, destination):
        self.records = []
        self.destination = destination
        self.backend = http.client.HTTPConnection('127.0.0.1', router_port, timeout=90)
        self.active_socket = None
        owner = self
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            timeout = 5
            def log_message(self, *_):
                pass
            def handle(self):
                try:
                    super().handle()
                except ConnectionResetError:
                    # An idle native keep-alive peer can close after a complete
                    # response. Active forwarding failures are recorded below.
                    self.close_connection = True
            def do_POST(self):
                if self.path != '/v1/responses' or len(owner.records) >= 8:
                    self.send_error(400)
                    return
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 65536:
                    self.send_error(413)
                    return
                body = self.rfile.read(size)
                record = {'request': json.loads(body), 'request_sha256': sha(body),
                          'native_user_agent': self.headers.get('User-Agent')}
                owner.records.append(record)
                # Forward authentication only in memory. No header map is saved.
                headers = {k: v for k, v in self.headers.items()
                           if k.lower() not in {'host', 'connection', 'transfer-encoding', 'content-length'}}
                raw = bytearray()
                response = None
                try:
                    owner.backend.request('POST', self.path, body=body, headers=headers)
                    owner.active_socket = owner.backend.sock
                    response = owner.backend.getresponse()
                    record['status'] = response.status
                    record['routing_reason'] = response.getheader('X-Hormuz-Routing-Reason')
                    record['work_id'] = response.getheader('X-Hormuz-Work-ID')
                    record['destination_generation'] = response.getheader('X-Hormuz-Destination-Generation')
                    self.send_response(response.status)
                    self.send_header('Content-Type', response.getheader('Content-Type', 'application/json'))
                    self.send_header('Transfer-Encoding', 'chunked')
                    self.end_headers()
                    while True:
                        chunk = response.read1(8192)
                        if not chunk:
                            break
                        if len(raw) + len(chunk) > BYTE_LIMIT:
                            raise RuntimeError('Response trace exceeds two MiB')
                        raw.extend(chunk)
                        self.wfile.write(('%x\r\n' % len(chunk)).encode() + chunk + b'\r\n')
                        self.wfile.flush()
                    self.wfile.write(b'0\r\n\r\n')
                    self.wfile.flush()
                except (OSError, ValueError, http.client.HTTPException, RuntimeError) as error:
                    record['trace_error_type'] = type(error).__name__
                    self.close_connection = True
                finally:
                    if response:
                        response.close()
                    record['response_bytes'] = len(raw)
                    record['response_sha256'] = sha(raw)
                    events = []
                    for line in raw.splitlines():
                        if line.startswith(b'data:') and line[5:].strip() != b'[DONE]':
                            try:
                                events.append(json.loads(line[5:]))
                            except ValueError:
                                record['unparseable_event'] = True
                    record['events'] = events
                    with (owner.destination / ('response-%02d.sse.gz' % len(owner.records))).open('xb') as stream:
                        stream.write(gzip.compress(bytes(raw), mtime=0))
        self.server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={'poll_interval': 0.05}, daemon=False)

    def __enter__(self):
        self.destination.mkdir(mode=0o700, parents=True, exist_ok=False)
        self.thread.start()
        return self

    @property
    def url(self):
        return 'http://127.0.0.1:' + str(self.server.server_port) + '/v1'

    def __exit__(self, *_):
        if self.active_socket is not None:
            try:
                self.active_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.backend.close()
        if self.thread.is_alive():
            raise RuntimeError('Owned trace thread did not exit')
        write(self.destination / 'wire.json', self.records, exclusive=True)


def initialize():
    ROOT.mkdir(mode=0o700, exist_ok=False)
    for part in ('home', 'home/.codex', 'tmp', 'project', 'installed', 'episodes'):
        (ROOT / part).mkdir(mode=0o700)
    for name in ('home/.codex/config.toml', 'original-config.toml'):
        (ROOT / name).write_text('personality = "none"\n')
        (ROOT / name).chmod(0o600)
    pins = read(SOURCE / 'docs/campaigns/local-repair-20261017-v7/pins.json')
    model = read(PRIVATE / 'effective-artifact.json')
    pins['model'] = {'path': model['path'],
                     'bytes': model['bytes'], 'sha256': model['sha256']}
    write(ROOT / 'pins.json', pins, exclusive=True)
    profile = read(SOURCE / 'docs/campaigns/local-repair-20261017-v7/setup-profile.json')
    profile.update(qualification_id='codex0160-m5-32g-devstral24b-v11-probe', model=ALIAS,
                   model_sha256=model['sha256'])
    write(ROOT / 'setup-profile.json', profile, exclusive=True)
    for name in ('client-instructions.txt', 'developer-instructions.txt'):
        shutil.copy2(DIRECTORY / name, ROOT / name)
    for source in (SOURCE / 'hormuz').rglob('*'):
        relative = source.relative_to(SOURCE)
        if '__pycache__' in relative.parts or source.suffix == '.pyc':
            continue
        target = ROOT / 'installed' / relative
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif source.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    prepare_case(read(DIRECTORY / 'corpus.json')['entries'][0])
    for name in ('pins.json', 'setup-profile.json', 'developer-instructions.txt'):
        shutil.copy2(ROOT / name, DIRECTORY / name)


def capture(*, inspect_engine=True):
    if (ROOT / 'preflight.json').exists():
        raise RuntimeError('Preserve an existing preflight')
    experiment = retained.Experiment()
    report = {'stage': 'zero-inference-native-capture', 'model_completion_requests': 0}
    captured = []
    class Capture(http.server.BaseHTTPRequestHandler):
        timeout = 5
        def log_message(self, *_): pass
        def do_POST(self):
            size = int(self.headers.get('Content-Length', '0'))
            if captured or self.path != '/v1/responses' or not 0 < size <= 65536:
                self.send_error(400)
                return
            value = json.loads(self.rfile.read(size))
            captured.append(value)
            write(ROOT / 'captured-request.json', value)
            write(ROOT / 'request-profile.json', retained.request_profile(value))
            write(ROOT / 'first-input.json', value['input'])
            raw = b'{"error":{"message":"Intentional zero-inference preflight"}}'
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
    server = thread = engine = None
    try:
        report['setup'] = experiment.connect()
        if inspect_engine:
            engine = http.client.HTTPConnection('127.0.0.1', experiment.ports[1], timeout=5)
        report['metadata_requests'] = []
        def metadata(method, path, value=None):
            if len(report['metadata_requests']) >= 3 or (method, path) not in {
                    ('GET', '/props'), ('POST', '/v1/responses/input_tokens'), ('POST', '/apply-template')}:
                raise RuntimeError('Only three zero-inference metadata requests are allowed')
            body = None if value is None else canonical(value)
            engine.request(method, path, body=body,
                           headers={} if body is None else {'Content-Type': 'application/json'})
            response = engine.getresponse()
            raw = response.read(BYTE_LIMIT + 1)
            report['metadata_requests'].append({'method': method, 'path': path, 'status': response.status})
            if response.status != 200 or len(raw) > BYTE_LIMIT:
                write(ROOT / 'preflight-metadata-error.json', {'method': method, 'path': path,
                    'status': response.status, 'response_excerpt': raw[:8192].decode('utf-8', errors='replace')}, exclusive=True)
                raise RuntimeError('Zero-inference metadata request failed: ' + path + ' HTTP ' + str(response.status))
            return json.loads(raw)
        if inspect_engine:
            properties = metadata('GET', '/props')
            write(ROOT / 'engine-properties.json', {k: properties[k] for k in (
                'default_generation_settings', 'total_slots', 'model_alias', 'model_ftype',
                'chat_template', 'chat_template_caps', 'build_info')})
            applied = read(PRIVATE / 'expected-engine-template.json')
            if sha(properties['chat_template'].encode()) != applied['applied_template_sha256']:
                raise RuntimeError('Engine did not load the exact expected applied template')
        server = http.server.HTTPServer(('127.0.0.1', 0), Capture)
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=False)
        thread.start()
        report['native'] = launch(experiment, 'preflight-native',
            base_url='http://127.0.0.1:' + str(server.server_port) + '/v1', timeout=25)
        report['captured_requests'] = len(captured)
        report['work_state'] = experiment.public('work/state')
        if len(captured) != 1 or report['work_state']['totals']['attempts'] != 0:
            raise RuntimeError('Preflight must not forward a model request')
        request = captured[0]
        if inspect_engine:
            report['input_tokens'] = metadata('POST', '/v1/responses/input_tokens', request)
        chat = {'messages': [{'role': 'system', 'content': request['instructions']}] + [
            {'role': item['role'], 'content': '\n'.join(part['text'] for part in item['content']
                                                       if part['type'] == 'input_text')}
            for item in request['input']], 'tools': [
            {'type': 'function', 'function': {k: v for k, v in tool.items() if k != 'type'}}
            for tool in request['tools']], 'add_generation_prompt': True,
            'tool_choice': 'auto', 'parallel_tool_calls': True}
        if inspect_engine:
            rendered = metadata('POST', '/apply-template', chat)
            prompt = rendered['prompt']
            report['rendered_tool_names'] = [tool['name'] for tool in request['tools'] if tool['name'] in prompt]
            report['developer_guidance_rendered'] = request['input'][0]['content'][0]['text'] in prompt
            native_texts = [request['instructions']] + [part['text']
                for item in request['input'] for part in item.get('content', []) if part.get('type') == 'input_text']
            positions = [prompt.find(value) for value in native_texts]
            report['native_text_blocks_preserved_in_order'] = all(position >= 0 for position in positions) and positions == sorted(positions)
            report['native_text_block_count'] = len(native_texts)
            report['rendered_prompt_sha256'] = sha(prompt.encode())
            if (len(report['rendered_tool_names']) != len(request['tools']) or not report['developer_guidance_rendered']
                    or not report['native_text_blocks_preserved_in_order']):
                raise RuntimeError('Actual engine template omitted native tools or developer guidance')
    finally:
        if engine:
            engine.close()
        if server:
            server.shutdown(); server.server_close()
        if thread:
            thread.join(timeout=2)
        experiment.close(report)
        write(ROOT / 'preflight.json', report)
        for name in ('preflight.json', 'preflight-native.jsonl', 'preflight-native.stderr',
                     'preflight-native-argv.json', 'captured-request.json', 'request-profile.json',
                     'first-input.json', 'engine-properties.json'):
            if (ROOT / name).exists():
                shutil.copy2(ROOT / name, DIRECTORY / name)
        if (ROOT / 'preflight-metadata-error.json').exists():
            shutil.copy2(ROOT / 'preflight-metadata-error.json', DIRECTORY / 'preflight-metadata-error.json')
    if not report.get('settings_restored') or not report.get('owned_listeners_closed'):
        raise RuntimeError('Preflight cleanup failed')
    print(json.dumps({'stage': report['stage'], 'captured': len(captured), 'model_completion_requests': 0}))


def subject():
    profile, pins = read(ROOT / 'setup-profile.json'), read(ROOT / 'pins.json')
    return {'client_version': profile['client_version'], 'system': profile['system'], 'machine': profile['machine'],
            'runtime_profile': 'managed-llama.v1', 'runtime_sha256': pins['runtime_archive']['sha256'],
            'model_revision': 'sha256:' + pins['model']['sha256'], 'upstream_model': ALIAS, 'protocol': 'openai',
            'capabilities': profile['capabilities'], 'max_request_bytes': profile['max_request_bytes'],
            'max_output_tokens': profile['max_output_tokens'], 'upstream_timeout_seconds': profile['upstream_timeout_seconds'],
            'request_profile_sha256': sha(canonical(read(ROOT / 'request-profile.json')))}


def freeze():
    if (ROOT / 'frozen-manifest.json').exists():
        raise RuntimeError('Preserve the frozen treatment')
    corpus = read(DIRECTORY / 'corpus.json')
    (ROOT / 'inspections').mkdir(mode=0o700, exist_ok=False)
    plan = {'criteria_version': 'local-repair.v1', 'subject': subject(), 'cases': [
        {key: row[key] for key in ('case_id', 'partition', 'family', 'task_sha256', 'checks_sha256')}
        for row in corpus['entries']]}
    write(ROOT / 'coding-plan.json', plan, exclusive=True)
    write(DIRECTORY / 'coding-plan.json', plan, exclusive=True)
    paths = set(p for p in (ROOT / 'installed/hormuz').rglob('*')
                if p.is_file() and p.suffix in {'.py', '.json'} and '__pycache__' not in p.parts)
    paths.update([ROOT / name for name in ('pins.json', 'setup-profile.json', 'developer-instructions.txt',
                   'client-instructions.txt', 'original-config.toml', 'gateway.json', 'request-profile.json', 'first-input.json', 'coding-plan.json')])
    paths.update(p for p in DIRECTORY.iterdir() if p.is_file())
    paths.update(p for p in (PRIVATE / 'checkers').iterdir() if p.is_file())
    paths.update(PRIVATE / name for name in ('checker-references.json', 'prepare-corpus.py',
                                           'candidate-artifact.json', 'download-receipt.json',
                                           'effective-artifact.json', 'template-derivation-receipt.json',
                                           'expected-engine-template.json'))
    paths.add(ASSETS / 'assets/model.gguf')
    paths.update(path for path in (DIRECTORY / 'stock-preflight').rglob('*') if path.is_file())
    paths.add(SOURCE / 'docs/campaigns/local-repair-20261017-v7/development-runner.py')
    paths.add(SOURCE / 'docs/diagnostics/native-tool-compat-20261017/native-date-binding.py')
    pins = read(ROOT / 'pins.json')
    paths.update(Path(pins[key]['path']) for key in ('client', 'runtime_archive', 'runtime_executable', 'model'))
    manifest = {'document_version': 1, 'campaign_id': CAMPAIGN, 'source_commit': 'd006beb6a21e527c01692b7591c62aa820fea41f',
        'plan_sha256': sha(canonical(plan)),
        'budget': {'canary_episodes': 1, 'total_episodes_if_canary_passes': 16, 'max_requests_per_episode': 8,
                   'max_elapsed_seconds_per_episode': 90, 'max_output_tokens_per_generation': 512,
                   'quality_retries': 0, 'transport_retries': 0, 'parallel_native_episodes': 1},
        'artifacts': [{'path': str(path), 'bytes': path.stat().st_size, 'sha256': file_hash(path)}
                      for path in sorted(paths)]}
    write(ROOT / 'frozen-manifest.json', manifest, exclusive=True)
    write(DIRECTORY / 'frozen-manifest.json', manifest, exclusive=True)
    print(json.dumps({'stage': 'frozen', 'artifacts': len(manifest['artifacts']),
                      'plan_sha256': manifest['plan_sha256'], 'manifest_sha256': file_hash(ROOT / 'frozen-manifest.json')}))


def verify_freeze():
    manifest = read(ROOT / 'frozen-manifest.json')
    for row in manifest['artifacts']:
        path = Path(row['path'])
        if path.stat().st_size != row['bytes'] or file_hash(path) != row['sha256']:
            raise RuntimeError('Frozen input changed: ' + str(path))
    if not (ROOT / 'preregistration.json').exists():
        raise RuntimeError('Require the published preregistration checkpoint before inference')
    return manifest


def case_probe_plan(case, plan):
    first_input = copy.deepcopy(read(ROOT / 'first-input.json'))
    first_input[-1]['content'][0]['text'] = case['goal']
    first_input = date_binding.bind_native_date(first_input)
    return {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 2, 'campaign_id': CAMPAIGN,
            'plan_sha256': sha(canonical(plan)), 'case_id': case['case_id'], 'task_sha256': case['task_sha256'],
            'checks_sha256': case['checks_sha256'], 'model': ALIAS, 'subject': plan['subject'],
            'first_input_sha256': sha(canonical(retained.semantic_input(first_input))),
            'max_requests': 8, 'max_elapsed_seconds': 90}


def verified_inspection(case_id):
    """Require the operator's exact-patch inspection outside tool write roots.

    Submitted Python shares the checker interpreter, so its completion token is
    only an early-exit guard. The existing independent operator review must rule
    out assertion, oracle, process, or receipt interference before acceptance.
    """
    output = ROOT / 'episodes' / case_id
    result = read(output / 'result.json')
    record = read(ROOT / 'inspections' / (case_id + '.json'))
    expected = {'case_id': case_id, 'result_sha256': file_hash(output / 'result.json'),
                'implementation_sha256': file_hash(output / 'implementation-after.py'),
                'patch_sha256': file_hash(output / 'implementation.patch'),
                'no_harness_interference': True, 'independent_assertions_verified': True}
    if not result['mechanical_passed'] or any(record.get(k) != v for k, v in expected.items()):
        raise RuntimeError('Missing or mismatched independent operator inspection: ' + case_id)
    return record


def run_case(experiment, case, plan):
    output = ROOT / 'episodes' / case['case_id']
    output.mkdir(mode=0o700, exist_ok=False)
    prepare_case(case)
    before = (ROOT / 'project/solution.py').read_bytes()
    baseline_check = checker(case)
    report = {'case_id': case['case_id'], 'partition': case['partition'], 'native_episodes': 0,
              'quality_retries': 0, 'automatic_admission_effect': 'none',
              'baseline_check': baseline_check, 'baseline_exit_code': baseline_check['exit_code']}
    if report['baseline_exit_code'] != 1:
        raise RuntimeError('Baseline must fail by assertion before native launch')
    probe_plan = case_probe_plan(case, plan)
    write(output / 'probe-plan.json', probe_plan, exclusive=True)
    label = case['case_id'] + '-native'
    try:
        armed = experiment.cli('client', 'qualify', 'codex', '--client-home', str(experiment.client_home),
                               '--plan', str(output / 'probe-plan.json'))
        write(output / 'episode-started.json', {'case_id': case['case_id'], 'max_requests': 8,
                                               'max_elapsed_seconds': 90}, exclusive=True)
        with TraceTap(experiment.ports[0], output / 'trace') as tap:
            report['native_episodes'] = 1
            report['native'] = launch(experiment, label, base_url=tap.url, probe=armed['probe_id'])
        report['probe_after'] = experiment.cli('client', 'qualify', 'codex', '--client-home', str(experiment.client_home))
        report['trace_requests'] = len(tap.records)
        report['trace_errors'] = [r.get('trace_error_type') for r in tap.records if r.get('trace_error_type')]
        report['work_state'] = experiment.public('work/state')
        report['routing_after'] = experiment.cli('client', 'status', 'codex', '--client-home', str(experiment.client_home), '--routing')
    finally:
        report['revoked'] = experiment.cli('client', 'qualify', 'codex', '--client-home', str(experiment.client_home), '--revoke')
        implementation = ROOT / 'project/solution.py'
        info = implementation.lstat()
        safe = stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 1024 * 1024
        report['implementation_safe'] = safe
        after = implementation.read_bytes() if safe else before
        report['implementation_changed'] = after != before
        report['checker_after'] = checker(case) if safe else None
        report['check_exit_code'] = report['checker_after']['exit_code'] if safe else None
        report['checks_unchanged'] = file_hash(PRIVATE / 'checkers' / (case['case_id'] + '.py')) == case['checks_sha256']
        patch = ''.join(difflib.unified_diff(before.decode().splitlines(keepends=True), after.decode().splitlines(keepends=True),
                                           fromfile='solution.py.before', tofile='solution.py.after'))
        (output / 'implementation-after.py').write_bytes(after)
        (output / 'implementation.patch').write_text(patch)
        report['patch_sha256'] = sha(patch.encode()) if report['implementation_changed'] else None
        events = [json.loads(line) for line in (ROOT / (label + '.jsonl')).read_text().splitlines()]
        report['tool_events'] = [e['item'] for e in events if e.get('type') == 'item.completed'
                                and e.get('item', {}).get('type') in {'command_execution', 'file_change'}]
        report['operator_inspection_required'] = True
        report['mechanical_passed'] = bool(report['tool_events'] and report['implementation_changed'] and safe
            and report['checks_unchanged'] and report['check_exit_code'] == 0
            and report.get('native', {}).get('termination') == 'completed'
            and report['native']['exit_code'] == 0 and report['native']['elapsed_ms'] <= 90000
            and not report.get('trace_errors'))
        write(output / 'result.json', report, exclusive=True)
        for suffix in ('.jsonl', '.stderr', '-argv.json'):
            shutil.copy2(ROOT / (label + suffix), output / ('native' + suffix))
    print(json.dumps({key: report.get(key) for key in ('case_id', 'native_episodes', 'trace_requests',
        'implementation_changed', 'check_exit_code', 'mechanical_passed')}), flush=True)
    return report


def run(stage):
    marker = ROOT / (stage + '-started.json')
    if marker.exists():
        raise RuntimeError('Preserve a consumed stage; no quality retry')
    verify_freeze()
    corpus, plan = read(DIRECTORY / 'corpus.json'), read(ROOT / 'coding-plan.json')
    if stage == 'qualification':
        canary = read(ROOT / 'episodes/dev-clamp/result.json')
        if not canary['mechanical_passed']:
            raise RuntimeError('The remaining battery requires a passing canary')
        verified_inspection('dev-clamp')
    cases = corpus['entries'][:1] if stage == 'canary' else corpus['entries'][1:]
    write(marker, {'campaign': CAMPAIGN, 'cases': [c['case_id'] for c in cases], 'quality_retries': 0}, exclusive=True)
    experiment = retained.Experiment()
    report = {'stage': stage, 'campaign_id': CAMPAIGN, 'cases': []}
    try:
        report['setup'] = experiment.connect()
        report['readiness_before'] = experiment.cli('client', 'status', 'codex', '--client-home', str(experiment.client_home), '--routing')
        for case in cases:
            report['cases'].append(run_case(experiment, case, plan))
    finally:
        experiment.close(report)
        write(ROOT / (stage + '-result.json'), report, exclusive=True)
    if not report.get('settings_restored') or not report.get('owned_listeners_closed'):
        raise RuntimeError('Owned cleanup failed')
    if not all(row['mechanical_passed'] for row in report['cases']):
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('prepare', 'preflight', 'freeze', 'canary', 'qualification', 'audit'))
    args = parser.parse_args()
    if args.operation == 'prepare': initialize()
    elif args.operation == 'preflight': capture()
    elif args.operation == 'freeze': freeze()
    elif args.operation == 'audit':
        verify_freeze()
        for case in read(DIRECTORY / 'corpus.json')['entries']:
            verified_inspection(case['case_id'])
        print(json.dumps({'independently_inspected_passes': 16, 'automatic_admission_effect': 'none'}))
    else: return run(args.operation)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
