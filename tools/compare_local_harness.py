"""Run six frozen paired repairs through stock Codex and the public local router.

No downloads, cloud destinations, quality retries or qualification installation.
Supply an existing setup-v5 profile and its already verified runtime/model files.
"""
import argparse
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import tomllib

from hormuz._contract_schemas.local_coding import canonical_digest, coding_input
from hormuz.coding_qualification import request_profile_digest
from hormuz.contracts import validate_contract
from hormuz.local_harness import MODEL, PROFILES
from hormuz.work_learning import request_characteristics

DEVELOPER = ('Repair only solution.py in the working directory. Read it before editing, '
             'implement the complete user specification, and run your own relevant checks. '
             'Use the existing host tools. Do not inspect files outside this working directory. '
             'Finish with a concise factual status. Do not access the network.')


def digest_file(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def stop(process):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            continue
    process.wait(timeout=2)


def reset_project(project, source):
    """Each paired episode starts with the same sole frozen source file."""
    for path in project.iterdir():
        if path.is_symlink() or not path.is_dir():
            path.unlink()
        else:
            shutil.rmtree(path)
    (project / 'solution.py').write_text(source)


def independent_check(checks, solution, *, python, environment, timeout=4):
    """Retain checker errors and timeouts; no generated-code failure aborts a study."""
    if solution.is_symlink() or not solution.is_file():
        return {'exit_code': 2, 'termination': 'missing_source', 'stdout': '', 'stderr': 'Missing regular source file'}
    timed_out = False
    runner = ('import resource,runpy,sys\n'
              'resource.setrlimit(resource.RLIMIT_CPU,(2,2))\n'
              'resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))\n'
              'resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))\n'
              'sys.argv=sys.argv[1:]\nrunpy.run_path(sys.argv[0],run_name="__main__")\n')
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(['/usr/bin/sandbox-exec', '-p',
            '(version 1)(allow default)(deny network*)(deny file-write*)',
            str(python), '-I', '-B', '-c', runner, str(checks), str(solution)],
            cwd=solution.parent, env=environment, stdin=subprocess.DEVNULL,
            stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        finally:
            stop(process)
        stdout.seek(0)
        stderr.seek(0)
        return {'exit_code': process.returncode, 'termination': 'timeout' if timed_out else 'completed',
                'stdout': stdout.read(8192).decode('utf-8', 'replace'),
                'stderr': stderr.read(8192).decode('utf-8', 'replace')}


class Comparison:
    def __init__(self, args):
        self.args = args
        self.root = args.output.resolve()
        self.root.mkdir(mode=0o700, parents=False, exist_ok=False)
        self.project = self.root / 'project'
        self.client_home = self.root / 'home/.codex'
        for path in (self.project, self.client_home, self.root / 'tmp', self.root / 'checks', self.root / 'runs'):
            path.mkdir(mode=0o700, parents=True)
        workspace = next((path for path in (self.project, *self.project.parents)
                          if (path / '.git').exists()), self.project)
        self.original = ('personality = "none"\n\n[projects.' + json.dumps(str(workspace)) +
                         ']\ntrust_level = "trusted"\n')
        (self.client_home / 'config.toml').write_text(self.original)
        self.package = Path(__import__('hormuz').__file__).resolve().parent.parent
        # Do not inherit the desktop's originator, parent conversation or tool
        # environment into an independent native Codex exec episode.
        self.env = {'PATH': os.environ.get('PATH', '/opt/homebrew/bin:/usr/bin:/bin'),
                    'LANG': 'en_US.UTF-8',
                    'HOME': str(self.root / 'home'), 'CODEX_HOME': str(self.client_home),
                    'TMPDIR': str(self.root / 'tmp'), 'PYTHONPATH': str(self.package),
                    'PYTHONDONTWRITEBYTECODE': '1', 'OTEL_SDK_DISABLED': 'true'}
        for name in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL'):
            self.env.pop(name, None)
        self.cases_path = Path(__file__).with_name('local_harness_cases.json')
        self.cases = json.loads(self.cases_path.read_text())['cases']
        self.profile = json.loads(args.profile.read_text())
        if self.profile['schema_version'] != 5 or self.profile['model'] != MODEL:
            raise ValueError('Requires the installed Qwen3-14B setup-v5 profile')
        self.profile['coding_evidence'] = None
        self.profile['capabilities'] = [cap for cap in self.profile['capabilities'] if cap not in PROFILES]
        self.profile['task_types'] = ['code_change']
        self.harnesses = {'baseline': None if args.baseline_harness == 'none' else 'qwen-code.' + args.baseline_harness,
                          'adapted': 'qwen-code.' + args.harness}
        self.episode_seconds = getattr(args, 'episode_seconds', 90)
        self.probe_version = 5 if self.episode_seconds == 180 else 4
        selected = set(args.case or [])
        if selected - {case['id'] for case in self.cases}:
            raise ValueError('Unknown diagnostic case')
        self.selected_cases = [case for case in self.cases if not selected or case['id'] in selected]
        if self.probe_version == 5 and any(self.harnesses[arm] is None for arm, _ in self.schedule()):
            raise ValueError('180-second development probes require an explicit harness in every selected arm')
        self.generation = None
        self.ports = []
        self.rows = []
        self.cleanup = []
        self.config = None
        self.capture = None

    def cli(self, *arguments, timeout=90):
        result = subprocess.run([sys.executable, '-m', 'koto', '--config', str(self.config), *arguments],
            env=self.env, cwd=self.root, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        return json.loads(result.stdout)

    def connect(self, arm):
        self.config = self.root / (arm + '-gateway.json')
        profile = {**self.profile, 'capabilities': self.capabilities(arm),
                   'qualification_id': 'qwen-code-comparison-' + arm}
        validate_contract(profile)
        path = self.root / (arm + '-setup.json')
        write(path, profile)
        receipt = self.cli('client', 'setup', 'codex', '--client-home', str(self.client_home),
            '--executable', str(self.args.client), '--qualification', str(path),
            '--runtime-archive', str(self.args.runtime_archive),
            '--llama-executable', str(self.args.llama), '--model-file', str(self.args.model_file))
        self.generation = receipt['connection']['generation']
        self.ports = [receipt['configuration']['listen_port'], receipt['configuration']['runtime_port']]
        configured = json.loads(self.config.read_text())
        if (configured['route_admission']['mode'] != 'local_only'
                or any(u['locality'] != 'local' for u in configured['upstreams'].values())):
            raise RuntimeError('Comparison requires local-only execution')
        settings = tomllib.loads((self.client_home / 'config.toml').read_text())
        self.provider = settings['model_provider']
        state = self.cli('client', 'status', 'codex', '--client-home', str(self.client_home), '--routing')
        if any(row.get('automatic_task_types') for row in state['routes']):
            raise RuntimeError('Comparison cannot grant automatic coding')
        write(self.root / (arm + '-readiness.json'), state)
        print('Ready locally: ' + arm + ', model=' + MODEL + ', automatic coding disabled', flush=True)

    def capabilities(self, arm):
        return self.profile['capabilities'] + [cap for cap, profile in PROFILES.items()
                                              if profile == self.harnesses[arm]]

    def schedule(self):
        if self.args.arm != 'both':
            return [(self.args.arm, self.selected_cases)]
        return [(arm, cases) for arm, cases in [('baseline', self.selected_cases[:3]),
            ('adapted', self.selected_cases), ('baseline', self.selected_cases[3:])] if cases]

    def disconnect(self):
        if self.config is None:
            return
        args = ['client', 'disconnect', 'codex', '--client-home', str(self.client_home)]
        if self.generation:
            args += ['--generation', self.generation]
        self.cli(*args, timeout=25)
        restored = (self.client_home / 'config.toml').read_text() == self.original
        closed = True
        for port in self.ports:
            with socket.socket() as connection:
                connection.settimeout(0.5)
                closed &= connection.connect_ex(('127.0.0.1', port)) != 0
        self.cleanup.append({'settings_restored': restored, 'owned_listeners_closed': closed})
        self.generation = None
        self.config = None
        if not restored or not closed:
            raise RuntimeError('Owned connection cleanup failed')

    def launch(self, case, label, *, base_url=None, probe=None, timeout=90):
        command = [str(self.args.client), 'exec', '--skip-git-repo-check', '--ephemeral', '--json',
            '--sandbox', 'workspace-write', '-c', 'approval_policy="never"',
            '-c', 'agents.enabled=false', '--disable', 'multi_agent', '--disable', 'multi_agent_v2',
            '--disable', 'goals', '--disable', 'apps', '--disable', 'plugins',
            '--disable', 'shell_snapshot', '-c', 'web_search="disabled"',
            '-c', 'sandbox_workspace_write.network_access=false',
            '-c', 'sandbox_workspace_write.exclude_slash_tmp=true',
            '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
            '-c', 'model_reasoning_summary="none"', '-c', 'model_reasoning_effort="none"',
            '-c', 'developer_instructions=' + json.dumps(DEVELOPER),
            '-c', 'analytics.enabled=false', '-C', str(self.project)]
        if base_url:
            command += ['-c', 'model_providers.' + self.provider + '.base_url=' + json.dumps(base_url)]
        if probe:
            command += ['-c', 'model_providers.' + self.provider +
                        '.http_headers={"X-Hormuz-Qualification-Probe"=' + json.dumps(probe) + '}']
        command.append(case['goal'])
        started = time.monotonic()
        timed_out = False
        with (self.root / 'runs' / (label + '.jsonl')).open('w') as stdout, \
             (self.root / 'runs' / (label + '.stderr')).open('w') as stderr:
            process = subprocess.Popen(command, cwd=self.project, env=self.env,
                stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
            finally:
                stop(process)
        events = []
        for line in (self.root / 'runs' / (label + '.jsonl')).read_text().splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
        tool_items = [event.get('item', {}) for event in events
                      if event.get('type') == 'item.completed']
        rejected_patches = [line.split('error=apply_patch verification failed:', 1)[1].strip()[:4096]
                            for line in (self.root / 'runs' / (label + '.stderr')).read_text().splitlines()
                            if 'error=apply_patch verification failed:' in line]
        return {'client_exit_code': process.returncode,
                'termination': 'timeout' if timed_out else 'completed',
                'elapsed_ms': int((time.monotonic() - started) * 1000),
                'turn_completed': any(event.get('type') == 'turn.completed' for event in events),
                'executed_commands': [{'command': item['command'], 'exit_code': item.get('exit_code'),
                                       'output': item.get('aggregated_output', '')[:8192]}
                                      for item in tool_items if item.get('type') == 'command_execution'],
                'rejected_native_patches': rejected_patches,
                'tool_calls': sum(item.get('type') in {'command_execution', 'mcp_tool_call', 'file_change'}
                                  for item in tool_items),
                'tool_errors': len(rejected_patches) + sum(item.get('status') == 'failed'
                    or item.get('exit_code', 0) not in (None, 0) for item in tool_items)}

    def check(self, case):
        path = self.root / 'checks' / (case['id'] + '.py')
        return independent_check(path, self.project / 'solution.py', python=sys.executable, environment=self.env)

    def freeze(self):
        pins = {name: {'path': str(path), 'sha256': digest_file(path)} for name, path in (
            ('client', self.args.client), ('runtime_archive', self.args.runtime_archive),
            ('llama', self.args.llama), ('model', self.args.model_file))}
        if pins['model']['sha256'] != self.profile['model_sha256']:
            raise ValueError('Installed model changed')
        artifacts = {str(path): digest_file(path) for path in [Path(__file__).resolve(), self.cases_path,
                     *sorted((self.package / 'hormuz').rglob('*.py'))]}
        for case in self.cases:
            if request_characteristics({'input': case['goal']})['task_hint'] != 'code_change':
                raise ValueError('Case must use the existing explicit coding admission vocabulary')
            body = ('p=importlib.util.spec_from_file_location("solution",sys.argv[1])\n'
                    's=importlib.util.module_from_spec(p)\np.loader.exec_module(s)\n' + case['checks'])
            code = ('import importlib.util,sys,traceback\ntry:\n' + textwrap.indent(body, '    ') +
                    'except AssertionError:\n    traceback.print_exc()\n    sys.exit(1)\n'
                    'except BaseException:\n    traceback.print_exc()\n    sys.exit(2)\n')
            path = self.root / 'checks' / (case['id'] + '.py')
            path.write_text(code)
            reset_project(self.project, case['source'])
            case['baseline_check'] = self.check(case)
            if case['baseline_check']['exit_code'] != 1 or case['baseline_check']['termination'] != 'completed':
                raise ValueError('Baseline must fail an independent assertion: ' + case['id'])
            case['checks_sha256'] = digest_file(path)
        plan = {'schema_version': 1, 'model': MODEL, 'pins': pins, 'artifacts': artifacts,
                'cases': self.cases, 'developer_instructions': DEVELOPER,
                'max_episode_seconds': self.episode_seconds, 'probe_schema_version': self.probe_version,
                'max_requests': 16, 'quality_retries': 0,
                'harnesses': self.harnesses,
                'study_kind': 'paired_comparison' if self.args.arm == 'both' and not self.args.case else 'diagnostic',
                'order': [{'arm': arm, 'case_ids': [case['id'] for case in cases]}
                          for arm, cases in self.schedule()],
                'automatic_admission_effect': 'none'}
        write(self.root / 'frozen-plan.json', plan)
        return plan

    def episode(self, case, arm, plan):
        reset_project(self.project, case['source'])
        self.capture = None
        self.launch(case, arm + '-' + case['id'] + '-capture',
            base_url='http://127.0.0.1:' + str(self.server.server_port) + '/v1', timeout=25)
        if self.capture is None:
            raise RuntimeError('No native request captured before inference')
        captured = self.capture
        if captured.get('model') != MODEL:
            raise RuntimeError('Native model selection drift')
        write(self.root / 'runs' / (arm + '-' + case['id'] + '-request.json'), captured)
        subject = {'client_version': self.profile['client_version'], 'system': self.profile['system'],
            'machine': self.profile['machine'], 'runtime_profile': 'managed-llama.v2',
            'runtime_sha256': self.profile['runtime_sha256'],
            'model_revision': 'sha256:' + self.profile['model_sha256'], 'upstream_model': MODEL,
            'protocol': 'openai', 'capabilities': self.capabilities(arm),
            'max_request_bytes': self.profile['max_request_bytes'],
            'max_output_tokens': self.profile['max_output_tokens'],
            'upstream_timeout_seconds': self.profile['upstream_timeout_seconds'],
            'request_profile_sha256': request_profile_digest(captured, schema_version=4)}
        probe = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': self.probe_version,
            'campaign_id': 'qwen-code-' + self.args.harness, 'plan_sha256': canonical_digest(plan),
            'case_id': case['id'], 'task_sha256': canonical_digest({'goal': case['goal'], 'source': case['source']}),
            'checks_sha256': case['checks_sha256'], 'model': MODEL,
            'first_input_sha256': canonical_digest(coding_input(captured['input'], schema_version=4)),
            'max_requests': 16, 'max_elapsed_seconds': self.episode_seconds, 'subject': subject}
        validate_contract(probe)
        probe_path = self.root / 'active-probe.json'
        write(probe_path, probe)
        armed = self.cli('client', 'qualify', 'codex', '--client-home', str(self.client_home),
                         '--plan', str(probe_path))
        try:
            native = self.launch(case, arm + '-' + case['id'], probe=armed['probe_id'], timeout=self.episode_seconds)
            permission = self.cli('client', 'qualify', 'codex', '--client-home', str(self.client_home))
        finally:
            self.cli('client', 'qualify', 'codex', '--client-home', str(self.client_home), '--revoke')
        if permission['submitted_requests'] == 0:
            raise RuntimeError('Native episode was rejected before any model submission; inspect retained logs')
        path = self.project / 'solution.py'
        source = path.read_text() if path.is_file() and not path.is_symlink() else None
        changed = source is not None and source != case['source']
        checked = self.check(case)
        row = {'case_id': case['id'], 'arm': arm, 'harness': self.harnesses[arm], 'model': MODEL, **native,
               'implementation_changed': changed, 'check_exit_code': checked['exit_code'],
               'independent_check': checked, 'baseline_exit_code': case['baseline_check']['exit_code'],
               'checks_unchanged': digest_file(self.root / 'checks' / (case['id'] + '.py')) == case['checks_sha256'],
               'request_profile_sha256': subject['request_profile_sha256'],
               'submitted_requests': permission['submitted_requests']}
        row['passed'] = (changed and checked['exit_code'] == 0 and checked['termination'] == 'completed'
                         and row['checks_unchanged'] and native['turn_completed']
                         and native['client_exit_code'] == 0 and native['termination'] == 'completed')
        self.rows.append(row)
        if source is not None:
            (self.root / 'runs' / (arm + '-' + case['id'] + '-solution.py')).write_text(source)
        shutil.copytree(self.project, self.root / 'runs' / (arm + '-' + case['id'] + '-workspace'), symlinks=True)
        write(self.root / 'outcomes.json', self.rows)
        print(arm + ' / ' + case['id'] + ': ' + ('PASS' if row['passed'] else 'FAIL') +
              ', ' + str(native['elapsed_ms']) + ' ms, requests=' + str(row['submitted_requests']), flush=True)

    def run(self):
        comparison = self
        class Capture(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def setup(self):
                super().setup()
                self.connection.settimeout(5)
            def do_POST(self):
                size = int(self.headers.get('Content-Length', '0'))
                if self.path != '/v1/responses' or not 0 < size <= comparison.profile['max_request_bytes']:
                    self.send_error(413)
                    return
                comparison.capture = json.loads(self.rfile.read(size))
                self.send_error(400, 'Intentional zero-inference native request capture')
        plan = self.freeze()
        normal = Path.home() / '.codex/config.toml'
        before = digest_file(normal) if normal.exists() else None
        report = {'frozen_plan_sha256': canonical_digest(plan), 'harnesses': self.harnesses,
                  'study_kind': plan['study_kind'], 'outcomes': self.rows}
        self.server = None
        thread = None
        try:
            self.server = HTTPServer(('127.0.0.1', 0), Capture)
            thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.1})
            thread.start()
            for arm, cases in self.schedule():
                try:
                    self.connect(arm)
                    for case in cases:
                        self.episode(case, arm, plan)
                finally:
                    self.disconnect()
            for arm in ('baseline', 'adapted'):
                rows = [row for row in self.rows if row['arm'] == arm]
                if not rows:
                    continue
                report[arm] = {'passed': sum(row['passed'] for row in rows), 'total': len(rows),
                               'median_elapsed_ms': statistics.median(row['elapsed_ms'] for row in rows),
                               'tool_errors': sum(row['tool_errors'] for row in rows)}
            report['same_native_profiles'] = (all(len({row['request_profile_sha256'] for row in self.rows
                if row['case_id'] == case['id']}) == 1 for case in self.selected_cases)
                if self.args.arm == 'both' else None)
        except BaseException as error:
            report['error'] = str(error)
            raise
        finally:
            if self.server is not None:
                if thread is not None and thread.ident is not None:
                    self.server.shutdown()
                    thread.join(timeout=3)
                self.server.server_close()
            report['cleanup'] = self.cleanup
            report['normal_settings_unchanged'] = (digest_file(normal) if normal.exists() else None) == before
            report['frozen_artifacts_unchanged'] = all(digest_file(path) == expected
                for path, expected in plan['artifacts'].items())
            write(self.root / 'comparison.json', report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('output', 'profile', 'client', 'runtime-archive', 'llama', 'model-file'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--harness', choices=('v1', 'v2'), default='v1')
    parser.add_argument('--baseline-harness', choices=('none', 'v1', 'v2'), default='none')
    parser.add_argument('--case', action='append', help='Limit a diagnostic run; all six cases remain frozen')
    parser.add_argument('--arm', choices=('both', 'baseline', 'adapted'), default='both')
    parser.add_argument('--episode-seconds', type=int, choices=(90, 180), default=90,
                        help='180 selects the explicit development probe; older probes remain capped at 90')
    args = parser.parse_args()
    args.output = args.output.absolute()
    for name in ('profile', 'client', 'runtime_archive', 'llama', 'model_file'):
        setattr(args, name, getattr(args, name).resolve(strict=True))
    Comparison(args).run()


if __name__ == '__main__':
    main()
