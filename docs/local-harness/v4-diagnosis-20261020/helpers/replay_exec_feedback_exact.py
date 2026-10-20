"""DEBUG: pinned native command failure/success feedback, zero model inference.

Scripted localhost Responses provider sends the recorded malformed command from
the stock episode, then a successful literal Python heredoc. It captures native
exit-status envelopes and verifies lossless transport of both. No normal Codex
settings are used. Run only when the serial real-model study has completed.
"""
import argparse
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, HTTPServer
import hashlib
import json
import os
from pathlib import Path
import signal
import shlex
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

from hormuz.codex_catalog import qualified_models
from hormuz.codex_llama import CodexLlamaRequest
from hormuz.connected_client import _provider_block


MODEL = 'Qwen3-14B-Q4_K_M'
SOURCE = 'def example(value):\n    return value\n'
GOOD = "python3 - <<'PY'\nvalues = [1, 2]\nassert values[0] == 1\nassert sum(values) == 3\nprint('SCRIPTED_ASSERTIONS_EXECUTED')\nPY"
PYTHON_SCRIPT = 'values = [1, 2]\nassert values[0] == 1\nassert sum(values) == 3\nprint("SCRIPTED_ASSERTIONS_EXECUTED")'
DEVELOPER = ('Repair only solution.py in the working directory. Read it before editing, '
             'implement the complete user specification, and run your own relevant checks. '
             'Use the existing host tools. Do not inspect files outside this working directory. '
             'Finish with a concise factual status. Do not access the network.')


