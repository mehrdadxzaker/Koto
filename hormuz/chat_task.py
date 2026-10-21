"""Explicit fresh tasks through owned routing or native Codex sessions."""
import http.client
import json
import os
from pathlib import Path
import sys
import time
import tomllib
from urllib.parse import urlsplit
from urllib.request import Request

from .connected_client import ConnectedClientError, ConnectedClientLifetime
from .contracts import validate_contract
from .local_transport import open_local_upstream
from .chat_owner import register_owner

MAX_PROMPT = 65536
MAX_RESPONSE = 2 * 1024 * 1024


class ChatTaskError(RuntimeError):
    pass


def add_commands(commands):
    chat = commands.add_parser('chat', help='Use Koto for explicit tasks while preserving normal Codex settings')
    operations = chat.add_subparsers(dest='chat_command', required=True)
    route = operations.add_parser('route', help='Route one fresh task using local evidence and the existing Codex account')
    route.add_argument('--executable', default='codex', help='Existing supported native Codex executable')
    route.add_argument('--client-home', help='Native Codex home; authentication stays inside Codex')
    route.add_argument('--prompt-file', required=True, help='UTF-8 task file, or - for standard input')
    route.add_argument('--actor', help='Configured owner; required when multiple owners exist')
    route.add_argument('--model', help='Explicit qualified local alias; automatic selection is the default')
    route.add_argument('--timeout-seconds', type=int, default=90, choices=range(1, 361), metavar='1..360')
    for name in ('models', 'ask', 'propose'):
        command = operations.add_parser(name)
        command.add_argument('--router-home', required=True, help='Separate, already connected Koto control home')
        if name in {'ask', 'propose'}:
            command.add_argument('--model', required=name == 'propose',
                help='Explicit qualified local alias' if name == 'propose' else
                     'Qualified local alias; omit to use the configured router default')
            command.add_argument('--prompt-file', required=True, help='UTF-8 task file, or - for standard input')
            command.add_argument('--max-output-tokens', type=int, default=2048, choices=range(1, 8193), metavar='1..8192')
            command.add_argument('--effort', choices=['low', 'medium', 'high', 'max'], default='max')
            command.add_argument('--timeout-seconds', type=int, default=180, choices=range(1, 361), metavar='1..360')


def _proposal_text(body):
    """Accept only completed text suggestions; the host owns review and execution."""
    if not isinstance(body, dict):
        raise ChatTaskError('proposal_output_invalid')
    if body.get('status') != 'completed':
        raise ChatTaskError('task_incomplete')
    if any(body.get(key) for key in ('previous_response_id', 'conversation', 'session_id', 'encrypted_content')):
        raise ChatTaskError('proposal_output_invalid')
    output = body.get('output')
    if not isinstance(output, list) or not output:
        raise ChatTaskError('proposal_output_invalid')
    pieces = []
    for item in output:
        if not isinstance(item, dict) or item.get('status', 'completed') != 'completed':
            raise ChatTaskError('proposal_output_invalid')
        if item.get('type') == 'reasoning':
            if (set(item) - {'type', 'id', 'status', 'summary', 'content', 'encrypted_content'}
                    or item.get('encrypted_content')
                    or not isinstance(item.get('summary', []), list)
                    or not isinstance(item.get('content', []), list)):
                raise ChatTaskError('proposal_output_invalid')
            for part in item.get('summary', []) + item.get('content', []):
                if (not isinstance(part, dict) or set(part) != {'type', 'text'}
                        or part['type'] not in {'summary_text', 'reasoning_text'}
                        or not isinstance(part['text'], str)):
                    raise ChatTaskError('proposal_output_invalid')
            continue
        if (item.get('type') != 'message' or item.get('role') != 'assistant'
                or set(item) - {'type', 'id', 'role', 'status', 'content'}
                or not isinstance(item.get('content'), list) or not item['content']):
            raise ChatTaskError('proposal_output_invalid')
        for block in item['content']:
            if (not isinstance(block, dict) or set(block) - {'type', 'text', 'annotations'}
                    or block.get('type') != 'output_text'
                    or not isinstance(block.get('text'), str)):
                raise ChatTaskError('proposal_output_invalid')
            pieces.append(block['text'])
    text = ''.join(pieces)
    if not text.strip():
        raise ChatTaskError('proposal_output_invalid')
    return text


