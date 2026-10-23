"""Explicit native Codex turns; Codex owns authentication, tools and its agent loop."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import time
from urllib.parse import urlsplit

from .client_versions import SUPPORTED_CODEX_VERSION, SUPPORTED_CODEX_APP_VERSION
from .compaction_formats import strict_json_loads

MAX_FRAME = 1024 * 1024
MAX_OUTPUT = 2 * 1024 * 1024
MAX_PROMPT = 65536
# Fixed public failures include selection-policy callbacks. Exception diagnostics
# are never accepted as codes merely because their spelling looks valid.
_ERROR_CODES = frozenset({
    'native_account_invalid', 'native_actor_required', 'native_automatic_admission_required',
    'native_binary_changed', 'native_binary_invalid', 'native_chatgpt_account_required',
    'native_cleanup_failed', 'native_client_action_required', 'native_client_not_allowed',
    'native_client_unavailable', 'native_commercial_baseline_required', 'native_deadline',
    'native_default_model_unavailable', 'native_eof', 'native_frame_incomplete', 'native_frame_invalid',
    'native_frame_limit', 'native_gateway_environment_invalid', 'native_gateway_identity_required',
    'native_input_invalid', 'native_interrupted', 'native_item_invalid', 'native_local_execution_unverified',
    'native_local_model_not_qualified', 'native_local_only_requires_qualified_selection',
    'native_managed_policy_unsupported', 'native_model_alias_invalid', 'native_model_invalid', 'native_output_limit',
    'native_policy_limit_unsupported', 'native_prompt_limit', 'native_protocol_error', 'native_provider_invalid',
    'native_request_limit', 'native_reroute_invalid', 'native_router_cleanup_incomplete', 'native_rpc_rejected',
    'native_router_configuration_invalid', 'native_router_request_invalid', 'native_router_command_invalid',
    'native_router_response_limit', 'native_router_response_invalid', 'native_router_unavailable', 'native_router_deadline',
    'native_router_storage_unavailable',
    'native_secret_detected', 'native_secret_policy_invalid', 'native_selection_changed', 'native_selection_invalid',
    'native_terminal_invalid', 'native_thread_invalid', 'native_turn_failed', 'native_turn_invalid',
    'native_version_unsupported', 'native_workspace_invalid', 'native_workspace_changed',
    'native_sandbox_unverified',
})


class NativeSessionError(ValueError):
    pass


def _label(value, maximum=256):
    if type(value) is not str or not 0 < len(value) <= maximum or '\x00' in value:
        return False
    try:
        value.encode('utf-8')
    except UnicodeError:
        return False
    return True


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def workspace_context(workspace):
    """Identify an explicitly selected coding root without disclosing its path."""
    path = Path(workspace).expanduser()
    if not path.is_absolute():
        raise NativeSessionError('native_workspace_invalid')
    try:
        path = path.resolve(strict=True)
        info = path.stat(follow_symlinks=False)
    except OSError:
        raise NativeSessionError('native_workspace_invalid') from None
    if not stat.S_ISDIR(info.st_mode) or path == Path(path.anchor):
        raise NativeSessionError('native_workspace_invalid')
    return {'domain': 'codex-app-server-host.v2', 'task_type': 'code_change',
            'workspace_sha256': _digest({'path': str(path), 'device': info.st_dev, 'inode': info.st_ino}),
            'sandbox_mode': 'workspace-write', 'sandbox_network_access': False, 'approval_policy': 'never'}


def _binary_snapshot(path, deadline):
    digest = hashlib.sha256()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 512 * 1024 * 1024:
            raise NativeSessionError('native_binary_invalid')
        total = 0
        for block in iter(lambda: source.read(1024 * 1024), b''):
            if time.monotonic() >= deadline or total + len(block) > before.st_size:
                raise NativeSessionError('native_binary_changed')
            total += len(block)
            digest.update(block)
        after = os.fstat(source.fileno())
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    if total != before.st_size or identity(before) != identity(after) or identity(before) != identity(path.stat()):
        raise NativeSessionError('native_binary_changed')
    return identity(before), digest.hexdigest()


def _thread_configuration(selected, gateway_environment):
    configuration = selected['config']
    local_controls = {'model_reasoning_effort': 'none', 'model_reasoning_summary': 'none',
                      'web_search': 'disabled', 'features.apps': False,
                      'agents.enabled': False, 'features.multi_agent_v2': False, 'features.multi_agent': False}
    if (set(configuration) - {'model_catalog_json', *local_controls}
            or 'model_catalog_json' in configuration and (type(configuration['model_catalog_json']) is not str
                or not Path(configuration['model_catalog_json']).is_absolute())
            or any(key in configuration and (type(configuration[key]) is not type(value) or configuration[key] != value)
                   for key, value in local_controls.items())
            or set(configuration) & local_controls.keys() and selected['provider_config'] is None):
        raise NativeSessionError('native_selection_invalid')
    result = dict(configuration)
    definition = selected['provider_config']
    if definition is not None:
        allowed = {'name', 'base_url', 'wire_api', 'env_key', 'env_key_instructions', 'requires_openai_auth',
                   'supports_websockets', 'supports_standalone_web_search', 'request_max_retries',
                   'stream_max_retries', 'stream_idle_timeout_ms', 'auth', 'http_headers'}
        if (type(definition) is not dict or set(definition) - allowed
                or selected['provider'] in {'openai', 'ollama', 'lmstudio'}):
            raise NativeSessionError('native_selection_invalid')
        origin = urlsplit(definition.get('base_url', ''))
        if (origin.scheme != 'http' or origin.hostname not in {'127.0.0.1', 'localhost', '::1'}
                or origin.username is not None or origin.password is not None
                or definition.get('requires_openai_auth') is not False):
            raise NativeSessionError('native_selection_invalid')
        if 'env_key' in definition and definition['env_key'] not in gateway_environment:
            raise NativeSessionError('native_selection_invalid')
        if 'http_headers' in definition:
            headers = definition['http_headers']
            if (type(headers) is not dict
                    or set(headers) - {'X-Hormuz-Routing-Mode', 'X-Hormuz-Task-Selection', 'X-Hormuz-Work-ID'}
                    or headers.get('X-Hormuz-Routing-Mode', 'local_only') != 'local_only'
                    or headers.get('X-Hormuz-Task-Selection', 'model') != 'model'
                    or 'X-Hormuz-Work-ID' in headers and (type(headers['X-Hormuz-Work-ID']) is not str
                        or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}', headers['X-Hormuz-Work-ID']))):
                raise NativeSessionError('native_selection_invalid')
        if 'auth' in definition:
            auth = definition['auth']
            if type(auth) is not dict or set(auth) - {'command', 'args', 'cwd', 'timeout_ms', 'refresh_interval_ms'}:
                raise NativeSessionError('native_selection_invalid')
        result['model_providers.' + selected['provider']] = definition
    if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode()) > MAX_PROMPT:
        raise NativeSessionError('native_selection_invalid')
    return result


def _usage(value):
    if type(value) is not dict or not {'last', 'total'} <= set(value):
        return None
    fields = {'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'}
    result = {}
    for kind in ('last', 'total'):
        row = value[kind]
        if (type(row) is not dict or not fields <= set(row)
                or any(type(row[key]) is not int or not 0 <= row[key] < 2**63
                       for key in fields | ({'cacheWriteInputTokens'} if 'cacheWriteInputTokens' in row else set()))):
            return None
        result[kind] = {key: row[key] for key in fields | ({'cacheWriteInputTokens'} if 'cacheWriteInputTokens' in row else set())}
    window = value.get('modelContextWindow')
    if window is not None and (type(window) is not int or not 0 <= window < 2**63):
        return None
    if 'modelContextWindow' in value:
        result['modelContextWindow'] = window
    return result


class _Child:
    def __init__(self, arguments, environment, cwd, deadline, limit=MAX_OUTPUT):
        self.deadline, self.limit = deadline, limit
        self.interrupted = False
        self.selector = selectors.DefaultSelector()
        self.buffer = bytearray()
        self.counts = {'stdout': 0, 'stderr': 0}
        try:
            self.process = subprocess.Popen(arguments, cwd=cwd, env=environment, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        except BaseException:
            self.selector.close()
            raise
        try:
            self.selector.register(self.process.stdout, selectors.EVENT_READ, 'stdout')
            self.selector.register(self.process.stderr, selectors.EVENT_READ, 'stderr')
            os.set_blocking(self.process.stdin.fileno(), False)
        except BaseException:
            self.close()
            raise

    def send(self, value):
        if time.monotonic() >= self.deadline:
            raise NativeSessionError('native_deadline')
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode() + b'\n'
        if len(raw) > MAX_FRAME:
            raise NativeSessionError('native_request_limit')
        pending = memoryview(raw)
        self.selector.register(self.process.stdin, selectors.EVENT_WRITE, 'stdin')
        try:
            while pending:
                remaining = self.deadline - time.monotonic()
                if remaining <= 0:
                    raise NativeSessionError('native_deadline')
                for key, _ in self.selector.select(timeout=min(.1, remaining)):
                    if key.data == 'stdin':
                        try:
                            written = os.write(key.fd, pending[:8192])
                        except BlockingIOError:
                            continue
                        pending = pending[written:]
                    else:
                        self.collect(key)
        finally:
            self.selector.unregister(self.process.stdin)

    def collect(self, key):
        raw = os.read(key.fd, 8192)
        if not raw:
            self.selector.unregister(key.fileobj)
            return
        self.counts[key.data] += len(raw)
        if self.counts[key.data] > self.limit:
            raise NativeSessionError('native_output_limit')
        if key.data == 'stdout':
            self.buffer.extend(raw)

    def line(self):
        while True:
            if b'\n' in self.buffer:
                raw, _, rest = self.buffer.partition(b'\n')
                self.buffer[:] = rest
                if len(raw) > MAX_FRAME:
                    raise NativeSessionError('native_frame_limit')
                return bytes(raw)
            if len(self.buffer) > MAX_FRAME:
                raise NativeSessionError('native_frame_limit')
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise NativeSessionError('native_deadline')
            if not self.selector.get_map():
                raise NativeSessionError('native_frame_incomplete' if self.buffer else 'native_eof')
            for key, _ in self.selector.select(timeout=min(.1, remaining)):
                self.collect(key)

    def message(self):
        value = strict_json_loads(self.line().decode('utf-8'))
        if type(value) is not dict:
            raise NativeSessionError('native_frame_invalid')
        return value

    def close(self):
        previous = signal.getsignal(signal.SIGINT)
        installed = False
        def defer_interrupt(_signum, _frame):
            self.interrupted = True
        if previous is not None and previous != signal.SIG_IGN:
            try:
                signal.signal(signal.SIGINT, defer_interrupt)
                installed = True
            except ValueError:
                pass  # Only the main thread receives Python SIGINT callbacks.
        try:
            return self._close_group()
        finally:
            if installed:
                signal.signal(signal.SIGINT, previous)

    def _close_group(self):
        self.process.stdin.close()
        stopped = False
        for action, grace in ((None, .2), (signal.SIGTERM, 1), (signal.SIGKILL, 1)):
            try:
                if action is not None:
                    os.killpg(self.process.pid, action)
                deadline = time.monotonic() + grace
                while time.monotonic() < deadline:
                    self.process.poll()
                    try:
                        os.killpg(self.process.pid, 0)
                    except ProcessLookupError:
                        stopped = True
                        break
                    except PermissionError:
                        # macOS can deny probes of an exiting zombie group.
                        # Keep waiting for disappearance; denial is not proof.
                        pass
                    time.sleep(.02)
            except ProcessLookupError:
                stopped = True
            if stopped:
                break
        self.selector.close()
        self.process.stdout.close()
        self.process.stderr.close()
        if stopped:
            self.process.wait(timeout=1)
        return stopped


def _rpc(child, identifier, method, params, notifications):
    child.send({'id': identifier, 'method': method, 'params': params})
    while True:
        message = child.message()
        if 'method' in message:
            if 'id' in message:
                raise NativeSessionError('native_client_action_required')
            notifications.append(message)
            continue
        if message.get('id') != identifier or type(message.get('result')) is not dict or 'error' in message:
            raise NativeSessionError('native_rpc_rejected')
        return message['result']


def run_session(executable, client_home, cwd, prompt, model=None, provider=None,
                provider_config=None, timeout_seconds=90, select=None, gateway_environment=None,
                execution_context=None):
    """Run one fresh native turn without reading credentials or editing native settings.

    This is a native task observation, not a Responses provider. Native cache,
    authentication refresh and tools remain Codex-owned operations.
    """
    started = time.monotonic()
    result = {'status': 'unknown', 'text': '', 'usage': None, 'latency_ms': None,
              'thread_id': None, 'turn_id': None, 'provider': None, 'model': None,
              'account': None, 'facts': None, 'requested': None, 'error': None,
              'reroutes': [], 'native_terminal_status': None,
              'cleanup': {'owned_processes_stopped': True, 'scope': 'owned_process_group'}}
    child = None
    messages = {}
    try:
        if (type(prompt) is not str or not prompt.strip() or len(prompt.encode()) > MAX_PROMPT
                or type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 360):
            raise NativeSessionError('native_input_invalid')
        executable = Path(executable).expanduser().resolve(strict=True)
        if not _label(str(executable), 4096):
            raise NativeSessionError('native_binary_invalid')
        cwd = Path(cwd).expanduser().resolve(strict=True)
        home = Path(client_home).expanduser().resolve(strict=True)
        if execution_context is not None and (workspace_context(cwd) != execution_context
                or cwd == home or cwd in home.parents):
            raise NativeSessionError('native_workspace_invalid')
        sandbox = ({'type': 'workspaceWrite', 'writableRoots': [str(cwd)], 'networkAccess': False,
                    'excludeTmpdirEnvVar': True, 'excludeSlashTmp': True}
                   if execution_context is not None else {'type': 'readOnly'})
        environment = {key: os.environ[key] for key in ('HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT') if key in os.environ}
        environment.update(CODEX_HOME=str(home), OTEL_SDK_DISABLED='true')
        gateway_environment = {} if gateway_environment is None else gateway_environment
        if (type(gateway_environment) is not dict or len(gateway_environment) > 8
                or any(type(key) is not str or re.fullmatch(r'KOTO_SESSION_[A-Z0-9_]{1,80}', key) is None
                       or type(value) is not str or not 0 < len(value) <= 8192
                       or any(not 33 <= ord(character) <= 126 for character in value)
                       for key, value in gateway_environment.items())):
            raise NativeSessionError('native_gateway_environment_invalid')
        deadline = started + timeout_seconds
        binary = _binary_snapshot(executable, deadline)
        version_child = _Child([str(executable), '--version'], environment, cwd, min(deadline, started + 3), limit=4096)
        try:
            version = version_child.line().decode().strip().removeprefix('codex-cli ')
        finally:
            if not version_child.close():
                raise NativeSessionError('native_cleanup_failed')
            if version_child.interrupted:
                raise KeyboardInterrupt
        if version not in (SUPPORTED_CODEX_VERSION, SUPPORTED_CODEX_APP_VERSION):
            raise NativeSessionError('native_version_unsupported')
        if execution_context is not None and version != SUPPORTED_CODEX_VERSION:
            raise NativeSessionError('native_version_unsupported')
        if _binary_snapshot(executable, deadline) != binary:
            raise NativeSessionError('native_binary_changed')
        environment.update(gateway_environment)
        arguments = [str(executable), '-c', 'approval_policy="never"', '-c',
                     'sandbox_mode="workspace-write"' if execution_context is not None else 'sandbox_mode="read-only"']
        if execution_context is not None:
            arguments.extend(['-c', 'sandbox_workspace_write.network_access=false',
                '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
                '-c', 'sandbox_workspace_write.exclude_slash_tmp=true',
                '-c', 'sandbox_workspace_write.writable_roots=' + json.dumps([str(cwd)])])
        child = _Child([*arguments, 'app-server'], environment, cwd, deadline)
        notifications = []
        _rpc(child, 1, 'initialize', {'clientInfo': {'name': 'koto_native_session', 'title': 'Koto', 'version': '1'}}, notifications)
        child.send({'method': 'initialized', 'params': {}})
        configuration = _rpc(child, 2, 'config/read', {'includeLayers': False}, notifications)['config']
        account = _rpc(child, 3, 'account/read', {'refreshToken': False}, notifications).get('account')
        if type(account) is not dict or account.get('type') != 'chatgpt':
            raise NativeSessionError('native_chatgpt_account_required')
        if account.get('planType') is not None and not _label(account['planType'], 128):
            raise NativeSessionError('native_account_invalid')
        result['account'] = {key: account[key] for key in ('type', 'planType') if key in account}
        native_model = configuration.get('model')
        if native_model is None:
            catalog = _rpc(child, 6, 'model/list', {'limit': 100, 'includeHidden': True}, notifications)
            entries = catalog.get('data')
            defaults = [entry.get('model') for entry in entries
                        if type(entry) is dict and entry.get('isDefault') is True] if type(entries) is list else []
            if (catalog.get('nextCursor') is not None or len(defaults) != 1
                    or not _label(defaults[0])):
                raise NativeSessionError('native_default_model_unavailable')
            native_model = defaults[0]
        if not _label(native_model):
            raise NativeSessionError('native_model_invalid')
        native_provider = configuration.get('model_provider')
        if native_provider is None:
            native_provider = 'openai'
        if not _label(native_provider, 128):
            raise NativeSessionError('native_provider_invalid')
        selected_provider = provider if provider is not None else native_provider
        selected_model = model if model is not None else native_model
        if not _label(selected_provider, 128) or not _label(selected_model):
            raise NativeSessionError('native_selection_invalid')
        result['requested'] = {'provider': selected_provider, 'model': selected_model}
        controls = {key: configuration.get(key) for key in ('model', 'model_provider', 'model_reasoning_effort', 'model_reasoning_summary')}
        controls.update(approval_policy='never', sandbox_mode='read-only')
        if execution_context is not None:
            controls.update(sandbox_mode='workspace-write', execution_context=execution_context, sandbox_policy=sandbox)
        if _binary_snapshot(executable, deadline) != binary:
            raise NativeSessionError('native_binary_changed')
        result['facts'] = {'native_binary': str(executable), 'native_sha256': binary[1], 'client_version': version,
            'native_model': native_model, 'native_provider': native_provider,
            'account_identity_digest': _digest({key: account.get(key) for key in ('type', 'email', 'planType')}),
            'declared_controls_digest': _digest(controls)}
        selected = {'model': selected_model, 'provider': selected_provider, 'provider_config': provider_config, 'config': {}}
        if select is not None:
            override = select(dict(result['facts']))
            if type(override) is not dict or set(override) - set(selected):
                raise NativeSessionError('native_selection_invalid')
            selected.update(override)
        if _binary_snapshot(executable, deadline) != binary:
            raise NativeSessionError('native_binary_changed')
        selected_model, selected_provider = selected['model'], selected['provider']
        if (type(selected_provider) is not str or re.fullmatch(r'[A-Za-z0-9_-]{1,128}', selected_provider) is None
                or not _label(selected_model)
                or type(selected['config']) is not dict):
            raise NativeSessionError('native_selection_invalid')
        configuration_overrides = _thread_configuration(selected, gateway_environment)
        if gateway_environment:
            inherited = configuration.get('shell_environment_policy', {}).get('exclude', [])
            if inherited is None:
                inherited = []  # Native config/read serializes the default as null.
            if type(inherited) is not list or any(type(name) is not str for name in inherited):
                raise NativeSessionError('native_selection_invalid')
            configuration_overrides['shell_environment_policy.exclude'] = [*inherited, *gateway_environment]
        result['requested'] = {'provider': selected_provider, 'model': selected_model}
        result['context_controls_digest'] = _digest({'native': result['facts']['declared_controls_digest'],
            'selection': result['requested'], 'config': configuration_overrides})
        thread_parameters = {'model': selected_model, 'modelProvider': selected_provider,
            'cwd': str(cwd), 'approvalPolicy': 'never', 'ephemeral': True,
            'config': configuration_overrides}
        if execution_context is not None:
            if workspace_context(cwd) != execution_context:
                raise NativeSessionError('native_workspace_changed')
            thread_parameters['sandbox'] = 'workspace-write'
        thread = _rpc(child, 4, 'thread/start', thread_parameters, notifications)
        if execution_context is not None and (thread.get('cwd') != str(cwd)
                or thread.get('approvalPolicy') != 'never' or _digest(thread.get('sandbox')) != _digest(sandbox)):
            raise NativeSessionError('native_sandbox_unverified')
        thread_id = thread['thread']['id']
        if (not _label(thread_id) or not _label(thread.get('modelProvider'), 128)
                or not _label(thread.get('model'))):
            raise NativeSessionError('native_thread_invalid')
        result.update(thread_id=thread_id, provider=thread['modelProvider'], model=thread['model'])
        if result['provider'] != selected_provider or selected_model is not None and result['model'] != selected_model:
            raise NativeSessionError('native_selection_changed')
        if execution_context is not None and workspace_context(cwd) != execution_context:
            raise NativeSessionError('native_workspace_changed')
        turn = _rpc(child, 5, 'turn/start', {'threadId': result['thread_id'],
            'input': [{'type': 'text', 'text': prompt}], 'approvalPolicy': 'never',
            'sandboxPolicy': sandbox}, notifications)
        turn_id = turn['turn']['id']
        if not _label(turn_id):
            raise NativeSessionError('native_turn_invalid')
        result['turn_id'] = turn_id
        while True:
            message = notifications.pop(0) if notifications else child.message()
            if 'id' in message:
                raise NativeSessionError('native_client_action_required')
            params = message.get('params', {})
            if type(params) is not dict or params.get('threadId') != result['thread_id']:
                continue
            method = message.get('method')
            turn_id = params.get('turn', {}).get('id') if method == 'turn/completed' else params.get('turnId')
            if turn_id != result['turn_id']:
                continue
            if method == 'item/completed' and params.get('item', {}).get('type') == 'agentMessage':
                item = params['item']
                if not _label(item.get('id')) or type(item.get('text')) is not str:
                    raise NativeSessionError('native_item_invalid')
                try:
                    if len(item['text'].encode('utf-8')) > MAX_OUTPUT:
                        raise NativeSessionError('native_item_invalid')
                except UnicodeError:
                    raise NativeSessionError('native_item_invalid') from None
                messages[item['id']] = item
                answers = [row['text'] for row in messages.values() if row.get('phase') == 'final_answer']
                if not answers:
                    answers = [row['text'] for row in messages.values() if row.get('phase') is None]
                result['text'] = '\n'.join(answers)
            elif method == 'thread/tokenUsage/updated':
                result['usage'] = _usage(params.get('tokenUsage'))
            elif method == 'model/rerouted':
                source, destination = params.get('fromModel'), params.get('toModel')
                if (any(not _label(value) for value in (source, destination))
                        or source != result['model'] or len(result['reroutes']) >= 8):
                    raise NativeSessionError('native_reroute_invalid')
                result['reroutes'].append({'from_model': source, 'to_model': destination})
                result['model'] = destination
            elif method == 'turn/completed':
                status = params['turn'].get('status')
                if (status not in ('completed', 'failed', 'interrupted')
                        or status == 'completed' and params['turn'].get('error') is not None):
                    raise NativeSessionError('native_terminal_invalid')
                result['status'] = status
                result['native_terminal_status'] = status
                if status == 'failed':
                    result['error'] = 'native_turn_failed'
                if any(row['from_model'] != row['to_model'] for row in result['reroutes']):
                    result.update(status='unknown', error='native_selection_changed')
                break
    except KeyboardInterrupt:
        result.update(status='interrupted', error='native_interrupted')
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError, subprocess.SubprocessError) as error:
        result['status'] = 'unknown'
        reason = str(error) if isinstance(error, NativeSessionError) else ''
        result['error'] = reason if reason in _ERROR_CODES else 'native_protocol_error'
    finally:
        if child is not None:
            try:
                result['cleanup']['owned_processes_stopped'] = child.close()
                if child.interrupted:
                    result.update(status='interrupted', error='native_interrupted')
            except (OSError, subprocess.SubprocessError):
                result['cleanup']['owned_processes_stopped'] = False
            if not result['cleanup']['owned_processes_stopped']:
                result.update(status='unknown', error='native_cleanup_failed')
        if result['status'] != 'completed' and not result['text']:
            result['text'] = '\n'.join(row['text'] for row in messages.values() if row.get('phase') == 'partial_answer')
        result['latency_ms'] = int((time.monotonic() - started) * 1000)
    return result
