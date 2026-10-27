import path from 'node:path';
import { startSetupCommand } from './setup-command.js';

// CLI contracts: installed Codex exec/resume help, and the vendors' public docs:
// https://developers.openai.com/codex/noninteractive
// https://code.claude.com/docs/en/headless
// https://code.claude.com/docs/en/cli-reference
const PROMPT_LIMIT = 64 * 1024;
const LINE_LIMIT = 512 * 1024;
const TEXT_LIMIT = 512 * 1024;
const DIAGNOSTIC_TAIL_LIMIT = 16 * 1024;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/;
const CODEX_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'];
const API_ENV = new Set(['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
  'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT']);
const CLAUDE_API_ENV = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_RESOURCE']);
const ERROR_MESSAGES = Object.freeze({
  setup_terminal_helper_required: 'Prepare Windows process support with `koto terminal build` using installed developer tools, then reopen Koto.',
  native_state_not_writable: 'The native CLI cannot initialize its local state on a read-only filesystem. Use a supported writable native environment while keeping its credential provider unchanged.',
  native_state_access_denied: 'The native CLI cannot access its local runtime state. Resolve that installation or account permission through its supported native setup.',
  native_cli_incompatible: 'The installed native CLI does not accept this protocol or option. Check its version and supported exec/print flags before retrying.',
  native_authentication_required: 'Sign in through the selected native CLI account flow before starting another Koto turn.',
});

function startupDiagnostic(turn, outcome) {
  if (outcome?.status === 'succeeded' || turn.sawSession) return undefined;
  const text = turn.diagnosticTail;
  if (/read-only file system|\bEROFS\b|os error 30/i.test(text)) return 'native_state_not_writable';
  if (/(?:app.server|sqlite|database|rollout|state|history|writer.lock)/i.test(text)
    && /permission denied|\bEACCES\b|os error 13/i.test(text)) return 'native_state_access_denied';
  if (/(?:unexpected|unrecognized|unknown) (?:argument|option|flag)/i.test(text)) return 'native_cli_incompatible';
  if (/not logged in|login required|please (?:log in|login)|authentication (?:failed|required)/i.test(text)) return 'native_authentication_required';
  return undefined;
}

