"""Opt-in Codex acceptance journey using an installed wheel and existing local assets.

prepare captures the actual client envelope without inference. run consumes each
frozen scenario once. This operator tool neither qualifies a model nor activates
personal selection. Evidence may contain synthetic native context; keep it private.
"""
import argparse
import difflib
import fcntl
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import platform
import re
import secrets
import selectors
import signal
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import tomllib
import zipfile

BOUND = 2 * 1024 * 1024
BASELINE = 'def bounded_add(a, b):\n    return a - b\n'
CHECKER = ('import runpy,sys\nfunction=runpy.run_path(sys.argv[1])["bounded_add"]\n'
           'assert function(2,5)==7\nassert function(-4,9)==5\nassert function(0,0)==0\n')
PROMPT = ('Fix the Python function in solution.py: bounded_add(a, b) must return the sum of the two integers. '
          'Edit the existing implementation using a short complete tool call, run one concise '
          'behavior check by importing it, inspect the result, then finish immediately.')
INSTRUCTIONS = 'Use short complete tool calls. Honor the exact task contract. Edit, run one imported-function check, then finish.'
PROFILE_KEYS = ('instructions', 'tools', 'tool_choice', 'temperature', 'top_p', 'reasoning',
                'include', 'text', 'parallel_tool_calls', 'store', 'service_tier', 'stream')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def checksum(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read(path):
    with Path(path).open('rb') as stream:
        raw = stream.read(BOUND + 1)
    if len(raw) > BOUND:
        raise RuntimeError('Evidence exceeds its bound')
    return json.loads(raw)


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write('\n')


def private_text(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(value)


def fingerprint(path):
    path = Path(path)
    return {'path': str(path), 'sha256': checksum(path) if path.is_file() else None}


def semantic_input(items):
    # The documented v2 public probe normalization, not provider-owned state.
    return [{key: value for key, value in item.items() if key != 'id'}
            if isinstance(item, dict) and item.get('type') == 'message'
            and item.get('role') in {'system', 'developer', 'user'}
            and isinstance(item.get('id'), str)
            and re.fullmatch(r'msg_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', item['id'])
            else item for item in items]


def request_profile(value):
    profile = {key: value[key] for key in PROFILE_KEYS if key in value}
    profile.setdefault('store', False)
    profile['service_tier'] = profile.get('service_tier') or 'default'
    instructions = [{'position': index, 'message': item}
        for index, item in enumerate(semantic_input(value['input']))
        if isinstance(item, dict) and item.get('role') in {'system', 'developer'}]
    if instructions:
        profile['input_instructions'] = instructions
    return profile


def stop(process):
    """Only process groups created here with start_new_session=True."""
    process.poll()  # Reap a completed leader before checking its remaining group.
    for action in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, action)
        except ProcessLookupError:
            process.wait(timeout=1)
            return
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                process.wait(timeout=1)
                return
            time.sleep(.05)
    raise RuntimeError('Owned native process group did not stop')


class Session:
    def __init__(self, root, manifest):
        self.root, self.manifest = root, manifest
        self.home, self.client_home = root / 'home', root / 'home/.codex'
        self.config = root / 'gateway.json'
        self.env = {'HOME': str(self.home), 'CODEX_HOME': str(self.client_home),
            'KOTO_HISTORY_HOME': str(root / 'history'), 'TMPDIR': str(root / 'tmp'),
            'PATH': str(Path(manifest['python']).parent) + ':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'LANG': 'en_US.UTF-8', 'OTEL_SDK_DISABLED': 'true',
            'PYTHONPATH': str(root / 'installed'), 'PYTHONDONTWRITEBYTECODE': '1'}
        self.base = [manifest['python'], '-m', 'koto', '--config', str(self.config)]
        self.receipts = []
        self.generation, self.provider, self.token = None, None, None
        self.ports = []
        self.closed = False

    def cli(self, *arguments, timeout=90):
        result = subprocess.run([*self.base, *arguments], cwd=self.root, env=self.env,
            capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        if result.returncode:
            raise RuntimeError('Public command failed: ' + (result.stderr or result.stdout)[-4096:])
        value = json.loads(result.stdout)
        self.receipts.append({'operation': list(arguments[:2]), 'receipt': value})
        return value

    def connect(self):
        assets = self.manifest['assets']
        result = self.cli('client', 'setup', 'codex', '--client-home', str(self.client_home),
            '--executable', assets['codex']['path'], '--qualification', str(self.root / 'profile.json'),
            '--runtime-archive', assets['runtime_archive']['path'],
            '--llama-executable', assets['llama_executable']['path'], '--model-file', assets['model_file']['path'])
        self.generation = result['connection']['generation']
        self.ports = [result['configuration']['listen_port'], result['configuration']['runtime_port']]
        settings = read(self.config)
        if (settings['route_admission']['mode'] != 'local_only'
                or any(upstream['locality'] != 'local' for upstream in settings['upstreams'].values())
                or settings['ai_work'].get('cache_enabled', False)
                or any(route.get('coding_evidence') for route in settings['route_admission']['local_routes'].values())):
            raise RuntimeError('Acceptance requires local-only uncached unqualified coding')
        native = tomllib.loads((self.client_home / 'config.toml').read_text())
        self.provider = native['model_provider']
        auth = native['model_providers'][self.provider]['auth']
        self.token = subprocess.run([auth['command'], *auth['args']], env=self.env, cwd=self.root,
            capture_output=True, text=True, timeout=6, check=True, stdin=subprocess.DEVNULL).stdout.strip()
        if not self.token:
            raise RuntimeError('Owned credential helper returned no credential')
        return result

    def routing(self):
        value = self.cli('client', 'status', 'codex', '--client-home', str(self.client_home), '--routing')
        if value['mode'] != 'local_only' or any(route['coding_readiness'] != 'unknown'
                or any(task in {'code_change', 'code_review'} for task in route['automatic_task_types'])
                for route in value['routes']):
            raise RuntimeError('Automatic coding must remain disabled')
        return value

    def public(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.ports[0], timeout=3)
        try:
            connection.request('GET', '/v1/' + path, headers={'Authorization': 'Bearer ' + self.token})
            response = connection.getresponse()
            raw = response.read(BOUND + 1)
            if response.status != 200 or len(raw) > BOUND:
                raise RuntimeError('Public state inspection failed')
            return json.loads(raw)
        finally:
            connection.close()

    def close(self, report):
        if self.closed:
            return
        self.closed = True
        errors = []
        for arguments in (('client', 'qualify', 'codex', '--client-home', str(self.client_home), '--revoke'),
                          ('client', 'disconnect', 'codex', '--client-home', str(self.client_home),
                           *(['--generation', self.generation] if self.generation else []))):
            try:
                report[arguments[1]] = self.cli(*arguments, timeout=25)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                errors.append(str(error))
        try:
            report['settings_restored'] = ((self.client_home / 'config.toml').read_bytes()
                                          == (self.root / 'original-config.toml').read_bytes())
        except OSError as error:
            errors.append(str(error))
            report['settings_restored'] = False
        report['owned_listeners_closed'] = True
        for port in self.ports:
            with socket.socket() as connection:
                connection.settimeout(.5)
                if connection.connect_ex(('127.0.0.1', port)) == 0:
                    report['owned_listeners_closed'] = False
        try:
            report['live_settings_preserved'] = all(fingerprint(item['path']) == item
                                                   for item in self.manifest['live_settings'])
        except OSError as error:
            errors.append(str(error))
            report['live_settings_preserved'] = False
        report['receipts'] = self.receipts
        if errors:
            report['cleanup_errors'] = errors

    def argv(self, scenario, *, base_url=None, probe=None):
        root = self.root
        permissions = {':root': 'read', '/private/tmp': 'deny', str(Path.home()): 'deny',
            str(root): 'deny', str(root / 'tmp'): 'write', str(root / 'project'): 'write',
            str(self.client_home / 'tmp/arg0'): 'read'}
        table = '{' + ','.join(json.dumps(key) + '=' + json.dumps(value) for key, value in permissions.items()) + '}'
        args = [self.manifest['assets']['codex']['path'], 'exec', '--skip-git-repo-check', '--ephemeral', '--json',
            '-c', 'approval_policy="never"', '-c', 'agents.enabled=false', '--disable', 'multi_agent_v2', '--disable', 'goals',
            '-c', 'default_permissions="acceptance"', '-c', 'permissions.acceptance.filesystem=' + table,
            '-c', 'permissions.acceptance.network.enabled=false',
            '-c', 'shell_environment_policy.set={TMPDIR=' + json.dumps(str(root / 'tmp'))
                  + ',TMPPREFIX=' + json.dumps(str(root / 'tmp/zsh')) + '}',
            '-c', 'model_reasoning_effort="none"', '-c', 'model_reasoning_summary="none"',
            '-c', 'developer_instructions=' + json.dumps((root / 'private/instructions.txt').read_text()),
            '-c', 'analytics.enabled=false', '-C', str(root / 'project')]
        if self.manifest.get('native_plugin_discovery_disabled'):
            args += ['--disable', 'plugins']
        if self.manifest.get('client_instructions_sha256'):
            args += ['-c', 'model_instructions_file=' + json.dumps(str(root / 'private/client-instructions.txt'))]
        if base_url:
            args += ['-c', 'model_providers.' + self.provider + '.base_url=' + json.dumps(base_url)]
        if probe:
            args += ['-c', 'model_providers.' + self.provider + '.http_headers={"X-Hormuz-Qualification-Probe"=' + json.dumps(probe) + '}']
        return [*args, self.manifest['scenarios'][scenario]['prompt']]

    def native(self, scenario, output, *, base_url=None, probe=None, timeout=25, cancel_event=None):
        args = self.argv(scenario, base_url=base_url, probe=probe)
        write(output / 'argv.json', [arg.replace(probe, '<RUN_MARKER>') if probe else arg for arg in args])
        started = time.monotonic()
        termination, cleanup_error = 'completed', None
        with (output / 'native.jsonl').open('xb') as stdout, (output / 'native.stderr').open('xb') as stderr:
            os.fchmod(stdout.fileno(), 0o600)
            os.fchmod(stderr.fileno(), 0o600)
            native_env = {**self.env, 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'}
            process = subprocess.Popen(args, cwd=self.root / 'project', env=native_env,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            streams = selectors.DefaultSelector()
            counts = {process.stdout: 0, process.stderr: 0}
            streams.register(process.stdout, selectors.EVENT_READ, stdout)
            streams.register(process.stderr, selectors.EVENT_READ, stderr)
            try:
                while streams.get_map():
                    if cancel_event is not None and cancel_event.is_set() and process.poll() is None:
                        termination = 'canceled'
                        break
                    if time.monotonic() - started >= timeout:
                        termination = 'timeout'
                        break
                    for key, _ in streams.select(timeout=.05):
                        block = os.read(key.fileobj.fileno(), 8192)
                        if not block:
                            streams.unregister(key.fileobj)
                            continue
                        available = BOUND - counts[key.fileobj]
                        key.data.write(block[:available])
                        counts[key.fileobj] += min(len(block), available)
                        if len(block) > available:
                            termination = 'native_output_limit'
                            break
                    if termination == 'native_output_limit':
                        break
            finally:
                try:
                    stop(process)
                except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                    cleanup_error = str(error)
                streams.close()
                process.stdout.close()
                process.stderr.close()
        return {'exit_code': process.returncode, 'elapsed_ms': int((time.monotonic() - started) * 1000),
                'termination': termination, 'cleanup_error': cleanup_error}


class Capture:
    def __init__(self):
        self.requests = []
        owner = self
        class Handler(http.server.BaseHTTPRequestHandler):
            timeout = 5
            def log_message(self, *_):
                pass
            def do_POST(self):
                size = int(self.headers.get('Content-Length', '0'))
                if self.path != '/v1/responses' or owner.requests or not 0 < size <= 65536:
                    self.send_error(400)
                    return
                owner.requests.append(json.loads(self.rfile.read(size)))
                raw = b'{"error":{"message":"Intentional zero-inference acceptance capture"}}'
                self.send_response(503)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        self.server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever,
            kwargs={'poll_interval': .05}, daemon=False)

    def __enter__(self):
        self.thread.start()
        return self

    @property
    def url(self):
        return 'http://127.0.0.1:' + str(self.server.server_port) + '/v1'

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=6)
        if self.thread.is_alive():
            raise RuntimeError('Owned capture thread did not stop')


class Relay:
    """One serial, bounded local trace; credentials exist only in forwarded memory."""
    def __init__(self, session, output):
        self.records, self.output = [], output
        self.dispatched = threading.Event()
        self.backend = http.client.HTTPConnection('127.0.0.1', session.ports[0], timeout=90)
        self.socket = None
        owner = self
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            timeout = 5
            def log_message(self, *_):
                pass
            def do_POST(self):
                size = int(self.headers.get('Content-Length', '0'))
                if self.path != '/v1/responses' or len(owner.records) >= 8 or not 0 < size <= 65536:
                    self.send_error(400)
                    return
                body = self.rfile.read(size)
                record = {'request_sha256': hashlib.sha256(body).hexdigest()}
                owner.records.append(record)
                write(owner.output / ('request-%02d.json' % len(owner.records)), json.loads(body))
                raw = bytearray()
                response = None
                try:
                    owner.backend.request('POST', self.path, body, {key: value for key, value in self.headers.items()
                        if key.lower() not in {'host', 'connection', 'content-length', 'transfer-encoding'}})
                    owner.socket = owner.backend.sock
                    response = owner.backend.getresponse()
                    record.update(status=response.status, **{name: response.getheader(header) for name, header in (
                        ('reason', 'X-Hormuz-Routing-Reason'), ('work_id', 'X-Hormuz-Work-ID'),
                        ('destination_generation', 'X-Hormuz-Destination-Generation'))})
                    self.send_response(response.status)
                    self.send_header('Content-Type', response.getheader('Content-Type', 'application/json'))
                    self.send_header('Transfer-Encoding', 'chunked')
                    self.end_headers()
                    while True:
                        block = response.read1(8192)
                        if not block:
                            break
                        if len(raw) + len(block) > BOUND:
                            raise RuntimeError('Response trace exceeds its bound')
                        raw.extend(block)
                        if response.status == 200:
                            owner.dispatched.set()
                        self.wfile.write(('%x\r\n' % len(block)).encode() + block + b'\r\n')
                        self.wfile.flush()
                    self.wfile.write(b'0\r\n\r\n')
                    self.wfile.flush()
                except (OSError, ValueError, RuntimeError, http.client.HTTPException) as error:
                    record['error'] = type(error).__name__
                    self.close_connection = True
                finally:
                    if response is not None:
                        response.close()
                    private_text(owner.output / ('response-%02d.txt' % len(owner.records)), raw.decode('utf-8', errors='replace'))
        self.server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever,
            kwargs={'poll_interval': .05}, daemon=False)

    def __enter__(self):
        self.thread.start()
        return self

    @property
    def url(self):
        return 'http://127.0.0.1:' + str(self.server.server_port) + '/v1'

    def __exit__(self, *_):
        if self.socket is not None:
            try:
                self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=6)
        self.backend.close()
        write(self.output / 'trace.json', self.records)
        if self.thread.is_alive():
            raise RuntimeError('Owned relay thread did not stop')