def recorded_bad_command(comparison):
    rows = json.loads(comparison.read_text())['outcomes']
    row = next(row for row in rows if row['arm'] == 'adapted' and row['case_id'] == 'atomic-stock')
    command = row['executed_commands'][1]
    if command['exit_code'] != 1 or "parse error near" not in command['output']:
        raise ValueError('Expected the recorded native malformed quoting failure')
    words = shlex.split(command['command'])
    if len(words) != 3 or words[:2] != ['/bin/zsh', '-lc']:
        raise ValueError('Expected pinned native zsh wrapping')
    return words[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def run(client, output, comparison, check_style):
    bad_command = recorded_bad_command(comparison)
    good_command = GOOD if check_style == 'heredoc' else 'python3 -c ' + shlex.quote(PYTHON_SCRIPT)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    home, project = output / 'home', output / 'project'
    home.mkdir(mode=0o700)
    project.mkdir(mode=0o700)
    temporary = output / 'tmp'
    temporary.mkdir(mode=0o700)
    (project / 'solution.py').write_text(SOURCE)
    normal = Path.home() / '.codex/config.toml'
    normal_before = digest(normal)
    config = SimpleNamespace(model_routes={MODEL: SimpleNamespace(capabilities=[
        'responses', 'text', 'streaming', 'tools', 'codex_http', 'codex_http_0160',
        'codex_llama_v1', 'qwen_code_v2'])},
        route_admission=SimpleNamespace(local_routes={MODEL: None}),
        managed_llama=SimpleNamespace(route=MODEL, schema_version=3))
    catalog = qualified_models(config, [MODEL])
    requests, errors, gets, feedback = [], [], [], []

    class Provider(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_):
            pass

        def do_GET(self):
            gets.append(self.path)
            data = json.dumps({'object': 'list', 'models': catalog,
                'data': [{'id': MODEL, 'object': 'model', 'owned_by': 'local'}]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            try:
                size = int(self.headers.get('Content-Length', 0))
                if self.path != '/v1/responses' or not 0 < size <= 256 * 1024 or len(requests) >= 3:
                    self.send_error(400, 'Bounded zero-inference native feedback fixture')
                    return
                raw = json.loads(self.rfile.read(size))
                original = deepcopy(raw)
                adapter = CodexLlamaRequest(raw, harness='qwen-code.v2')
                if raw != original:
                    raise AssertionError('Native input mutated by translation')
                requests.append(raw)
                for item in raw.get('input', []):
                    if item.get('type') != 'function_call_output':
                        continue
                    matching = [converted for converted in adapter.value['input']
                        if converted.get('type') == 'function_call_output'
                        and converted.get('call_id') == item['call_id']]
                    if len(matching) != 1 or matching[0].get('output') != item.get('output'):
                        raise AssertionError('Actual native command output was altered or dropped')
                    feedback.append({'request': len(requests), 'call_id': item['call_id'],
                        'native_type': item['type'], 'translated_type': matching[0]['type'],
                        'exact_output_preserved': True, 'output': item['output']})
                if len(requests) == 2:
                    actual = [row for row in feedback if row['call_id'] == 'command-bad']
                    if len(actual) != 1 or 'Process exited with code 1\n' not in actual[0]['output'] or 'parse error near' not in actual[0]['output']:
                        raise AssertionError('Actual pinned native shell parse error not captured')
                    if (project / 'solution.py').read_text() != SOURCE:
                        raise AssertionError('Scripted shell failure changed source')
                if len(requests) == 3:
                    actual = [row for row in feedback if row['call_id'] == 'command-good']
                    if len(actual) != 1:
                        raise AssertionError('Actual native diagnostic command feedback not captured')
                if len(requests) < 3:
                    item = {'type': 'function_call', 'id': 'fc-' + str(len(requests)),
                        'call_id': 'command-bad' if len(requests) == 1 else 'command-good',
                        'name': 'exec_command', 'status': 'completed', 'arguments':
                        json.dumps({'cmd': bad_command if len(requests) == 1 else good_command,
                                    'yield_time_ms': 1000, 'max_output_tokens': 1000})}
                else:
                    item = {'type': 'message', 'id': 'msg-done', 'role': 'assistant',
                        'status': 'completed', 'content': [{'type': 'output_text',
                        'text': 'SCRIPTED_FEEDBACK_REPLAY_FINISHED', 'annotations': []}]}
                response = {'id': 'resp-' + str(len(requests)), 'object': 'response',
                    'created_at': int(time.time()), 'model': MODEL, 'status': 'completed',
                    'output': [item], 'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}
                events = [{'type': 'response.created',
                    'response': {**response, 'status': 'in_progress', 'output': []}}]
                if item['type'] == 'function_call':
                    events.extend([{'type': 'response.output_item.added', 'output_index': 0,
                        'item': {**item, 'arguments': '', 'status': 'in_progress'}},
                        {'type': 'response.function_call_arguments.done', 'item_id': item['id'],
                        'output_index': 0, 'arguments': item['arguments']}])
                events.extend([{'type': 'response.output_item.done', 'output_index': 0, 'item': item},
                    {'type': 'response.completed', 'response': response}])
                wire = b''.join(b'data: ' + json.dumps(event).encode() + b'\n\n' for event in events)
                translated = adapter.feed(wire, event_stream=True, final=True)
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Content-Length', str(len(translated)))
                self.end_headers()
                self.wfile.write(translated)
            except Exception as error:
                errors.append(type(error).__name__ + ': ' + str(error))
                self.send_error(500, 'Native feedback fixture failed')

    server = HTTPServer(('127.0.0.1', 0), Provider)
    thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05})
    thread.start()
    process = None
    try:
        origin = 'http://127.0.0.1:' + str(server.server_port)
        helper = output / 'synthetic_token.py'
        helper.write_text('print("synthetic-local-only")\n')
        settings = ('model = ' + json.dumps(MODEL) + '\nmodel_provider = "koto_debug"\n'
            'personality = "none"\n[projects.' + json.dumps(str(project)) + ']\ntrust_level = "trusted"\n')
        (home / 'config.toml').write_text(settings + _provider_block('koto_debug', origin,
            helper={'command': sys.executable, 'entrypoint': str(helper), 'home': str(home)},
            generation='0' * 32, client_version='0.160.0'))
        environment = {'HOME': str(home), 'CODEX_HOME': str(home), 'TMPDIR': str(temporary),
            'PATH': os.environ.get('PATH', '/opt/homebrew/bin:/usr/bin:/bin'),
            'LANG': 'en_US.UTF-8', 'OTEL_SDK_DISABLED': 'true', 'PYTHONDONTWRITEBYTECODE': '1'}
        version = subprocess.run([str(client), '--version'], env=environment, cwd=project,
            capture_output=True, text=True, check=True, timeout=3).stdout.strip()
        if version != 'codex-cli 0.160.0':
            raise RuntimeError('Requires the pinned native Codex 0.160.0')
        command = [str(client), 'exec', '--skip-git-repo-check', '--ephemeral', '--json',
            '--sandbox', 'workspace-write', '-c', 'approval_policy="never"',
            '-c', 'agents.enabled=false',
            '--disable', 'apps', '--disable', 'plugins', '--disable', 'multi_agent',
            '--disable', 'multi_agent_v2', '--disable', 'goals', '--disable', 'shell_snapshot',
            '-c', 'model_reasoning_effort="none"', '-c', 'model_reasoning_summary="none"',
            '-c', 'web_search="disabled"', '-c', 'analytics.enabled=false',
            '-c', 'sandbox_workspace_write.network_access=false',
            '-c', 'sandbox_workspace_write.exclude_slash_tmp=true',
            '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
            '-c', 'developer_instructions=' + json.dumps(DEVELOPER),
            '-C', str(project), 'Run the supplied diagnostic commands in this disposable project.']
        with (output / 'native.jsonl').open('w') as stdout, (output / 'native.stderr').open('w') as stderr:
            process = subprocess.Popen(command, cwd=project, env=environment, stdin=subprocess.DEVNULL,
                stdout=stdout, stderr=stderr, start_new_session=True)
            process.wait(timeout=30)
        events = [json.loads(line) for line in (output / 'native.jsonl').read_text().splitlines()]
        execution = [row for row in feedback if row['call_id'] == 'command-good']
        command_success = (len(execution) == 1 and 'Process exited with code 0\n' in execution[0]['output']
                           and 'SCRIPTED_ASSERTIONS_EXECUTED' in execution[0]['output'])
        result = {'passed': not errors and len(requests) == 3 and process.returncode == 0
            and command_success
            and any(event['type'] == 'turn.completed' for event in events)
            and (project / 'solution.py').read_text() == SOURCE
            and normal_before == digest(normal), 'model_inference_submissions': 0,
            'client_version': version, 'client_exit_code': process.returncode,
            'requests': len(requests), 'errors': errors, 'catalog_requests': gets,
            'source_after': (project / 'solution.py').read_text(),
            'check_style': check_style, 'command_success': command_success,
            'sandbox_flags': [item for item in command if item.startswith('sandbox_workspace_write.')],
            'tmpdir': str(temporary), 'developer_instructions': DEVELOPER,
            'normal_settings_unchanged': normal_before == digest(normal), 'feedback': feedback}
        print(json.dumps({key: value for key, value in result.items() if key != 'feedback'}, indent=2))
        return 0 if result['passed'] else 1
    finally:
        if process is not None and process.poll() is None:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, sig)
                    process.wait(timeout=2)
                    break
                except ProcessLookupError:
                    break
                except subprocess.TimeoutExpired:
                    continue
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()
        (output / 'requests.json').write_text(json.dumps(requests, indent=2) + '\n')
        (output / 'feedback.json').write_text(json.dumps(feedback, indent=2) + '\n')
        if 'result' in locals():
            (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        (output / 'errors.json').write_text(json.dumps(errors, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--comparison', type=Path, required=True)
    parser.add_argument('--check-style', choices=('heredoc', 'literal-c'), required=True)
    args = parser.parse_args()
    raise SystemExit(run(args.client.resolve(strict=True), args.output.absolute(), args.comparison.resolve(strict=True), args.check_style))