function invalid(message) { throw new TypeError(message); }
function validText(value, limit) {
  return typeof value === 'string' && value.trim() && !value.includes('\0') && Buffer.byteLength(value) <= limit;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function bounded(value, maximum = 2048) { return typeof value === 'string' ? value.slice(0, maximum) : undefined; }
function tokenCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function usageRecord(source, kind, reportedCost) {
  if (!object(source)) {
    if (kind !== 'claude' || !Number.isFinite(reportedCost) || reportedCost < 0) return undefined;
    source = {};
  }
  const usage = { actualCostUsd: null };
  const fields = { inputTokens: source.input_tokens, outputTokens: source.output_tokens,
    cachedInputTokens: source.cached_input_tokens ?? source.cache_read_input_tokens,
    cacheWriteInputTokens: source.cache_creation_input_tokens, reasoningOutputTokens: source.reasoning_output_tokens };
  for (const [key, value] of Object.entries(fields)) if (tokenCount(value) !== undefined) usage[key] = value;
  if (kind === 'claude' && Number.isFinite(reportedCost) && reportedCost >= 0) {
    usage.reportedCostUsd = reportedCost;
    usage.costBasis = 'native_estimate';
    usage.costScope = 'conversation_cumulative';
  }
  return usage;
}

/** One native conversation with exact continuation affinity. Each send starts
 * one native CLI turn, then waits for its structured result AND owned cleanup.
 * No prompt replay, provider fallback, credential installation or SDK is added.
 * Conversation mode restricts native editing capability; native host policy,
 * hooks, authentication and external services remain owned by that CLI.
 */
export function createNativeAgentSession({ kind, id = kind, command, cwd, model, effort,
  account = kind === 'claude' ? 'subscription' : 'host', mode = 'conversation',
  timeoutMs = 300_000, onEvent, sessionId: initialSessionId } = {}) {
  if (!['codex', 'claude'].includes(kind) || typeof id !== 'string'
    || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) invalid('Choose a native Codex or Claude agent and a valid id.');
  if (!validText(command, 4096) || !path.isAbsolute(command) || /\.(cmd|bat)$/i.test(command)
    || !validText(cwd, 4096) || !path.isAbsolute(cwd)) invalid('Native command and working directory must be absolute paths.');
  if (!['conversation', 'coding'].includes(mode)) invalid('Choose conversation or coding mode.');
  if (model !== undefined && (typeof model !== 'string' || !MODEL.test(model))) invalid('Use an exact native model identifier.');
  if (effort !== undefined && !(kind === 'codex' ? CODEX_EFFORTS : CLAUDE_EFFORTS).includes(effort)) invalid('Choose an effort supported by the selected native agent and model.');
  if (!(kind === 'codex' ? ['host', 'chatgpt'] : ['host', 'subscription']).includes(account)) invalid('Choose the matching native account mode.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) invalid('Choose a native turn deadline from 1 to 3600000 milliseconds.');
  if (onEvent !== undefined && typeof onEvent !== 'function') invalid('onEvent must be a function.');
  if (initialSessionId !== undefined && (typeof initialSessionId !== 'string' || !SESSION_ID.test(initialSessionId))) invalid('Use the originating native session id.');
  let nativeSessionId = initialSessionId;
  let active;
  let blocked = false;

  const environment = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => {
    if (/^GIT_/i.test(key)) return false;
    if (kind === 'codex' && account === 'chatgpt' && API_ENV.has(key.toUpperCase())) return false;
    if (kind === 'claude' && account === 'subscription' && CLAUDE_API_ENV.has(key.toUpperCase())) return false;
    return true;
  })), DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' });

  function emit(turn, event) {
    if (!onEvent || turn.observerFailed) return;
    if (turn.pendingObservers >= 64) { turn.fail('native_observer_overflow'); return; }
    try {
      const result = onEvent(Object.freeze({ ...event, agentId: id, kind }));
      if (result && typeof result.then === 'function') {
        turn.pendingObservers += 1;
        Promise.resolve(result).then(() => { turn.pendingObservers -= 1; }, () => {
          turn.pendingObservers -= 1; turn.observerFailed = true; turn.fail('native_observer_failed');
        });
      }
    } catch { turn.observerFailed = true; turn.fail('native_observer_failed'); }
  }

  function bindSession(turn, value) {
    if (typeof value !== 'string' || !SESSION_ID.test(value)
      || (nativeSessionId !== undefined && value !== nativeSessionId)) {
      turn.fail('native_session_mismatch');
      return false;
    }
    if (!turn.sawSession) {
      const resumed = nativeSessionId !== undefined;
      nativeSessionId = value;
      turn.sawSession = true;
      emit(turn, { type: 'session_started', sessionId: value, resumed });
    }
    return true;
  }

  function message(turn, text, messageId, streamed = false) {
    if (typeof text !== 'string') return;
    if (Buffer.byteLength(text) > TEXT_LIMIT) { turn.fail('native_text_limit'); return; }
    turn.text = text;
    if (text) turn.emittedText = true;
    emit(turn, { type: 'assistant_message', text, streamed, ...(messageId ? { messageId } : {}) });
  }

  function codexRecord(turn, record) {
    if (record.type === 'thread.started') { bindSession(turn, record.thread_id); return; }
    if (record.type === 'turn.started') {
      emit(turn, { type: 'agent_status', status: 'running' });
      return;
    }
    if (record.type === 'turn.completed') {
      if (turn.completed) { turn.fail('native_duplicate_completion'); return; }
      turn.completed = true;
      turn.usage = usageRecord(record.usage, kind);
      if (turn.usage) emit(turn, { type: 'usage', usage: turn.usage });
      return;
    }
    if (record.type === 'turn.failed') {
      turn.nativeFailed = true;
      emit(turn, { type: 'activity', activity: 'native_turn', status: 'failed', description: 'Native turn failed' });
      return;
    }
    if (record.type === 'error') {
      emit(turn, { type: 'activity', activity: 'native_turn', status: 'failed', description: 'Native error event' });
      return;
    }
    const item = record.item;
    if (!['item.started', 'item.updated', 'item.completed'].includes(record.type) || !object(item)) return;
    const status = record.type === 'item.completed' ? (item.status === 'failed' ? 'failed' : 'completed') : 'started';
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      if (record.type === 'item.completed') message(turn, item.text, bounded(item.id, 128));
      return;
    }
    // Reasoning and hidden thought text are deliberately not surfaced.
    if (item.type === 'command_execution') {
      emit(turn, { type: 'activity', activity: 'command', status, description: 'Native command', command: bounded(item.command) });
    } else if (item.type === 'file_change') {
      const files = Array.isArray(item.changes) ? item.changes.slice(0, 64).map(change => bounded(change?.path)).filter(Boolean) : [];
      emit(turn, { type: 'activity', activity: 'file_change', status, description: 'Native file changes', files });
    } else if (item.type === 'mcp_tool_call') {
      emit(turn, { type: 'activity', activity: 'tool', status, description: 'Native tool call', tool: bounded(item.tool, 128) });
    } else if (item.type === 'web_search') {
      emit(turn, { type: 'activity', activity: 'search', status, description: 'Native web search' });
    }
  }

  function claudeRecord(turn, record) {
    // Child-agent content belongs to its native parent, not this conversation.
    if (record.parent_tool_use_id) return;
    if (record.type === 'system' && record.subtype === 'init') {
      bindSession(turn, record.session_id);
      emit(turn, { type: 'agent_status', status: 'running' });
      return;
    }
    if (record.type === 'stream_event') {
      const event = record.event;
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta'
        && typeof event.delta.text === 'string') {
        const text = event.delta.text;
        turn.deltaBytes += Buffer.byteLength(text);
        if (turn.deltaBytes > TEXT_LIMIT) { turn.fail('native_text_limit'); return; }
        turn.streamed = true;
        turn.partialText += text;
        emit(turn, { type: 'assistant_delta', text });
      } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        claudeTool(turn, event.content_block);
      }
      return;
    }
    if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) {
        if (block.type === 'text') message(turn, block.text, bounded(record.message.id, 128), turn.streamed);
        else if (block.type === 'tool_use') claudeTool(turn, block);
      }
      return;
    }
    if (record.type === 'user' && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) if (block.type === 'tool_result') {
        const key = bounded(block.tool_use_id, 128);
        const tool = turn.tools.get(key) ?? { activity: 'tool', description: 'Native tool result' };
        emit(turn, { type: 'activity', ...tool, status: block.is_error ? 'failed' : 'completed' });
        turn.tools.delete(key);
      }
      return;
    }
    if (record.type !== 'result') return;
    if (!bindSession(turn, record.session_id)) return;
    turn.completed = true;
    // Native background work can produce additional result records. Retain
    // failures, and take the last observed result before the process closes.
    turn.nativeFailed ||= record.is_error === true || record.subtype !== 'success';
    const previousText = turn.text;
    if (typeof record.result === 'string') turn.text = record.result;
    if (Buffer.byteLength(turn.text) > TEXT_LIMIT) { turn.fail('native_text_limit'); return; }
    if (Array.isArray(record.permission_denials) && record.permission_denials.length) {
      turn.denied = true;
      for (const denial of record.permission_denials.slice(0, 64)) emit(turn, {
        type: 'activity', activity: 'permission_denied', status: 'denied', description: 'Native permission denied', tool: bounded(denial?.tool_name, 128),
      });
    }
    turn.usage = usageRecord(record.usage, kind, record.total_cost_usd);
    if (turn.usage) emit(turn, { type: 'usage', usage: turn.usage });
    if (!turn.streamed && turn.text && (!turn.emittedText || previousText !== turn.text)) message(turn, turn.text);
  }

  function claudeTool(turn, block) {
    const key = bounded(block.id, 128);
    const tool = bounded(block.name, 128);
    const detail = { activity: 'tool', description: 'Native tool call', ...(tool ? { tool } : {}) };
    if (tool === 'Bash' && typeof block.input?.command === 'string') {
      detail.activity = 'command';
      detail.description = 'Native command';
      detail.command = bounded(block.input.command);
    }
    if (typeof block.input?.file_path === 'string') detail.files = [bounded(block.input.file_path)];
    if (key) {
      if (!turn.tools.has(key) && turn.tools.size >= 256) { turn.fail('native_activity_limit'); return; }
      turn.tools.set(key, detail);
    }
    emit(turn, { type: 'activity', ...detail, status: 'started' });
  }

  async function subscriptionLogin(turn, env) {
    let output = '';
    turn.handle = await startSetupCommand({ id, command, args: ['auth', 'status'], cwd, env,
      signal: turn.launchController.signal, timeoutMs: Math.min(timeoutMs, 10_000),
      onEvent(event) {
        if (event.type === 'output' && event.stream === 'stdout' && !turn.failure) {
          output += event.text;
          if (Buffer.byteLength(output) > 32_768) turn.fail('native_auth_output_limit');
        }
      } });
    turn.handle.endInput();
    const outcome = await turn.handle.completion;
    if (outcome.error === 'cleanup_unconfirmed') return 'cleanup_unconfirmed';
    if (turn.cancelled) return 'native_cancelled';
    if (outcome.status !== 'succeeded') return 'native_subscription_auth_unavailable';
    let auth;
    try { auth = JSON.parse(output); } catch { return 'native_subscription_auth_unavailable'; }
    if (!['claude.ai', 'oauth_token'].includes(auth?.authMethod)) return 'native_subscription_login_required';
    return undefined;
  }

  const api = {
    get sessionId() { return nativeSessionId; },
    get pid() { return active?.handle?.pid ?? null; },
    stop() { if (active) { active.cancelled = true; active.launchController.abort(); active.handle?.stop(); } },
    async send(text, { signal } = {}) {
      const simple = error => ({ status: 'failed', text: '', ...(nativeSessionId ? { sessionId: nativeSessionId } : {}), error, exitCode: null });
      if (active) return simple('native_agent_busy');
      if (blocked) return simple('native_session_unresolved');
      if (!validText(text, PROMPT_LIMIT)) return simple('native_prompt_invalid');
      if (signal !== undefined && !(signal instanceof AbortSignal)) return simple('native_signal_invalid');
      if (signal?.aborted) return { ...simple('native_cancelled'), status: 'cancelled' };
      const turn = { handle: undefined, failure: undefined, cancelled: false, observerFailed: false, pendingObservers: 0,
        launchController: new AbortController(),
        sawSession: false, completed: false, nativeFailed: false, denied: false, text: '', partialText: '',
        streamed: false, emittedText: false, deltaBytes: 0, buffer: '', diagnosticTail: '', tools: new Map(), launched: false, deadline: performance.now() + timeoutMs,
        fail(code) { this.failure ??= code; this.launchController.abort(); this.handle?.stop(); } };
      active = turn;
      const deadlineTimer = setTimeout(() => turn.fail('timeout'), timeoutMs);
      const abort = () => { turn.cancelled = true; turn.launchController.abort(); turn.handle?.stop(); };
      signal?.addEventListener('abort', abort, { once: true });
      const env = environment();
      let outcome;
      try {
        emit(turn, { type: 'agent_status', status: 'starting' });
        if (!turn.failure && !turn.cancelled && kind === 'claude' && account === 'subscription') {
          const error = await subscriptionLogin(turn, env);
          if (error) turn.failure ??= error;
        }
        if (performance.now() >= turn.deadline) turn.failure ??= 'timeout';
        if (!turn.failure && !turn.cancelled) {
          let args;
          if (kind === 'codex') {
            args = ['--no-daemon', 'exec', ...(nativeSessionId ? ['resume'] : []), '--json',
              '-c', `sandbox_mode=${JSON.stringify(mode === 'coding' ? 'workspace-write' : 'read-only')}`];
            if (mode === 'conversation') args.push('--skip-git-repo-check');
            if (model) args.push('--model', model);
            if (effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
            if (account === 'chatgpt') args.push('-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"');
            if (nativeSessionId) args.push(nativeSessionId);
            args.push('-');
          } else {
            args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
            if (nativeSessionId) args.push('--resume', nativeSessionId);
            if (model) args.push('--model', model);
            if (effort) args.push('--effort', effort);
            if (mode === 'conversation') args.push('--permission-mode', 'plan', '--tools', 'Read,Glob,Grep', '--disallowedTools', 'mcp__*');
          }
          const line = value => {
            if (!value.trim() || turn.failure) return;
            let record;
            try { record = JSON.parse(value); } catch { turn.fail('native_json_invalid'); return; }
            if (!object(record) || typeof record.type !== 'string') { turn.fail('native_event_invalid'); return; }
            if (kind === 'codex') codexRecord(turn, record); else claudeRecord(turn, record);
          };
          turn.handle = await startSetupCommand({ id, command, args, cwd, env,
            signal: turn.launchController.signal, timeoutMs: Math.max(1, Math.floor(turn.deadline - performance.now())),
            onEvent(event) {
              if (event.type === 'terminal_cleanup') { emit(turn, event); return; }
              if (event.type === 'started') { emit(turn, { type: 'started', pid: event.pid }); return; }
              if (event.type === 'output' && event.stream === 'stderr') {
                // Inspect only a bounded private tail. No raw diagnostics,
                // credential values or managed paths enter normalized events.
                turn.diagnosticTail = Buffer.from(turn.diagnosticTail + event.text)
                  .subarray(-DIAGNOSTIC_TAIL_LIMIT + 4).toString('utf8');
                return;
              }
              if (event.type !== 'output' || event.stream !== 'stdout' || turn.failure) return;
              turn.buffer += event.text;
              let newline;
              while ((newline = turn.buffer.indexOf('\n')) !== -1) {
                const value = turn.buffer.slice(0, newline);
                turn.buffer = turn.buffer.slice(newline + 1);
                if (Buffer.byteLength(value) > LINE_LIMIT) { turn.fail('native_line_limit'); return; }
                line(value);
                if (turn.failure) return;
              }
              if (Buffer.byteLength(turn.buffer) > LINE_LIMIT) turn.fail('native_line_limit');
            } });
          turn.launched = true;
          if (turn.failure || turn.cancelled) { turn.handle.stop(); throw Object.assign(new Error('Native launch cancelled.'), { code: 'native_cancelled' }); }
          if (!turn.handle.send(text) || !turn.handle.endInput()) turn.fail('native_prompt_rejected');
          outcome = await turn.handle.completion;
          if (turn.buffer.trim() && !turn.failure) line(turn.buffer);
        }
      } catch (error) {
        turn.failure ??= error.code === 'setup_terminal_helper_required' ? error.code : turn.cancelled ? 'native_cancelled' : 'native_launch_failed';
      } finally {
        clearTimeout(deadlineTimer);
        if (turn.handle) {
          // Retain ownership even when protocol/observer/setup handling failed.
          if (turn.failure || turn.cancelled) turn.handle.stop();
          outcome = await turn.handle.completion;
        }
        signal?.removeEventListener('abort', abort);
        active = undefined;
      }
      const error = outcome?.error === 'cleanup_unconfirmed' ? 'cleanup_unconfirmed'
        : turn.failure ?? (turn.cancelled ? 'native_cancelled' : startupDiagnostic(turn, outcome) ?? (outcome?.status !== 'succeeded' ? (outcome?.error ?? 'native_process_failed')
          : turn.denied ? 'native_permission_denied' : turn.nativeFailed ? 'native_turn_failed'
            : !turn.sawSession ? 'native_session_missing' : !turn.completed ? 'native_completion_missing'
              : mode === 'conversation' && !(turn.text || turn.partialText).trim() ? 'native_response_empty' : undefined));
      if (error === 'cleanup_unconfirmed' || (turn.launched && !nativeSessionId)) blocked = true;
      const status = turn.cancelled ? 'cancelled' : error ? 'failed' : 'succeeded';
      const result = { status, text: turn.text || turn.partialText, ...(nativeSessionId ? { sessionId: nativeSessionId } : {}),
        ...(turn.usage ? { usage: turn.usage } : {}), ...(error ? { error } : {}),
        ...(ERROR_MESSAGES[error] ? { errorMessage: ERROR_MESSAGES[error] } : {}), exitCode: outcome?.exitCode ?? null,
        ...(outcome?.signal ? { signal: outcome.signal } : {}) };
      emit(turn, { type: 'agent_status', status, ...(error ? { error } : {}) });
      return result;
    },
  };
  return api;
}
