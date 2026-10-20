"""DEBUG: pinned native patch rejection/feedback replay, with zero model inference.

Scripted localhost Responses provider sends a range-header patch, observes the
real Codex rejection in its next request, then sends the same patch with plain
@@. The adapter must preserve the actual error output verbatim. No normal Codex
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
GOOD = ('*** Begin Patch\n*** Update File: solution.py\n@@\n'
        '-    return value\n+    return value + 1\n*** End Patch')
BAD = GOOD.replace('\n@@\n', '\n@@ -1,2 +1,2 @@\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def run(client, output):
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    home, project = output / 'home', output / 'project'
    home.mkdir(mode=0o700)
    project.mkdir(mode=0o700)
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
                    if item.get('type') != 'custom_tool_call_output':
                        continue
                    matching = [converted for converted in adapter.value['input']
                        if converted.get('type') == 'function_call_output'
                        and converted.get('call_id') == item['call_id']]
                    if len(matching) != 1 or matching[0].get('output') != item.get('output'):
                        raise AssertionError('Actual native patch output was altered or dropped')
                    feedback.append({'request': len(requests), 'call_id': item['call_id'],
                        'native_type': item['type'], 'translated_type': matching[0]['type'],
                        'exact_output_preserved': True, 'output': item['output']})
                if len(requests) == 2:
                    actual = [row for row in feedback if row['call_id'] == 'patch-bad']
                    if len(actual) != 1 or "Failed to find context '-1,2 +1,2 @@'" not in actual[0]['output']:
                        raise AssertionError('Actual pinned native range-header error not captured')
                    if (project / 'solution.py').read_text() != SOURCE:
                        raise AssertionError('Rejected patch changed source')
                if len(requests) == 3:
                    actual = [row for row in feedback if row['call_id'] == 'patch-good']
                    if len(actual) != 1 or 'Success.' not in actual[0]['output']:
                        raise AssertionError('Successful native plain-header feedback not captured')
                if len(requests) < 3:
                    item = {'type': 'function_call', 'id': 'fc-' + str(len(requests)),
                        'call_id': 'patch-bad' if len(requests) == 1 else 'patch-good',
                        'name': 'apply_patch', 'status': 'completed', 'arguments':
                        json.dumps({'input': BAD if len(requests) == 1 else GOOD})}
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
        environment = {'HOME': str(home), 'CODEX_HOME': str(home),
            'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'LANG': 'en_US.UTF-8', 'OTEL_SDK_DISABLED': 'true'}
        version = subprocess.run([str(client), '--version'], env=environment, cwd=project,
            capture_output=True, text=True, check=True, timeout=3).stdout.strip()
        if version != 'codex-cli 0.160.0':
            raise RuntimeError('Requires the pinned native Codex 0.160.0')
        command = [str(client), 'exec', '--skip-git-repo-check', '--ephemeral', '--json',
            '--sandbox', 'workspace-write', '-c', 'approval_policy="never"',
            '--disable', 'apps', '--disable', 'plugins', '--disable', 'multi_agent',
            '--disable', 'multi_agent_v2', '--disable', 'goals', '--disable', 'shell_snapshot',
            '-c', 'model_reasoning_effort="none"', '-c', 'model_reasoning_summary="none"',
            '-c', 'web_search="disabled"', '-c', 'analytics.enabled=false',
            '-C', str(project), 'Fix the Python function in solution.py to return value plus one.']
        with (output / 'native.jsonl').open('w') as stdout, (output / 'native.stderr').open('w') as stderr:
            process = subprocess.Popen(command, cwd=project, env=environment, stdin=subprocess.DEVNULL,
                stdout=stdout, stderr=stderr, start_new_session=True)
            process.wait(timeout=30)
        events = [json.loads(line) for line in (output / 'native.jsonl').read_text().splitlines()]
        result = {'passed': not errors and len(requests) == 3 and process.returncode == 0
            and any(event['type'] == 'turn.completed' for event in events)
            and (project / 'solution.py').read_text() == SOURCE.replace('return value', 'return value + 1')
            and normal_before == digest(normal), 'model_inference_submissions': 0,
            'client_version': version, 'client_exit_code': process.returncode,
            'requests': len(requests), 'errors': errors, 'catalog_requests': gets,
            'source_after': (project / 'solution.py').read_text(),
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
    args = parser.parse_args()
    raise SystemExit(run(args.client.resolve(strict=True), args.output.absolute()))
