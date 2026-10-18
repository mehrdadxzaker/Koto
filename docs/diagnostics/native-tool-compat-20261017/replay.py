"""Native Codex text/function controls, with no model inference.

The text response is reconstructed from the frozen v7 client event; v7 did not
retain the raw upstream SSE. Supplied function arguments are a transport control,
not model-quality evidence. Exit 1 is the retained no-edit symptom.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile

REPOSITORY = Path(__file__).resolve().parents[3]
V7 = REPOSITORY / 'docs/campaigns/local-repair-20261017-v7'
OLD_CONTROL = REPOSITORY / 'docs/diagnostics/native-patch-20261016/routed-control.py'
PYTHON = Path('/Users/mehrdadz/Downloads/memoWiki/hormuz/.venv/bin/python')


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def response(model, output, identity):
    return {'id': identity, 'object': 'response', 'status': 'completed',
            'model': model, 'output': output,
            'usage': {'input_tokens': 8, 'output_tokens': 8, 'total_tokens': 16}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('text', 'function'), required=True)
    parser.add_argument('--minimal', action='store_true', help='Use the same supplied command in text and function form')
    parser.add_argument('--v8-driver', action='store_true', help='Exercise the isolated v8 launcher and trace tap')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise RuntimeError('Preserve an existing diagnostic result')
    args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    controls = load_module('retained_control', OLD_CONTROL)
    runner = load_module('retained_v7_runner', V7 / 'development-runner.py')
    baseline = json.loads((V7 / 'corpus.json').read_text())['entries'][0]
    native_events = [json.loads(line) for line in (V7 / 'development-native.jsonl').read_text().splitlines()]
    frozen_text = next(e['item']['text'] for e in native_events
                       if e.get('item', {}).get('type') == 'agent_message')
    with tempfile.TemporaryDirectory(prefix='koto-native-tool-replay-') as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        runner.ROOT, runner.PYTHON = root, PYTHON
        for directory in ('home', 'home/.codex', 'project', 'tmp', 'installed', 'engine'):
            (root / directory).mkdir(mode=0o700)
        for name in ('home/.codex/config.toml', 'original-config.toml'):
            (root / name).write_text('personality = "none"\n')
        (root / 'project/solution.py').write_text(baseline['files']['solution.py'])
        (root / 'prompt.txt').write_text(baseline['goal'])
        (root / 'oracle.py').write_text(baseline['checks'])
        (root / 'oracle.py').chmod(0o400)
        (root / 'developer-instructions.txt').write_bytes((V7 / 'developer-instructions.txt').read_bytes())
        engine = root / 'engine/llama-server'
        engine.write_text(controls.ENGINE.replace('#!PYTHON', '#!' + str(PYTHON), 1))
        engine.chmod(0o700)
        model_file = root / 'synthetic.gguf'
        model_file.write_bytes(b'GGUF external fixture; no model')
        archive = root / 'runtime.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            bundle.add(engine, arcname='llama-server')
        pins = json.loads((V7 / 'pins.json').read_text())
        for key, path in (('runtime_archive', archive), ('runtime_executable', engine), ('model', model_file)):
            pins[key] = {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())}
        write(root / 'pins.json', pins)
        profile = json.loads((V7 / 'setup-profile.json').read_text())
        profile.update(qualification_id='synthetic-native-tool-replay-v1',
                       runtime_sha256=pins['runtime_archive']['sha256'],
                       model_sha256=pins['model']['sha256'])
        write(root / 'setup-profile.json', profile)
        for path in (REPOSITORY / 'hormuz').rglob('*'):
            relative = path.relative_to(REPOSITORY)
            if '__pycache__' in relative.parts or path.suffix == '.pyc':
                continue
            target = root / 'installed' / relative
            if path.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            elif path.is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
        final_message = {'id': 'msg_replay', 'type': 'message', 'status': 'completed',
                         'role': 'assistant', 'content': [{'type': 'output_text',
                         'text': frozen_text if args.mode == 'text' else 'Transport control completed.',
                         'annotations': []}]}
        command = ("python3 -c 'from pathlib import Path; "
                   'Path("solution.py").write_text("def clamp(value, lower, upper):\\n'
                   '    if lower > upper: raise ValueError(\\\"inverted bounds\\\")\\n'
                   '    return max(lower, min(value, upper))\\n")' + "'")
        if args.v8_driver:
            payload = ('from pathlib import Path\n'
                       'for forbidden in ' + repr([
                           '/private/tmp/koto-tool-compat-preparation-20261017/checkers/dev-clamp.py',
                           str(REPOSITORY / 'docs/campaigns/local-repair-20261017-v8/corpus.json')]) + ':\n'
                       ' try:\n  Path(forbidden).read_text()\n'
                       ' except PermissionError:\n  pass\n'
                       ' else:\n  raise AssertionError("independent inventory was readable")\n'
                       'try:\n Path(' + repr(str(root / 'forbidden-write.txt')) + ').write_text("must fail")\n'
                       'except PermissionError:\n pass\n'
                       'else:\n raise AssertionError("outside workspace was writable")\n'
                       'Path("solution.py").write_text("def clamp(value, lower, upper):\\n'
                       '    if lower > upper: raise ValueError(\\\"inverted bounds\\\")\\n'
                       '    return max(lower, min(value, upper))\\n")\n'
                       'print("checker_inventory_and_write_isolation_passed")\n')
            import shlex
            command = 'python3 -c ' + shlex.quote(payload)
        arguments = json.dumps({'cmd': command, 'max_output_tokens': 512})
        if args.minimal and args.mode == 'text':
            final_message['content'][0]['text'] = '```json\n' + json.dumps({'name': 'exec_command', 'arguments': json.loads(arguments)}) + '\n```'
        call = {'id': 'fc_replay', 'type': 'function_call', 'status': 'completed',
                'call_id': 'call_replay', 'name': 'exec_command', 'arguments': arguments}
        first_item = final_message if args.mode == 'text' else call
        first = response(profile['model'], [first_item], 'resp_replay_first')
        first_frames = [{'type': 'response.created', 'response': {**first, 'status': 'in_progress', 'output': []}},
                        {'type': 'response.output_item.added', 'output_index': 0,
                         'item': {**first_item, 'status': 'in_progress',
                                  **({'arguments': ''} if args.mode == 'function' else {})}}]
        if args.mode == 'function':
            first_frames.extend([{'type': 'response.function_call_arguments.delta', 'item_id': call['id'],
                                  'output_index': 0, 'delta': arguments},
                                 {'type': 'response.function_call_arguments.done', 'item_id': call['id'],
                                  'output_index': 0, 'arguments': arguments}])
        first_frames.extend([{'type': 'response.output_item.done', 'output_index': 0, 'item': first_item},
                             {'type': 'response.completed', 'response': first}])
        last = response(profile['model'], [final_message], 'resp_replay_done')
        frames = [first_frames, [{'type': 'response.output_item.done', 'output_index': 0, 'item': final_message},
                                {'type': 'response.completed', 'response': last}]]
        write(root / 'engine/frames.json', frames)
        driver = None
        if args.v8_driver:
            driver = load_module('v8_native_driver', REPOSITORY / 'docs/campaigns/local-repair-20261017-v8/campaign-runner.py')
            driver.ROOT = driver.retained.ROOT = root
            driver.DIRECTORY = root / 'driver-artifacts'
            driver.DIRECTORY.mkdir(mode=0o700)
            driver.capture()
        else:
            runner.preflight()
        capture = json.loads((root / 'captured-request.json').read_text())
        subject = {'client_version': profile['client_version'], 'system': profile['system'],
                   'machine': profile['machine'], 'runtime_profile': 'managed-llama.v1',
                   'runtime_sha256': pins['runtime_archive']['sha256'],
                   'model_revision': 'sha256:' + pins['model']['sha256'], 'upstream_model': profile['model'],
                   'protocol': 'openai', 'capabilities': profile['capabilities'],
                   'max_request_bytes': profile['max_request_bytes'], 'max_output_tokens': profile['max_output_tokens'],
                   'upstream_timeout_seconds': profile['upstream_timeout_seconds'],
                   'request_profile_sha256': digest(canonical(runner.request_profile(capture)))}
        plan = {'schema_id': 'hormuz.coding-probe-plan', 'schema_version': 2,
                'campaign_id': 'synthetic-native-tool-replay-v1', 'plan_sha256': 'e' * 64,
                'case_id': 'synthetic-text-versus-function', 'task_sha256': baseline['task_sha256'],
                'checks_sha256': baseline['checks_sha256'], 'model': profile['model'], 'subject': subject,
                'first_input_sha256': digest(canonical(runner.semantic_input(capture['input']))),
                'max_requests': 2, 'max_elapsed_seconds': 30}
        write(root / 'probe-plan.json', plan)
        experiment = runner.Experiment()
        report = {'mode': args.mode, 'minimal': args.minimal, 'native_model_inferences': 0,
                  'response_origin': 'reconstructed client text' if args.mode == 'text' else 'supplied synthetic function call',
                  'model_quality_evidence': False, 'baseline_exit_code': runner.independent_check()}
        before = (root / 'project/solution.py').read_bytes()
        try:
            report['setup'] = experiment.connect()
            armed = experiment.cli('client', 'qualify', 'codex', '--client-home', str(experiment.client_home),
                                   '--plan', str(root / 'probe-plan.json'))
            if driver:
                with driver.TraceTap(experiment.ports[0], root / 'trace') as tap:
                    report['native'] = driver.launch(experiment, 'replay-native', probe=armed['probe_id'], base_url=tap.url, timeout=30)
                report['trace'] = tap.records
            else:
                report['native'] = experiment.launch('replay-native', probe=armed['probe_id'], timeout=30)
            report['probe_after'] = experiment.cli('client', 'qualify', 'codex', '--client-home', str(experiment.client_home))
            report['routing_after'] = experiment.cli('client', 'status', 'codex', '--client-home', str(experiment.client_home), '--routing')
            report['revoked'] = experiment.cli('client', 'qualify', 'codex', '--client-home', str(experiment.client_home), '--revoke')
        finally:
            experiment.close(report)
            report['implementation_changed'] = before != (root / 'project/solution.py').read_bytes()
            report['check_exit_code'] = runner.independent_check()
            report['checks_unchanged'] = digest((root / 'oracle.py').read_bytes()) == baseline['checks_sha256']
            events = [json.loads(line) for line in (root / 'replay-native.jsonl').read_text().splitlines()]
            report['native_events'] = events
            report['executed_commands'] = sum(e.get('item', {}).get('type') == 'command_execution'
                                               and e.get('type') == 'item.completed' for e in events)
            report['upstream_requests'] = [json.loads(p.read_text()) for p in sorted((root / 'engine').glob('request-*.json'))]
            report['response_frames'] = frames[:len(report['upstream_requests'])]
            write(args.output, report)
        summary = {k: report.get(k) for k in ('mode', 'native_model_inferences', 'executed_commands',
                   'implementation_changed', 'check_exit_code', 'checks_unchanged', 'settings_restored', 'owned_listeners_closed')}
        print(json.dumps(summary))
        if not (report['checks_unchanged'] and report.get('settings_restored') and report.get('owned_listeners_closed')):
            return 2
        return 0 if report['executed_commands'] and report['implementation_changed'] and report['check_exit_code'] == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