def independent_check(session, output, label):
    root = session.root
    marker = secrets.token_hex(24)
    wrapper = ('import runpy,sys\ntry:\n runpy.run_path(sys.argv.pop(1),run_name="__main__")\n'
               'except AssertionError:\n sys.exit(1)\nexcept BaseException:\n sys.exit(2)\n'
               'print(' + repr(marker) + ',flush=True)\n')
    command = [session.manifest['python'], '-I', '-B', '-S', '-c', wrapper,
               str(root / 'private/checker.py'), str(root / 'project/solution.py')]
    if sys.platform == 'darwin':
        readable = [('literal', '/'), ('subpath', str(Path(session.manifest['python']).resolve().parent.parent)),
            ('literal', session.manifest['python']),
            ('literal', str(Path(session.manifest['python']).parent.parent / 'pyvenv.cfg')),
            ('literal', str(root / 'private/checker.py')), ('literal', str(root / 'project/solution.py')),
            *[('subpath', path) for path in ('/System/Library', '/usr/lib', '/Library/Apple/System/Library', '/private/var/db/dyld')],
            *[('literal', path) for path in ('/dev/null', '/dev/random', '/dev/urandom')]]
        allowed = ' '.join('(' + kind + ' ' + json.dumps(path) + ')' for kind, path in readable)
        profile = '(version 1)(allow default)(deny network*)(deny file-write*)(deny file-read-data (require-not (require-any ' + allowed + ')))'
        command = ['/usr/bin/sandbox-exec', '-p', profile, *command]
    else:
        raise RuntimeError('Independent executable checks require the qualified macOS sandbox')
    path = output / (label + '-checker.txt')
    with path.open('x+b') as stream:
        os.fchmod(stream.fileno(), 0o600)
        child = subprocess.Popen(command, cwd=root / 'private', env={'HOME': str(root / 'tmp'), 'PATH': '/usr/bin:/bin'},
            stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.DEVNULL, start_new_session=True)
        deadline, bounded = time.monotonic() + 3, True
        try:
            while child.poll() is None:
                if time.monotonic() >= deadline or os.fstat(stream.fileno()).st_size > 8192:
                    bounded = False
                    break
                try:
                    child.wait(timeout=.05)
                except subprocess.TimeoutExpired:
                    pass
        finally:
            stop(child)
        stream.seek(0)
        observed = stream.read(8193)
    completed = observed == (marker + '\n').encode()
    return {'exit_code': child.returncode if bounded and (child.returncode != 0 or completed) else None,
            'process_exit_code': child.returncode, 'assertions_completed': completed, 'within_budget': bounded}


