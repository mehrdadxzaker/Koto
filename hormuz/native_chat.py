"""Fresh user-local Codex tasks with a native commercial baseline and consented history."""
import json
import os
from contextlib import nullcontext
from dataclasses import asdict
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time

from .codex_native_session import NativeSessionError, run_session
from .codex_catalog import qualified_models
from .config import GatewayConfig
from .local_history import LocalHistory
from .model_benchmark import digest
from .native_history import begin_host_attempt
from .native_policy import prepare_prompt
from .native_router import owned_router
from .personal_selection import recommend
from ._config_identity import resolve_static_identity_tokens
from .work_learning import request_characteristics
from .contracts import validate_contract

LOCAL_CONTROLS = {'model_reasoning_effort': 'none', 'model_reasoning_summary': 'none',
                  'web_search': 'disabled', 'features.apps': False,
                  'features.multi_agent': False, 'features.multi_agent_v2': False, 'agents.enabled': False}


def _valid_alias(alias):
    return type(alias) is str and 1 <= len(alias) <= 128 and '\x00' not in alias


def _host_profile(config, facts):
    qualifications = dict(config.route_admission.local_routes)
    return digest({'domain': 'codex-app-server-host.v1', 'facts': facts,
        'local_execution': {'controls': LOCAL_CONTROLS,
            'qualifications': {alias: asdict(value) for alias, value in qualifications.items()},
            'catalog': qualified_models(config, sorted(qualifications))}})


def _receipt(result, selected, entry_id, error):
    complete = result['status'] == 'completed' and error is None
    is_local = selected.get('local', False)
    return {'schema_id': 'koto.native-task', 'schema_version': 1,
        'status': 'unknown' if error else result['status'], 'text': result['text'], 'model': selected.get('model'),
        'locality': 'local' if is_local else 'cloud', 'selection': selected.get('advice'), 'history_entry': entry_id,
        'execution': {'verified': complete, 'source': 'owned_router_receipts' if is_local else 'native_provider_binding',
                      'local_attempts': selected.get('local_attempts') if is_local else None},
        'native': result, 'error': error}


