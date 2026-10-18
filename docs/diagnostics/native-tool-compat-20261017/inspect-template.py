"""Inspect the pinned engine's public rendering/token endpoints, without inference."""
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import shutil

REPOSITORY = Path(__file__).resolve().parents[3]
V7 = REPOSITORY / 'docs/campaigns/local-repair-20261017-v7'
ROOT = Path('/private/tmp/koto-tool-template-inspection-20261017')


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def main():
    ROOT.mkdir(mode=0o700, exist_ok=False)
    for part in ('home', 'home/.codex', 'tmp', 'project', 'installed'):
        (ROOT / part).mkdir(mode=0o700)
    for name in ('home/.codex/config.toml', 'original-config.toml'):
        (ROOT / name).write_text('personality = "none"\n')
    for name in ('pins.json', 'setup-profile.json'):
        shutil.copy2(V7 / name, ROOT / name)
    for source in (REPOSITORY / 'hormuz').rglob('*'):
        relative = source.relative_to(REPOSITORY)
        if '__pycache__' in relative.parts or source.suffix == '.pyc':
            continue
        target = ROOT / 'installed' / relative
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif source.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    spec = importlib.util.spec_from_file_location('retained_runner', V7 / 'development-runner.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.ROOT = ROOT
    experiment = runner.Experiment()
    report = {'model_completion_requests': 0, 'metadata_requests': [],
              'source_baseline': 'd006beb6a21e527c01692b7591c62aa820fea41f'}
    connection = None
    try:
        report['setup'] = experiment.connect()
        connection = http.client.HTTPConnection('127.0.0.1', experiment.ports[1], timeout=5)
        def request(method, path, body=None):
            if len(report['metadata_requests']) >= 6:
                raise RuntimeError('Metadata request budget exhausted')
            if (method, path) not in {('GET', '/props'), ('POST', '/apply-template'),
                                     ('POST', '/v1/responses/input_tokens'), ('POST', '/tokenize')}:
                raise RuntimeError('Only zero-inference endpoints are allowed')
            data = None if body is None else json.dumps(body).encode()
            connection.request(method, path, body=data,
                               headers={} if body is None else {'Content-Type': 'application/json'})
            response = connection.getresponse()
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise RuntimeError('Metadata response bound exceeded')
            result = json.loads(raw)
            report['metadata_requests'].append({'method': method, 'path': path, 'status': response.status})
            if response.status != 200:
                raise RuntimeError('Metadata endpoint rejected the request: ' + path)
            return result
        properties = request('GET', '/props')
        write(ROOT / 'engine-props.json', properties)
        frozen = json.loads((V7 / 'captured-request.json').read_text())
        messages = [{'role': 'system', 'content': frozen['instructions']}]
        for item in frozen['input']:
            messages.append({'role': item['role'], 'content': '\n'.join(
                part['text'] for part in item['content'] if part['type'] == 'input_text')})
        chat = {'messages': messages,
                'tools': [{'type': 'function', 'function': {k: v for k, v in t.items() if k != 'type'}}
                          for t in frozen['tools']], 'add_generation_prompt': True,
                'tool_choice': 'auto', 'parallel_tool_calls': True}
        rendered = request('POST', '/apply-template', chat)
        write(ROOT / 'chat-input.json', chat)
        write(ROOT / 'rendered-template.json', rendered)
        counted = request('POST', '/v1/responses/input_tokens', frozen)
        write(ROOT / 'responses-token-count.json', counted)
        without = dict(frozen)
        without['tools'] = []
        report['tokens_without_tools'] = request('POST', '/v1/responses/input_tokens', without)
        prompt = rendered.get('prompt', '')
        tokenized = request('POST', '/tokenize', {'content': prompt, 'add_special': True})
        report['rendered_prompt_tokens'] = len(tokenized['tokens'])
        report['responses_tokens'] = counted
        report['rendered_prompt_sha256'] = hashlib.sha256(prompt.encode()).hexdigest()
        report['rendered_tool_names'] = [t['name'] for t in frozen['tools'] if t['name'] in prompt]
        developer_text = frozen['input'][0]['content'][0]['text']
        report['developer_guidance_rendered'] = developer_text in prompt
        report['hermes_tool_delimiter_rendered'] = '<tool_call>' in prompt
        report['engine_property_keys'] = list(properties)
        report['engine_template_sha256'] = hashlib.sha256(properties.get('chat_template', '').encode()).hexdigest()
        report['coding_state'] = experiment.cli('client', 'status', 'codex', '--client-home', str(experiment.client_home), '--routing')
    finally:
        if connection:
            connection.close()
        experiment.close(report)
        write(ROOT / 'inspection.json', report)
    print(json.dumps({k: report.get(k) for k in ('model_completion_requests', 'metadata_requests',
        'responses_tokens', 'tokens_without_tools', 'rendered_prompt_tokens', 'rendered_tool_names',
        'developer_guidance_rendered', 'hermes_tool_delimiter_rendered', 'engine_template_sha256',
        'settings_restored', 'owned_listeners_closed')}))


if __name__ == '__main__':
    main()