def capture_implementation(session, output, report, before):
    implementation = session.root / 'project/solution.py'
    info = implementation.lstat()
    safe = stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 1024 * 1024
    report['implementation_safe'] = safe
    after = implementation.read_bytes() if safe else before
    report['implementation_changed'] = after != before
    checker = session.root / 'private/checker.py'
    checker_info = checker.lstat()
    expected = session.manifest['artifacts']['private/cases/' + session.manifest['case']['id'] + '/checker.py']
    unchanged = (stat.S_ISREG(checker_info.st_mode) and checker_info.st_nlink == 1 and checksum(checker) == expected)
    report['checks_unchanged'] = unchanged
    report['checker'] = independent_check(session, output, 'after') if safe and unchanged else None
    if unchanged:
        report['checks_unchanged'] = checksum(checker) == expected
    private_text(output / 'implementation.patch', ''.join(difflib.unified_diff(before.decode().splitlines(keepends=True),
        after.decode().splitlines(keepends=True), fromfile='solution.py.before', tofile='solution.py.after')))
    private_text(output / 'implementation.py', after.decode())
    report['project_snapshot'] = snapshot_project(session.root / 'project', output / 'project')


def snapshot_project(project, destination):
    """Bounded preservation without following model-created links or devices."""
    info = project.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError('Only the owned disposable project can be inspected or reset')
    destination.mkdir(mode=0o700)
    records, total = [], 0
    pending = [(project, destination, 0)]
    while pending:
        source, target, depth = pending.pop()
        if depth > 8:
            raise RuntimeError('Project snapshot depth exceeded')
        with os.scandir(source) as entries:
            for entry in entries:
                if len(records) >= 64:
                    raise RuntimeError('Project snapshot entry bound exceeded; preserve the remaining project')
                path = Path(entry.path)
                info = entry.stat(follow_symlinks=False)
                record = {'path': str(path.relative_to(project))}
                if stat.S_ISLNK(info.st_mode):
                    record.update(kind='symlink', target=os.readlink(path))
                elif stat.S_ISDIR(info.st_mode):
                    record['kind'] = 'directory'
                    child = target / entry.name
                    child.mkdir(mode=0o700)
                    pending.append((path, child, depth + 1))
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    if info.st_size > BOUND - total:
                        raise RuntimeError('Project snapshot byte bound exceeded; preserve the remaining project')
                    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(descriptor, 'rb') as stream:
                        current = os.fstat(stream.fileno())
                        if (current.st_ino, current.st_dev, current.st_size) != (info.st_ino, info.st_dev, info.st_size):
                            raise RuntimeError('Project changed during preservation')
                        raw = stream.read(BOUND - total + 1)
                    if len(raw) > BOUND - total:
                        raise RuntimeError('Project grew during preservation')
                    total += len(raw)
                    with (target / entry.name).open('xb') as stream:
                        os.fchmod(stream.fileno(), 0o600)
                        stream.write(raw)
                    record.update(kind='file', bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
                else:
                    raise RuntimeError('Unsafe project entry; retain it without executing or following it')
                records.append(record)
    write(destination.with_name(destination.name + '-inventory.json'), {'entries': records, 'bytes': total})
    return {'entries': len(records), 'bytes': total, 'complete': True}


def verify_freeze(root):
    manifest = read(root / 'freeze.json')
    if checksum(root / 'freeze.json') != (root / 'freeze.sha256').read_text().strip():
        raise RuntimeError('Frozen manifest changed')
    if checksum(__file__) != manifest['tool_sha256']:
        raise RuntimeError('Frozen operator tool changed')
    if checksum(manifest['python']) != manifest['python_sha256'] or manifest['host'] != {
            'system': platform.system(), 'machine': platform.machine()}:
        raise RuntimeError('Frozen interpreter or execution host changed')
    if artifact_inventory(root) != manifest['artifacts']:
        raise RuntimeError('Frozen artifact inventory changed')
    for asset in manifest['assets'].values():
        if fingerprint(asset['path']) != asset:
            raise RuntimeError('Frozen executable, wheel or asset changed')
    for name, expected in manifest['artifacts'].items():
        path = root / name
        if path.is_symlink() or not path.resolve().is_relative_to(root) or checksum(path) != expected:
            raise RuntimeError('Frozen artifact changed: ' + name)
    if any(fingerprint(item['path']) != item for item in manifest['live_settings']):
        raise RuntimeError('Live settings changed since preparation; recapture separately without rewriting this evidence')
    return manifest


def artifact_inventory(root):
    values = {}
    active = {root / 'private/checker.py', root / 'private/initial-solution.py'}
    for directory in ('installed', 'captures', 'private'):
        for path in (root / directory).rglob('*'):
            if len(values) >= 4096 or path.is_symlink():
                raise RuntimeError('Frozen artifact inventory is unsafe or exceeded its bound')
            if path.is_file() and path not in active:
                values[str(path.relative_to(root))] = checksum(path)
    values.update({name: checksum(root / name) for name in ('profile.json', 'original-config.toml')})
    return values


def run_frozen(args):
    root = args.evidence.expanduser().resolve()
    manifest = verify_freeze(root)
    case_id = args.case_id or (next(iter(manifest['cases'])) if len(manifest['cases']) == 1 else None)
    if case_id not in manifest['cases']:
        raise RuntimeError('Select one frozen --case-id before running a multicase campaign')
    selected = manifest['cases'][case_id]
    manifest = {**manifest, 'case': {key: value for key, value in selected.items() if key != 'scenarios'},
                'scenarios': selected['scenarios']}
    name = args.scenario
    parent = root / 'results' / case_id if len(manifest['cases']) > 1 else root / 'results'
    parent.mkdir(mode=0o700, exist_ok=True)
    output = parent / name
    output.mkdir(mode=0o700, exist_ok=False)  # Consumed before any launch, including a failed launch.
    write(output / 'started.json', {'scenario': name, 'freeze_sha256': checksum(root / 'freeze.json')})
    session = Session(root, manifest)
    report = {'scenario': name, 'passed': False, 'automatic_admission_effect': 'none',
              'operator_inspection_required': True, 'qualification_claim': False, 'case': manifest['case']}
    try:
        private_case = root / 'private/cases' / case_id
        for source, target in (('checker.py', 'checker.py'), ('initial-solution.py', 'initial-solution.py')):
            (root / 'private' / target).write_bytes((private_case / source).read_bytes())
        report['project_before_reset'] = snapshot_project(root / 'project', output / 'project-before')
        for entry in (root / 'project').iterdir():
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
        implementation = root / 'project/solution.py'
        private_text(implementation, (root / 'private/initial-solution.py').read_text())
        before = implementation.read_bytes()
        report['baseline'] = independent_check(session, output, 'baseline')
        if report['baseline']['exit_code'] != 1:
            raise RuntimeError('Independent baseline must fail by assertion')
        report['setup'] = session.connect()
        report['routing_before'] = session.routing()
        session.cli('history', 'enable')  # Only the fresh synthetic fixture's isolated store.
        prior_history = session.cli('history', 'list', '--limit', '1000')
        prior_ids = {item['id'] for item in prior_history['entries']}
        report['prior_history_count'] = prior_history['total']
        profile = read(root / 'profile.json')
        extended_output = profile['schema_version'] == 5
        subject = {'client_version': profile['client_version'], 'system': platform.system(), 'machine': platform.machine(),
            'runtime_profile': 'managed-llama.v2' if extended_output else 'managed-llama.v1',
            'runtime_sha256': profile['runtime_sha256'],
            'model_revision': 'sha256:' + profile['model_sha256'], 'upstream_model': profile['model'], 'protocol': 'openai',
            'capabilities': profile['capabilities'], 'max_request_bytes': profile['max_request_bytes'],
            'max_output_tokens': profile['max_output_tokens'], 'upstream_timeout_seconds': profile['upstream_timeout_seconds'],
            'request_profile_sha256': manifest['scenarios'][name]['profile_sha256']}
        plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 4 if extended_output else 2,
            'campaign_id': 'codex-acceptance-' + checksum(root / 'freeze.json')[:16], 'plan_sha256': checksum(root / 'freeze.json'),
            'case_id': manifest['case']['id'] + ('' if name == 'edit' else '-' + name),
            'task_sha256': hashlib.sha256(manifest['scenarios'][name]['prompt'].encode()).hexdigest(),
            'checks_sha256': checksum(root / 'private/checker.py'), 'model': profile['model'], 'subject': subject,
            'first_input_sha256': manifest['scenarios'][name]['input_sha256'], 'max_requests': 8, 'max_elapsed_seconds': 90}
        write(output / 'probe-plan.json', plan)
        probe = (session.cli('client', 'qualify', 'codex', '--client-home', str(session.client_home), '--plan', str(output / 'probe-plan.json'))
                 if name != 'deny' else None)
        with Relay(session, output) as relay:
            report['native'] = session.native(name, output, base_url=relay.url,
                probe=probe['probe_id'] if probe else None, timeout=90,
                cancel_event=relay.dispatched if name == 'cancel' else None)
        events = []
        for line in (output / 'native.jsonl').read_text().splitlines():
            if line:
                try:
                    event = json.loads(line)
                    if (type(event) is not dict or type(event.get('type')) is not str
                            or 'item' in event and type(event['item']) is not dict):
                        raise ValueError()
                    events.append(event)
                except ValueError:
                    report['error'] = 'native_event_invalid'
        report['native']['completed_turns'] = sum(event.get('type') == 'turn.completed' for event in events)
        report['native']['failed_turns'] = sum(event.get('type') in {'turn.failed', 'error'}
            or event.get('item', {}).get('type') == 'error' for event in events)
        report['native']['completed_tools'] = sum(event.get('type') == 'item.completed'
            and event.get('item', {}).get('type') in {'command_execution', 'file_change'} for event in events)
        capture_implementation(session, output, report, before)
        report['probe_after'] = session.cli('client', 'qualify', 'codex', '--client-home', str(session.client_home))
        report['work_state'] = session.public('work/state')
        report['routing_after'] = session.routing()
        if name == 'cancel':
            session.close(report)
        history = session.cli('history', 'list', '--limit', '1000')
        new_entries = [entry for entry in history['entries'] if entry['id'] not in prior_ids]
        report['history'] = {**history, 'entries': new_entries, 'total': len(new_entries)}
        report['retained_history_total'] = history['total']
        report['history_reviews'] = [session.cli('history', 'show', entry['id']) for entry in report['history']['entries']]
        records = relay.records
        affinity = len(records) >= 2 and len({item.get('work_id') for item in records}) == 1 and records[0].get('work_id') is not None
        affinity = affinity and len({item.get('destination_generation') for item in records}) == 1 and records[0].get('destination_generation') is not None
        report['affinity'] = {'preserved_continuations': sum(item.get('reason') == 'session_affinity' for item in records), 'preserved': bool(affinity)}
        report['passed'] = bool(not report.get('error') and report['implementation_safe']
            and report['implementation_changed'] and report['checks_unchanged'] and report['checker']
            and report['checker']['exit_code'] == 0
            and report['checker']['assertions_completed'] and report['native']['exit_code'] == 0
            and report['native']['termination'] == 'completed' and not report['native']['cleanup_error']
            and report['native']['elapsed_ms'] <= 90000
            and report['native']['completed_turns'] == 1 and report['native']['failed_turns'] == 0
            and report['native']['completed_tools'] > 0 and report['affinity']['preserved']
            and report['affinity']['preserved_continuations'] > 0 and 2 <= len(records) <= 8
            and all(item.get('status') == 200 and not item.get('error') for item in records)
            and len(report['history']['entries']) == len(records)
            and all(item['outcome'] == 'succeeded' for item in report['history']['entries']))
        if name == 'deny':
            response = read(output / 'response-01.txt') if len(records) == 1 else {}
            report['denial'] = {'status': records[0].get('status') if records else None,
                                'code': response.get('error', {}).get('code')}
            report['passed'] = bool(len(records) == 1 and report['denial'] == {
                'status': 503, 'code': 'hormuz_route_local_route_unavailable'}
                and report['probe_after']['submitted_requests'] == 0 and not report['history']['entries']
                and not report['implementation_changed'] and report['native']['completed_tools'] == 0
                and report['native']['completed_turns'] == 0 and report['native']['exit_code'] != 0)
        elif name == 'cancel':
            report['passed'] = bool(report['native']['termination'] == 'canceled'
                and not report['native']['cleanup_error'] and report['native']['completed_turns'] == 0
                and report['native']['exit_code'] != 0 and len(records) == 1
                and report['probe_after']['submitted_requests'] == 1 and not report['implementation_changed']
                and len(report['history']['entries']) == 1
                and report['history']['entries'][0]['outcome'] == 'outcome_unknown')
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        report['error'] = str(error)
    finally:
        if 'before' in locals() and 'implementation_changed' not in report:
            try:
                capture_implementation(session, output, report, before)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                report['observation_error'] = str(error)
        try:
            session.close(report)
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            report.setdefault('cleanup_errors', []).append(str(error))
        report['passed'] = bool(report['passed'] and not report.get('error') and not report.get('cleanup_errors') and all(report.get(key) for key in (
            'settings_restored', 'live_settings_preserved', 'owned_listeners_closed'))
            and not report.get('native', {}).get('cleanup_error'))
        write(output / 'result.json', report)
    print(json.dumps({'passed': report['passed'], 'scenario': name, 'evidence': str(output / 'result.json'), 'error': report.get('error')}))
    return 0 if report['passed'] else 2