def run(args):
    attempt = None
    result = None
    selected = {}
    server = None
    local_work = None
    try:
        if args.prompt_file == '-':
            raw = sys.stdin.buffer.read(65537)
        else:
            with Path(args.prompt_file).expanduser().open('rb') as source:
                raw = source.read(65537)
        if not raw.strip() or len(raw) > 65536:
            raise NativeSessionError('native_prompt_limit')
        prompt = raw.decode('utf-8')
        config = GatewayConfig.load(args.config)
        prompt = prepare_prompt(config, prompt)
        identities = [identity for identity in config.identities_by_actor.values()
                      if args.actor is None or identity.actor_id == args.actor]
        if len(identities) != 1:
            raise NativeSessionError('native_actor_required')
        identity = identities[0]
        history = LocalHistory(config.source_path)
        executable = shutil.which(args.executable)
        if executable is None:
            raise NativeSessionError('native_client_unavailable')
        home = Path(args.client_home or os.environ.get('CODEX_HOME') or '~/.codex').expanduser().resolve()

        def select(facts):
            nonlocal attempt, local_work
            policy = config.resolved_policy(identity)
            if (identity.allowed_clients and 'codex' not in identity.allowed_clients
                    or policy.allowed_clients is not None and 'codex' not in policy.allowed_clients):
                raise NativeSessionError('native_client_not_allowed')
            matches = [alias for alias, route in config.model_routes.items()
                if route.upstream_model == facts['native_model']
                and config.upstreams[route.destination_id].authentication == 'codex_chatgpt'
                and (policy.allowed_models is None or alias in policy.allowed_models)]
            if facts['native_provider'] != 'openai' or len(matches) != 1:
                raise NativeSessionError('native_commercial_baseline_required')
            if not _valid_alias(matches[0]) or args.model is not None and not _valid_alias(args.model):
                raise NativeSessionError('native_model_alias_invalid')
            if any(getattr(policy, field) is not None for field in (
                    'max_output_tokens', 'monthly_token_limit', 'monthly_budget_usd', 'per_actor_monthly_budget_usd')):
                raise NativeSessionError('native_policy_limit_unsupported')
            baseline = matches[0]
            profile = _host_profile(config, facts)
            task = request_characteristics({'input': prompt})['task_hint']
            candidates = [] if server is None else server.routes(identity.actor_id)
            qualified = {row['model'] for row in candidates
                if row['readiness'] == 'ready' and _valid_alias(row['model'])
                and {'responses', 'text', 'streaming', 'tools', 'codex_http_0160'} <= set(row['capabilities'])
                and task not in {'code_change', 'code_review'} and task in row['automatic_task_types']}
            state, records = history.learning_snapshot(identity.actor_id)
            advice = recommend(config, state, records, {'input': prompt}, {baseline, *qualified}, baseline,
                               profile_digest=profile)
            chosen = baseline
            override = {}
            if state['enabled'] and state['mode'] == 'auto':
                if advice['validated'] and advice['status'] == 'classified':
                    chosen = advice['selected_model']
                    advice['routing_effect'] = 'selected'
                elif not advice['validated']:
                    advice['status'] = 'validation_required'
            if args.model is not None:
                if server is None or config.route_admission.mode == 'configured':
                    raise NativeSessionError('native_automatic_admission_required')
                eligible = [row for row in candidates if row['model'] == args.model
                    and row['readiness'] == 'ready'
                    and {'responses', 'text', 'streaming', 'tools', 'codex_http_0160'} <= set(row['capabilities'])
                    and task not in {'code_change', 'code_review'}
                    and (task in row['task_types'] or 'interactive' in row['task_types'])]
                if len(eligible) != 1:
                    raise NativeSessionError('native_local_model_not_qualified')
                chosen = args.model
            if chosen == baseline and config.route_admission.mode == 'local_only':
                raise NativeSessionError('native_local_only_requires_qualified_selection')
            if chosen != baseline:
                local_work = server.create_work(identity.actor_id, task)
                catalog = Path(workspace) / 'local-models.json'
                catalog.write_text(json.dumps({'models': qualified_models(config, [chosen])}))
                override = {'provider': 'koto_session', 'model': chosen, 'provider_config': {
                    'name': 'Koto session', 'base_url': f'http://127.0.0.1:{server.server_port}/v1',
                    'wire_api': 'responses', 'requires_openai_auth': False,
                    'env_key': 'KOTO_SESSION_GATEWAY_TOKEN',
                    'request_max_retries': 0, 'stream_max_retries': 0,
                    'http_headers': {'X-Hormuz-Routing-Mode': 'local_only', 'X-Hormuz-Task-Selection': 'model',
                                     'X-Hormuz-Work-ID': local_work['work_id']}}}
                override['config'] = {**LOCAL_CONTROLS, 'model_catalog_json': str(catalog)}
            advice['executed_model'] = chosen
            selected.update(model=chosen, advice=advice, profile=profile, local=chosen != baseline)
            attempt = begin_host_attempt(history, config, identity.actor_id, chosen, prompt, profile, advice)
            return override

        with tempfile.TemporaryDirectory(prefix='koto-native-task-') as workspace:
            needs_router = bool(config.route_admission.local_routes) and config.route_admission.mode != 'configured'
            tokens = resolve_static_identity_tokens((identity,), os.environ) if needs_router else {}
            gateway_token = next(iter(tokens), None)
            if needs_router and gateway_token is None:
                raise NativeSessionError('native_gateway_identity_required')
            deadline = time.monotonic() + args.timeout_seconds
            with owned_router(config, workspace, deadline) if needs_router else nullcontext() as server:
                result = run_session(executable, home, workspace, prompt,
                    timeout_seconds=args.timeout_seconds, select=select,
                    gateway_environment={'KOTO_SESSION_GATEWAY_TOKEN': gateway_token} if needs_router else None)
                if local_work is not None and result['status'] == 'completed':
                    observed = server.observe(identity.actor_id, local_work['work_id'], selected['model'])
                    expected = observed['expected_fingerprint']
                    selected['local_attempts'] = len(observed['attempts'])
                    selected['execution_verified'] = bool(observed['attempts'] and observed['next_before'] is None
                        and all(row['model'] == selected['model'] and row['route_fingerprint'] == expected
                                and row['response_succeeded'] for row in observed['attempts']))
        task_error = result['error']
        is_local = selected.get('local', False)
        if is_local and result['status'] == 'completed' and selected.get('execution_verified') is not True:
            task_error = 'native_local_execution_unverified'
        complete = result['status'] == 'completed' and task_error is None
        validate_contract(_receipt(result, selected, None, task_error))
        entry_id = None
        if attempt is not None:
            usage = result['usage']['total'] if result['usage'] else {}
            entry_id = attempt.finish({'outcome': 'succeeded' if complete else
                'failed' if result['status'] == 'failed' else 'outcome_unknown',
                'complete': complete, 'text': result['text'], 'latency_ms': result['latency_ms'],
                'input_tokens': usage.get('inputTokens'), 'output_tokens': usage.get('outputTokens')},
                execution_verified=complete and (not is_local or selected.get('execution_verified') is True))
        receipt = _receipt(result, selected, entry_id, task_error)
        validate_contract(receipt)
        print(json.dumps(receipt))
        return 0 if complete else 2
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, sqlite3.Error, KeyboardInterrupt) as error:
        code = ('native_interrupted' if isinstance(error, KeyboardInterrupt) else
                str(error) if isinstance(error, NativeSessionError) else 'native_task_unavailable')
        if result is not None:
            entry_id = None
            if attempt is not None:
                try:
                    entry_id = attempt.finish({'outcome': 'outcome_unknown', 'complete': False,
                        'text': result['text'], 'latency_ms': result['latency_ms']}, execution_verified=False)
                except (OSError, ValueError, RuntimeError, sqlite3.Error):
                    pass  # The caller still receives the observed answer and unverified failure.
            receipt = _receipt(result, selected, entry_id, code)
            validate_contract(receipt)
            print(json.dumps(receipt))
            return 2
        receipt = {'schema_id': 'koto.native-task-error', 'schema_version': 1, 'error': {'code': code}}
        validate_contract(receipt)
        print(json.dumps(receipt), file=sys.stderr)
        return 2
