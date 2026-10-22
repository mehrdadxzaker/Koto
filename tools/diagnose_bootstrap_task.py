"""Temporary bounded engine diagnostic for the retained clean-Mac task failure."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.request import Request

import hormuz
from hormuz.codex_llama import CodexLlamaRequest
from hormuz.local_transport import open_local_upstream
from hormuz.managed_llama import ManagedLlamaProfile, runtime_arguments


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--executable', required=True)
    parser.add_argument('--device', choices=['auto', 'cpu'], default='auto')
    args = parser.parse_args()
    root = args.workspace.absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    environment = {**os.environ, 'CODEX_HOME': str(root / 'unused-client-home'),
                   'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data')}
    for name in ('KOTO_CONFIG', 'HORMUZ_CONFIG', 'PYTHONPATH'):
        environment.pop(name, None)
    report = {'device': args.device, 'passed': False, 'retried': False}
    process = None
    try:
        catalog = Path(hormuz.__file__).parent / 'local-acquisition-codex-0160-llama-b11617-qwen3-4b-text-v1.json'
        acquired = subprocess.run([sys.executable, '-m', 'koto', 'client', 'acquire', 'codex',
            '--catalog', str(catalog), '--directory', str(root / 'assets'), '--executable', args.executable,
            '--download'], cwd=root, env=environment, capture_output=True, timeout=1800)
        (root / 'acquire.stdout').write_bytes(acquired.stdout)
        (root / 'acquire.stderr').write_bytes(acquired.stderr)
        acquired.check_returncode()
        ready = json.loads(acquired.stdout)
        setup = dict(zip(ready['setup_arguments'][::2], ready['setup_arguments'][1::2]))
        declared = json.loads(Path(setup['--qualification']).read_text())
        with socket.socket() as endpoint:
            endpoint.bind(('127.0.0.1', 0))
            port = endpoint.getsockname()[1]
        profile = ManagedLlamaProfile(route=declared['model'], executable=setup['--llama-executable'],
            runtime_archive=setup['--runtime-archive'], runtime_sha256=declared['runtime_sha256'],
            model_file=setup['--model-file'], model_sha256=declared['model_sha256'],
            startup_timeout_seconds=declared['startup_timeout_seconds'], port=port, alias=declared['model'],
            output_tokens=declared['max_output_tokens'], schema_version=5, context_tokens=declared['context_tokens'])
        command = runtime_arguments(profile)
        if args.device == 'cpu':
            command.extend(['--n-gpu-layers', '0'])
        (root / 'runtime-argv.json').write_text(json.dumps(command, indent=2))
        report['installed_package'] = hormuz.__file__
        with (root / 'engine.log').open('wb') as log:
            started = time.monotonic()
            process = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            marker = f'llama_server: listening on http://127.0.0.1:{port}'.encode()
            while time.monotonic() - started < profile.startup_timeout_seconds:
                if process.poll() is not None:
                    raise RuntimeError('Engine exited during startup')
                if marker in (root / 'engine.log').read_bytes():
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError('Original startup deadline reached')
            report['startup_seconds'] = round(time.monotonic() - started, 3)
            prompt = ('Extract the responsible person and deadline from this handoff note. '
                'Return only a JSON object with keys "owner" and "due_date" (YYYY-MM-DD), without markdown. '
                'Note: Rina will deliver the demo by November 3, 2026. Lee is keeping the old archive. /no_think')
            body = CodexLlamaRequest({'model': declared['model'], 'stream': False, 'store': False,
                'input': prompt, 'max_output_tokens': 512, 'reasoning': {'effort': 'low'}}).value
            (root / 'translated-fixture-request.json').write_text(json.dumps(body, indent=2))
            started = time.monotonic()
            request = Request(f'http://127.0.0.1:{port}/v1/responses', data=json.dumps(body).encode(),
                              headers={'Content-Type': 'application/json'})
            try:
                with open_local_upstream(request, timeout=4, absolute_timeout=90, response_timeout=90) as response:
                    report['http_status'] = response.status
                    payload = response.read(2 * 1024**2 + 1)
                (root / 'original-task-response.json').write_bytes(payload)
                result = json.loads(payload)
                text = ''.join(block['text'] for item in result.get('output', []) if item.get('type') == 'message'
                    for block in item.get('content', []) if block.get('type') == 'output_text')
                report['passed'] = json.loads(text.strip()) == {'owner': 'Rina', 'due_date': '2026-11-03'}
            finally:
                report['task_seconds'] = round(time.monotonic() - started, 3)
    except Exception as error:
        report['error'] = type(error).__name__ + ': ' + str(error)
    finally:
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        (root / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