def run(args):
    root = args.evidence.expanduser().resolve()
    descriptor = os.open(root / 'run.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another owned scenario is active; run cases sequentially') from None
        return run_frozen(args)
    finally:
        os.close(descriptor)


def prepare(args):
    if args.wheel.suffix != '.whl' or not zipfile.is_zipfile(args.wheel):
        raise RuntimeError('Use an existing built wheel; source builds and dependency downloads are unavailable')
    profile = read(args.qualification)
    output_limit = 2048 if profile.get('schema_version') == 5 else 512
    if (profile.get('client_version') != '0.160.0' or profile.get('coding_evidence') is not None
            or 'code_change' not in profile.get('task_types', [])
            or type(profile.get('max_output_tokens')) is not int
            or not 1 <= profile['max_output_tokens'] <= output_limit
            or profile['upstream_timeout_seconds'] > 90):
        raise RuntimeError('Use an unqualified Codex 0.160 profile with bounded code_change: '
                           'at most 512 output tokens, or 2048 for setup v5')
    cases = [read(path) for path in args.case] if args.case else [{'id': 'development-add', 'partition': 'development',
        'family': 'arithmetic', 'prompt': PROMPT, 'initial_solution': BASELINE, 'checker': CHECKER}]
    required = {'id', 'partition', 'family', 'prompt', 'initial_solution', 'checker'}
    for case in cases:
        if (type(case) is not dict or not required <= set(case) or set(case) - required - {'reference_solution'}
                or any(type(value) is not str or not 0 < len(value.encode()) <= 65536 for value in case.values())
                or re.fullmatch(r'[A-Za-z0-9_-]{1,64}', case['id']) is None
                or case['partition'] not in {'development', 'held_out'}):
            raise RuntimeError('Invalid authored case; use bounded text and a stable case ID')
    if not 1 <= len(cases) <= 64 or len({case['id'] for case in cases}) != len(cases):
        raise RuntimeError('Freeze 1 to 64 uniquely identified cases')
    case = cases[0]
    instructions = args.instructions.read_text() if args.instructions else INSTRUCTIONS
    if not 0 < len(instructions.encode()) <= 65536:
        raise RuntimeError('Instructions exceed their bound')
    client_instructions = args.client_instructions.read_text() if args.client_instructions else None
    if client_instructions is not None and not 0 < len(client_instructions.encode()) <= 65536:
        raise RuntimeError('Client instructions exceed their bound')
    assets = {key: fingerprint(getattr(args, key).expanduser().absolute())
              for key in ('wheel', 'codex', 'runtime_archive', 'llama_executable', 'model_file')}
    if any(value['sha256'] is None for value in assets.values()):
        raise RuntimeError('Every existing wheel/client/runtime/model asset must be a readable file')
    root = args.output.expanduser().resolve()
    root.mkdir(mode=0o700, exist_ok=False)
    for name in ('home', 'home/.codex', 'home/.codex/tmp', 'home/.codex/tmp/arg0',
                 'tmp', 'project', 'installed', 'private', 'private/cases', 'captures', 'results'):
        (root / name).mkdir(mode=0o700)
    original = 'personality = "none"\nmodel_reasoning_effort = "xhigh"\n'
    private_text(root / 'home/.codex/config.toml', original)
    private_text(root / 'original-config.toml', original)
    private_text(root / 'project/solution.py', case['initial_solution'])
    private_text(root / 'private/initial-solution.py', case['initial_solution'])
    private_text(root / 'private/checker.py', case['checker'])
    private_text(root / 'private/instructions.txt', instructions)
    if client_instructions is not None:
        private_text(root / 'private/client-instructions.txt', client_instructions)
    for item in cases:
        directory = root / 'private/cases' / item['id']
        directory.mkdir(mode=0o700)
        write(directory / 'case.json', item)
        private_text(directory / 'initial-solution.py', item['initial_solution'])
        private_text(directory / 'checker.py', item['checker'])
    write(root / 'profile.json', profile)
    live_home = Path(os.environ.get('HOME', str(Path.home())))
    live_codex = Path(os.environ.get('CODEX_HOME', str(live_home / '.codex')))
    manifest = {'schema_id': 'koto.codex-acceptance-freeze',
        'schema_version': 2 if profile['schema_version'] == 5 else 1,
        'python': str(args.python.expanduser().absolute()), 'model_requests': 0,
        'python_sha256': checksum(args.python), 'host': {'system': platform.system(), 'machine': platform.machine()},
        'client_instructions_sha256': hashlib.sha256(client_instructions.encode()).hexdigest() if client_instructions else None,
        'limits': {'max_requests': 8, 'max_elapsed_seconds': 90,
                   'max_output_tokens': profile['max_output_tokens']},
        'assets': assets,
        'cases': {item['id']: {**{key: item[key] for key in ('id', 'partition', 'family')},
                  'scenarios': {name: {'prompt': item['prompt'] + (' Cancellation control.' if name == 'cancel' else '')}
                                for name in ('edit', 'cancel', 'deny')}} for item in cases},
        'live_settings': [fingerprint(path) for path in sorted({live_home / '.codex/config.toml', live_codex / 'config.toml'})],
        'scenarios': {name: {'prompt': case['prompt'] + (' Cancellation control.' if name == 'cancel' else '')}
                      for name in ('edit', 'cancel', 'deny')}}
    if args.disable_plugin_discovery:
        manifest['native_plugin_discovery_disabled'] = True
    session = Session(root, manifest)
    report = {'stage': 'prepare', 'passed': False}
    try:
        installed = subprocess.run([manifest['python'], '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-compile',
            '--target', str(root / 'installed'), manifest['assets']['wheel']['path']], cwd=root,
            env=session.env, capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
        if installed.returncode:
            raise RuntimeError('Local wheel installation failed: ' + installed.stderr[-4096:])
        location = subprocess.check_output([manifest['python'], '-c', 'import hormuz; print(hormuz.__file__)'],
            cwd=root, env=session.env, text=True, timeout=10).strip()
        if not Path(location).resolve().is_relative_to(root / 'installed'):
            raise RuntimeError('Runtime did not import the isolated wheel')
        report['setup'] = session.connect()
        report['routing'] = session.routing()
        for item in cases:
            selected = manifest['cases'][item['id']]
            session.manifest = {**manifest, 'case': {key: value for key, value in selected.items() if key != 'scenarios'},
                                'scenarios': selected['scenarios']}
            (root / 'project/solution.py').write_text(item['initial_solution'])
            captures = root / 'captures' / item['id'] if len(cases) > 1 else root / 'captures'
            captures.mkdir(mode=0o700, exist_ok=True)
            for name in selected['scenarios']:
                output = captures / name
                output.mkdir(mode=0o700)
                with Capture() as capture:
                    report[item['id'] + ':' + name] = session.native(name, output, base_url=capture.url)
                native = report[item['id'] + ':' + name]
                if native['cleanup_error'] or native['termination'] != 'completed':
                    raise RuntimeError('Native zero-inference capture did not stop cleanly; preserve its failed evidence')
                if len(capture.requests) != 1:
                    raise RuntimeError('Native capture must observe exactly one non-forwarded request')
                captured = capture.requests[0]
                write(output / 'request.json', captured)
                selected['scenarios'][name]['input_sha256'] = hashlib.sha256(canonical(semantic_input(captured['input']))).hexdigest()
                selected['scenarios'][name]['profile_sha256'] = hashlib.sha256(canonical(request_profile(captured))).hexdigest()
                if item['id'] == cases[0]['id'] and name == 'edit':
                    repeated_output = captures / 'edit-repeat'
                    repeated_output.mkdir(mode=0o700)
                    with Capture() as repeated_capture:
                        native = session.native('edit', repeated_output, base_url=repeated_capture.url)
                    report[item['id'] + ':edit-repeat'] = native
                    if native['cleanup_error'] or native['termination'] != 'completed':
                        raise RuntimeError('Repeated native capture did not stop cleanly; preserve its failed evidence')
                    if len(repeated_capture.requests) != 1:
                        raise RuntimeError('Repeated native capture must observe exactly one non-forwarded request')
                    repeated = repeated_capture.requests[0]
                    write(repeated_output / 'request.json', repeated)
                    repeatability = {'case_id': item['id'], 'scenario': 'edit', 'model_requests': 0,
                        'first_input_sha256': selected['scenarios'][name]['input_sha256'],
                        'repeat_input_sha256': hashlib.sha256(canonical(semantic_input(repeated['input']))).hexdigest(),
                        'first_profile_sha256': selected['scenarios'][name]['profile_sha256'],
                        'repeat_profile_sha256': hashlib.sha256(canonical(request_profile(repeated))).hexdigest()}
                    repeatability['passed'] = (repeatability['first_input_sha256'] == repeatability['repeat_input_sha256']
                        and repeatability['first_profile_sha256'] == repeatability['repeat_profile_sha256'])
                    report['repeatability'] = manifest['repeatability'] = repeatability
                    if not repeatability['passed']:
                        report['failure'] = 'native_capture_not_repeatable'
                        raise RuntimeError('Native first request is not repeatable; retain both zero-inference captures and do not freeze')
        profiles = {scenario['profile_sha256'] for item in manifest['cases'].values() for scenario in item['scenarios'].values()}
        if len(profiles) != 1:
            raise RuntimeError('All frozen cases must share the same exact native instruction/tool profile')
        manifest['request_profile_sha256'] = next(iter(profiles))
        manifest['case'] = {key: value for key, value in manifest['cases'][case['id']].items() if key != 'scenarios'}
        manifest['scenarios'] = manifest['cases'][case['id']]['scenarios']
        report['passed'] = True
    finally:
        try:
            session.close(report)
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            report.setdefault('cleanup_errors', []).append(str(error))
        write(root / 'prepare-result.json', report)
    if not report['passed'] or report.get('cleanup_errors') or not all(report.get(key) for key in (
            'settings_restored', 'live_settings_preserved', 'owned_listeners_closed')):
        raise RuntimeError('Preparation or owned cleanup did not pass; retain evidence')
    manifest['artifacts'] = artifact_inventory(root)
    manifest['tool_sha256'] = checksum(__file__)
    write(root / 'freeze.json', manifest)
    private_text(root / 'freeze.sha256', checksum(root / 'freeze.json') + '\n')
    print(json.dumps({'prepared': True, 'evidence': str(root), 'model_requests': 0}))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='operation', required=True)
    prepare_command = commands.add_parser('prepare', help='Install and capture without model inference')
    for name in ('wheel', 'codex', 'runtime-archive', 'llama-executable', 'model-file', 'qualification', 'output'):
        prepare_command.add_argument('--' + name, type=Path, required=True)
    prepare_command.add_argument('--python', type=Path, default=Path(sys.executable))
    prepare_command.add_argument('--case', type=Path, action='append', help='Authored case JSON; repeat before freeze for one shared campaign')
    prepare_command.add_argument('--instructions', type=Path, help='Frozen shared developer guidance, distinct from the task contract')
    prepare_command.add_argument('--client-instructions', type=Path, help='Optional frozen native system instruction file')
    prepare_command.add_argument('--disable-plugin-discovery', action='store_true',
        help='Freeze native --disable plugins for isolated coding probes without marketplace discovery; does not qualify plugin activation')
    run_command = commands.add_parser('run', help='Consume one frozen native acceptance scenario')
    run_command.add_argument('--evidence', type=Path, required=True)
    run_command.add_argument('--scenario', choices=('edit', 'cancel', 'deny'), required=True)
    run_command.add_argument('--case-id', help='One frozen case; required for a multicase campaign')
    args = parser.parse_args()
    try:
        return prepare(args) if args.operation == 'prepare' else run(args)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({'passed': False, 'error': str(error)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