def run(args):
    if args.chat_command == 'route':
        from .native_chat import run
        return run(args)
    submitted = False
    proposal = args.chat_command == 'propose'
    try:
        prompt = None
        if args.chat_command in {'ask', 'propose'}:
            if args.prompt_file == '-':
                raw = sys.stdin.buffer.read(MAX_PROMPT + 1)
            else:
                with Path(args.prompt_file).expanduser().open('rb') as source:
                    raw = source.read(MAX_PROMPT + 1)
            if not raw.strip() or len(raw) > MAX_PROMPT:
                raise ChatTaskError('prompt_limit')
            prompt = raw.decode('utf-8')
        home = Path(args.router_home).expanduser().resolve()
        if home == (Path.home() / '.codex').resolve() or home == Path(os.environ.get('CODEX_HOME', '~/.codex')).expanduser().resolve():
            raise ChatTaskError('separate_router_home_required')
        lifetime = ConnectedClientLifetime(home)
        status = lifetime.status()
        if status.get('phase') != 'connected' or status.get('router') != 'ready':
            raise ChatTaskError('router_unavailable')
        if status.get('configuration') != 'installed':
            raise ChatTaskError('router_ownership_changed')
        config = tomllib.loads((home / 'config.toml').read_text())
        provider_id = config['model_provider']
        if provider_id != 'hormuz_' + status['generation']:
            raise ChatTaskError('router_ownership_changed')
        provider = config['model_providers'][provider_id]
        origin = urlsplit(provider['base_url'])
        if (origin.scheme != 'http' or origin.hostname != '127.0.0.1' or origin.path != '/v1'
                or origin.query or origin.fragment or origin.username or origin.password):
            raise ChatTaskError('owned_loopback_router_required')
        token = lifetime.local_token(status['generation']) if 'auth' in provider else os.environ[provider['env_key']]
        normal_home = Path(os.environ.get('CODEX_HOME', '~/.codex')).expanduser().resolve()
        register_owner(normal_home, home, status['generation'])
        deadline = time.monotonic() + (args.timeout_seconds if args.chat_command != 'models' else 6)
        selection = 'proposal' if proposal else 'model' if getattr(args, 'model', None) else 'router'

        def request(path, payload=None):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('chat_deadline')
            headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                       'User-Agent': 'Koto explicit-chat-task', 'X-Hormuz-Routing-Mode': 'local_only'}
            if payload is not None:
                headers['X-Hormuz-Task-Selection'] = selection
            message = Request(provider['base_url'] + path, headers=headers,
                              data=None if payload is None else json.dumps(payload).encode())
            with open_local_upstream(message, timeout=min(4, remaining), absolute_timeout=remaining,
                                     response_timeout=remaining) as response:
                body = response.read(MAX_RESPONSE + 1)
                if response.status != 200:
                    raise ChatTaskError('router_request_rejected')
                if len(body) > MAX_RESPONSE:
                    raise ChatTaskError('response_limit')
                return json.loads(body), response.headers

        state, _ = request('/work/state')
        if state.get('schema_id') != 'hormuz.ai-work-state' or state.get('schema_version') != 3:
            raise ChatTaskError('router_ownership_changed')
        admission, admission_headers = request('/router/state')
        if admission_headers.get('X-Hormuz-Chat-Tasks') != 'v1':
            raise ChatTaskError('router_upgrade_required')
        if proposal and admission_headers.get('X-Hormuz-Proposals') != 'v1':
            raise ChatTaskError('router_upgrade_required')
        validate_contract(admission)
        qualified = {(route['model'], route['destination'], route['generation']) for route in admission['routes']
                     if {'responses', 'text', 'codex_http', 'codex_llama_v1'} <= set(route['capabilities'])}
        routes = [route for route in state['connection']['routes'] if route.get('locality') == 'local'
                  and route.get('protocol') == 'openai' and route.get('eligible') is True
                  and (route['model'], route['destination'], route['generation']) in qualified]
        if args.chat_command == 'models':
            result = {'schema_id': 'hormuz.chat-models', 'schema_version': 1,
                      'default_model': config['model'], 'models': [route['model'] for route in routes]}
        else:
            model = args.model or config['model']
            selected = [route for route in routes if route['model'] == model]
            if len(selected) != 1:
                raise ChatTaskError('model_not_qualified')
            submitted = True
            body, headers = request('/responses', {'model': model, 'stream': False, 'store': False,
                'input': prompt, 'max_output_tokens': args.max_output_tokens, 'reasoning': {'effort': args.effort}})
            executed = [route for route in routes
                if (not args.model or route['model'] == model)
                and headers.get('X-Hormuz-Destination') == route['destination']
                and headers.get('X-Hormuz-Destination-Generation') == route['generation']
                and headers.get('X-Hormuz-Routed-Model') == route['upstream_model']]
            if (not executed or headers.get('X-Hormuz-Destination-Locality') != 'local'
                    or headers.get('X-Hormuz-Requested-Model') != model
                    or headers.get('X-Hormuz-Task-Selection') != selection
                    or headers.get('X-Hormuz-Failover') is not None):
                raise ChatTaskError('execution_selection_changed')
            route = executed[0]
            if proposal:
                text = _proposal_text(body)
            else:
                if body.get('status') != 'completed':
                    raise ChatTaskError('task_incomplete')
                text = ''.join(block['text'] for item in body.get('output', []) if item.get('type') == 'message'
                               for block in item.get('content', []) if block.get('type') == 'output_text')
            result = {'schema_id': 'hormuz.chat-proposal' if proposal else 'hormuz.chat-task',
                      'schema_version': 1, 'text': text, 'model': model,
                      'routed_model': route['upstream_model'], 'locality': 'local', 'destination': route['destination'],
                      'generation': route['generation'], 'work_id': headers.get('X-Hormuz-Work-Id'),
                      'selection': 'model' if args.model else 'router_default', 'reasoning_effort': args.effort}
            if proposal:
                result.update(purpose='proposal', review_required=True, applied=False)
        validate_contract(result)
        print(json.dumps(result))
        return 0
    except (ChatTaskError, ConnectedClientError, OSError, ValueError, KeyError, TypeError, http.client.HTTPException) as error:
        code = str(error) if isinstance(error, ChatTaskError) else 'task_unavailable'
        result = {'schema_id': 'hormuz.chat-error', 'schema_version': 1, 'error': {'code': code},
                  'submission': 'possibly_submitted' if submitted else 'not_submitted', 'retried': False}
        validate_contract(result)
        print(json.dumps(result), file=sys.stderr)
        return 2
