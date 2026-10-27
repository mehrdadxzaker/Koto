import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startCommand } from './command-session.js';

// Native stdio control contract: official Claude Agent SDK Python source,
// commit 717cea09021fac3654879f0a362ed254a73ec35d (bundled CLI 2.1.311):
// _internal/query.py, _internal/transport/subprocess_cli.py and types.py.
// This adapter executes the installed CLI directly; it does not use SDK/API
// authentication or set a synthetic SDK entry point.
const PROMPT_LIMIT = 60_000;
const LINE_LIMIT = 512 * 1024;
const TEXT_LIMIT = 512 * 1024;
const AUTH_LIMIT = 32_768;
const REQUEST_LIMIT = 512;
const PENDING_LIMIT = 32;
const WIRE_LIMIT = 192 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/;
const TERMINAL_TASK = new Set(['completed', 'failed', 'stopped', 'killed']);
const DEFERRED_TASK = new Set(['local_agent', 'local_workflow']);
const API_ENV = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_RESOURCE']);
const ERRORS = Object.freeze({
  native_subscription_login_required: 'Sign in through the installed Claude CLI with the intended Claude subscription before continuing.',
  claude_auth_unavailable: 'The installed Claude CLI could not confirm its native subscription login. Check `claude auth status` through its normal account setup.',
  claude_control_initialization_failed: 'The installed Claude CLI did not initialize its native stdio control protocol. Update through its supported installation before retrying.',
  native_state_not_writable: 'The Claude CLI cannot initialize its native runtime state on this filesystem. Use a writable native installation environment while preserving its own credentials.',
  native_cli_incompatible: 'The installed Claude CLI does not accept the required stdio control options. Check its native version and update through its supported installation.',
  claude_session_state_unavailable: 'This Claude CLI did not provide the session-state events needed to keep native approvals open safely. Use a current supported Claude CLI; no successful run is claimed.',
  claude_exit_timeout: 'Claude returned a result but did not exit after input closed. Owned cleanup was requested; inspect the retained partial work before continuing.',
});

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, maximum = 4096) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && Buffer.byteLength(value) <= maximum;
}
function bounded(value, maximum = 2048) { return typeof value === 'string' ? value.slice(0, maximum) : undefined; }
function validRequestId(value) { return text(value, 256) && !/[\x00-\x1f\x7f]/.test(value); }
function token(value) { return Number.isSafeInteger(value) && value >= 0; }
function startupFailure(turn) {
  if (turn.sawSession) return undefined;
  if (/read-only file system|\bEROFS\b|os error 30/i.test(turn.diagnosticTail)) return 'native_state_not_writable';
  if (/(?:unexpected|unrecognized|unknown) (?:argument|option|flag)/i.test(turn.diagnosticTail)) return 'native_cli_incompatible';
  return undefined;
}
function usage(record) {
  const source = record.usage;
  if (!object(source) && !(Number.isFinite(record.total_cost_usd) && record.total_cost_usd >= 0)) return undefined;
  const value = { actualCostUsd: null };
  for (const [name, count] of Object.entries({ inputTokens: source?.input_tokens,
    outputTokens: source?.output_tokens, cachedInputTokens: source?.cache_read_input_tokens,
    cacheWriteInputTokens: source?.cache_creation_input_tokens })) if (token(count)) value[name] = count;
  if (Number.isFinite(record.total_cost_usd) && record.total_cost_usd >= 0) {
    value.reportedCostUsd = record.total_cost_usd;
    value.costBasis = 'native_estimate';
    value.costScope = 'conversation_cumulative';
  }
  return value;
}

/** Native Claude subscription session with bidirectional permission requests.
 * Each send owns one CLI process until result + idle + descendant cleanup.
 * Subsequent sends resume only the acknowledged originating native session.
 * onApproval handles native asks; native rules may already permit other tools.
 */
export function createClaudeAgentSession({ id = 'claude', command, cwd, model, effort,
  mode = 'conversation', account = 'subscription', sessionId: initialSessionId,
  timeoutMs = 300_000, onEvent, onApproval, unsetEnv = [] } = {}) {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)
    || !text(command) || !path.isAbsolute(command) || /\.(?:cmd|bat)$/i.test(command)
    || !text(cwd) || !path.isAbsolute(cwd)
    || account !== 'subscription' || !['conversation', 'coding'].includes(mode)
    || (model !== undefined && (typeof model !== 'string' || !MODEL.test(model)))
    || (effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000
    || (onEvent !== undefined && typeof onEvent !== 'function')
    || (onApproval !== undefined && typeof onApproval !== 'function')
    || !Array.isArray(unsetEnv) || unsetEnv.length > 32 || unsetEnv.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))
    || (initialSessionId !== undefined && (typeof initialSessionId !== 'string' || !UUID.test(initialSessionId)))) {
    throw new TypeError('Choose an installed Claude executable, absolute directory, native subscription account and valid session options.');
  }
  let nativeSessionId = initialSessionId;
  let active;
  let closed = false;
  let blocked = false;

  const environment = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)
      && !API_ENV.has(name.toUpperCase())
      && !unsetEnv.some(key => process.platform === 'win32' ? key.toUpperCase() === name.toUpperCase() : key === name))),
    // Protocol events distinguish a finished turn from pending native agents.
    CLAUDE_CODE_SDK_READS_SESSION_STATE: '1',
  });

  function emit(turn, event) {
    if (!onEvent || turn.observerFailed) return;
    if (turn.pendingObservers >= 64) { turn.fail('claude_observer_overflow'); return; }
    try {
      const result = onEvent(Object.freeze({ ...event, agentId: id, kind: 'claude' }));
      if (result && typeof result.then === 'function') {
        turn.pendingObservers += 1;
        Promise.resolve(result).then(() => { turn.pendingObservers -= 1; }, () => {
          turn.pendingObservers -= 1;
          turn.observerFailed = true;
          turn.fail('claude_observer_failed');
        });
      }
    } catch { turn.observerFailed = true; turn.fail('claude_observer_failed'); }
  }

  function write(turn, record) {
    if (turn.failure || turn.cancelled || turn.inputClosed) return false;
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) > WIRE_LIMIT) {
      turn.fail('claude_control_write_failed');
      return false;
    }
    // The underlying owned pipe bounds individual writes and its total queue.
    // Split complete JSON records without splitting a UTF-16 surrogate pair.
    for (let start = 0; start < line.length;) {
      let end = Math.min(start + 8_192, line.length);
      if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1])) end -= 1;
      if (!turn.handle?.send(line.slice(start, end))) {
        turn.fail('claude_control_write_failed');
        return false;
      }
      start = end;
    }
    return true;
  }

  function bind(turn, sessionId) {
    if (typeof sessionId !== 'string' || !UUID.test(sessionId) || sessionId !== turn.expectedSessionId
      || (nativeSessionId !== undefined && nativeSessionId !== sessionId)) {
      turn.fail('native_session_mismatch');
      return false;
    }
    if (!turn.sawSession) {
      const resumed = nativeSessionId !== undefined;
      nativeSessionId = sessionId;
      turn.sawSession = true;
      emit(turn, { type: 'session_started', sessionId, resumed });
    }
    return true;
  }

  function abortApprovals(turn) {
    for (const pending of turn.approvals.values()) pending.abort.abort();
  }

  function maybeEndInput(turn) {
    if (turn.inputClosed || turn.failure || turn.cancelled || !turn.resultSeen
      || !turn.sawState || turn.state !== 'idle' || turn.tasks.size || turn.approvals.size) return;
    turn.inputClosed = true;
    clearTimeout(turn.stateTimer);
    if (!turn.handle?.endInput()) { turn.fail('claude_control_write_failed'); return; }
    turn.exitTimer = setTimeout(() => turn.fail('claude_exit_timeout'), 5_000);
  }

  function controlError(turn, requestId, message) {
    write(turn, { type: 'control_response', response: { subtype: 'error', request_id: requestId, error: message } });
  }

  async function approval(turn, record) {
    const requestId = record.request_id;
    if (!validRequestId(requestId) || !object(record.request)) { turn.fail('claude_control_invalid'); return; }
    if (turn.seenRequests.has(requestId) || turn.seenRequests.size >= REQUEST_LIMIT) {
      turn.fail('claude_control_duplicate_or_limit'); return;
    }
    turn.seenRequests.add(requestId);
    const request = record.request;
    if (request.subtype !== 'can_use_tool') {
      turn.unsupportedControl = true;
      controlError(turn, requestId, 'Unsupported control request.');
      return;
    }
    if (!turn.sentPrompt || !turn.sawSession || !text(request.tool_name, 256)
      || !validRequestId(request.tool_use_id) || !object(request.input)
      || (record.session_id !== undefined && record.session_id !== turn.expectedSessionId)
      || (request.session_id !== undefined && request.session_id !== turn.expectedSessionId)) {
      controlError(turn, requestId, 'Permission request does not match the active native session.');
      turn.fail('claude_permission_identity_invalid');
      return;
    }
    if (turn.approvals.size >= PENDING_LIMIT) { turn.fail('claude_approval_limit'); return; }
    const abort = new AbortController();
    const pending = { abort, toolUseId: request.tool_use_id };
    turn.approvals.set(requestId, pending);
    turn.resultSeen = false;
    emit(turn, { type: 'agent_status', status: 'waiting_approval' });
    emit(turn, { type: 'activity', activity: 'permission', status: 'waiting',
      description: 'Native tool approval requested', tool: request.tool_name,
      requestId, toolUseId: request.tool_use_id });
    let timer;
    const unavailable = new Promise(resolve => {
      const finish = () => resolve('deny');
      abort.signal.addEventListener('abort', finish, { once: true });
      timer = setTimeout(finish, Math.max(1, Math.min(120_000, turn.deadline - performance.now())));
    });
    try {
      const callback = typeof onApproval === 'function'
        ? Promise.resolve().then(() => onApproval(Object.freeze({ id: requestId, requestId,
          sessionId: turn.expectedSessionId, agentId: id, kind: 'claude', method: 'can_use_tool', tool: request.tool_name,
          toolUseId: request.tool_use_id, input: structuredClone(request.input),
          description: bounded(request.description ?? request.title, 2048) ?? 'Native Claude tool permission',
          ...(text(request.agent_id, 256) ? { nativeAgentId: request.agent_id } : {}), signal: abort.signal }))).catch(() => 'deny')
        : Promise.resolve('deny');
      const decision = await Promise.race([callback, unavailable]);
      if (abort.signal.aborted || turn.failure || turn.cancelled || turn.approvals.get(requestId) !== pending) return;
      const allowed = decision === 'approve';
      if (!allowed) turn.denied = true;
      write(turn, { type: 'control_response', response: { subtype: 'success', request_id: requestId,
        response: allowed ? { behavior: 'allow', updatedInput: request.input }
          : { behavior: 'deny', message: 'The operator did not approve this native tool request.' } } });
      emit(turn, { type: 'activity', activity: 'permission', status: allowed ? 'approved' : 'denied',
        description: allowed ? 'Native tool request approved' : 'Native tool request denied',
        tool: request.tool_name, requestId, toolUseId: request.tool_use_id });
    } finally {
      clearTimeout(timer);
      turn.approvals.delete(requestId);
      abort.abort();
      if (!turn.approvals.size && !turn.failure && !turn.cancelled) emit(turn, { type: 'agent_status', status: 'running' });
      maybeEndInput(turn);
    }
  }

  function tool(turn, block, parentToolUseId) {
    if (!validRequestId(block.id) || !text(block.name, 256)) return;
    if (!turn.tools.has(block.id) && turn.tools.size >= 256) { turn.fail('claude_tool_limit'); return; }
    const detail = { activity: 'tool', description: 'Native tool call', tool: block.name,
      toolUseId: block.id, ...(parentToolUseId ? { parentToolUseId } : {}) };
    if (block.name === 'Bash' && typeof block.input?.command === 'string') {
      detail.activity = 'command'; detail.description = 'Native command'; detail.command = bounded(block.input.command);
    }
    if (typeof block.input?.file_path === 'string') detail.files = [bounded(block.input.file_path)];
    turn.tools.set(block.id, detail);
    emit(turn, { type: 'activity', ...detail, status: 'started' });
  }

  function record(turn, value) {
    if (!object(value) || typeof value.type !== 'string') { turn.fail('claude_event_invalid'); return; }
    if (value.session_id !== undefined && value.session_id !== turn.expectedSessionId) {
      turn.fail('native_session_mismatch'); return;
    }
    if (value.type === 'control_response') {
      if (!object(value.response) || value.response.request_id !== turn.initializeId || turn.initialized) {
        turn.fail('claude_control_response_mismatch'); return;
      }
      if (value.response.subtype !== 'success' || !object(value.response.response)) {
        turn.fail('claude_control_initialization_failed'); return;
      }
      turn.initialized = true;
      clearTimeout(turn.initializeTimer);
      turn.sentPrompt = write(turn, { type: 'user', session_id: turn.expectedSessionId,
        message: { role: 'user', content: turn.prompt }, parent_tool_use_id: null });
      return;
    }
    if (value.type === 'control_cancel_request') {
      if (!validRequestId(value.request_id)) { turn.fail('claude_control_invalid'); return; }
      turn.approvals.get(value.request_id)?.abort.abort();
      return;
    }
    if (value.type === 'control_request') {
      const task = approval(turn, value);
      turn.approvalTasks.add(task);
      task.finally(() => turn.approvalTasks.delete(task)).catch(() => turn.fail('claude_approval_failed'));
      return;
    }
    if (value.type === 'system') {
      if (value.subtype === 'init') {
        if (bind(turn, value.session_id)) emit(turn, { type: 'agent_status', status: 'running' });
      } else if (value.subtype === 'session_state_changed') {
        if (!text(value.state, 64)) { turn.fail('claude_session_state_invalid'); return; }
        turn.sawState = true;
        turn.state = value.state;
        clearTimeout(turn.stateTimer);
        maybeEndInput(turn);
      }
      if (validRequestId(value.task_id)) {
        if (value.subtype === 'task_started' && DEFERRED_TASK.has(value.task_type)) {
          if (turn.tasks.size >= 256) { turn.fail('claude_task_limit'); return; }
          turn.tasks.add(value.task_id);
        } else if (value.subtype === 'task_notification'
          || (value.subtype === 'task_updated' && TERMINAL_TASK.has(value.patch?.status))) {
          turn.tasks.delete(value.task_id);
        }
      }
      maybeEndInput(turn);
      return;
    }
    const main = value.parent_tool_use_id == null;
    if (main && ['assistant', 'stream_event'].includes(value.type)) {
      // A completed background agent can wake another main-thread turn. Its
      // new result must arrive before stdin can close, even after an earlier result.
      turn.resultSeen = false;
      clearTimeout(turn.stateTimer);
    }
    if (value.type === 'stream_event') {
      const event = value.event;
      if (main && event?.type === 'content_block_delta' && event.delta?.type === 'text_delta'
        && typeof event.delta.text === 'string') {
        turn.partialBytes += Buffer.byteLength(event.delta.text);
        if (turn.partialBytes > TEXT_LIMIT) { turn.fail('claude_text_limit'); return; }
        turn.partialText += event.delta.text;
        turn.streamed = true;
        emit(turn, { type: 'assistant_delta', text: event.delta.text });
      } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        tool(turn, event.content_block, bounded(value.parent_tool_use_id, 256));
      }
      return;
    }
    if (value.type === 'assistant' && Array.isArray(value.message?.content)) {
      const parts = [];
      for (const block of value.message.content) {
        if (main && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
        else if (block.type === 'tool_use') tool(turn, block, bounded(value.parent_tool_use_id, 256));
      }
      if (parts.length) {
        const output = parts.join('\n');
        if (Buffer.byteLength(output) > TEXT_LIMIT) { turn.fail('claude_text_limit'); return; }
        turn.text = output;
        emit(turn, { type: 'assistant_message', text: output, streamed: turn.streamed,
          ...(text(value.message?.id, 256) ? { messageId: value.message.id } : {}) });
      }
      return;
    }
    if (value.type === 'user' && Array.isArray(value.message?.content)) {
      for (const block of value.message.content) if (block.type === 'tool_result' && validRequestId(block.tool_use_id)) {
        const detail = turn.tools.get(block.tool_use_id);
        if (detail) emit(turn, { type: 'activity', ...detail, status: block.is_error ? 'failed' : 'completed' });
        turn.tools.delete(block.tool_use_id);
      }
      return;
    }
    if (value.type !== 'result') return;
    if (!bind(turn, value.session_id)) return;
    turn.resultSeen = true;
    turn.completed = true;
    turn.nativeFailed ||= value.is_error === true || value.subtype !== 'success';
    if (typeof value.result === 'string') {
      if (Buffer.byteLength(value.result) > TEXT_LIMIT) { turn.fail('claude_text_limit'); return; }
      const previous = turn.text;
      turn.text = value.result;
      if (!turn.streamed && turn.text && turn.text !== previous) emit(turn, { type: 'assistant_message', text: turn.text, streamed: false });
    }
    if (Array.isArray(value.permission_denials) && value.permission_denials.length) turn.denied = true;
    turn.usage = usage(value);
    if (turn.usage) emit(turn, { type: 'usage', usage: turn.usage });
    if (!turn.sawState) {
      clearTimeout(turn.stateTimer);
      turn.stateTimer = setTimeout(() => turn.fail('claude_session_state_unavailable'), 2_000);
    }
    maybeEndInput(turn);
  }

  async function authenticate(turn, env) {
    let output = '';
    turn.handle = startCommand({ id, command, args: ['auth', 'status'], cwd, env,
      timeoutMs: Math.max(1, Math.min(10_000, Math.floor(turn.deadline - performance.now()))),
      onEvent(event) {
        if (event.type === 'output' && event.stream === 'stdout' && !turn.failure) {
          output += event.text;
          if (Buffer.byteLength(output) > AUTH_LIMIT) turn.fail('claude_auth_output_limit');
        }
      } });
    turn.handle.endInput();
    const outcome = await turn.handle.completion;
    if (outcome.error === 'cleanup_unconfirmed') return 'cleanup_unconfirmed';
    if (turn.cancelled) return 'native_cancelled';
    let auth;
    try { auth = JSON.parse(output); } catch { return 'claude_auth_unavailable'; }
    if (auth?.loggedIn !== true || !['claude.ai', 'oauth_token'].includes(auth.authMethod)
      || (auth.apiProvider !== undefined && auth.apiProvider !== 'firstParty')) return 'native_subscription_login_required';
    if (outcome.status !== 'succeeded') return 'claude_auth_unavailable';
    return undefined;
  }

  const api = {
    get sessionId() { return nativeSessionId; },
    get pid() { return active?.handle?.pid ?? null; },
    stop() {
      if (!active) return;
      active.cancelled = true;
      abortApprovals(active);
      active.handle?.stop();
    },
    async close() { closed = true; api.stop(); if (active) await active.done; },
    async send(prompt, { signal } = {}) {
      const simple = error => ({ status: 'failed', text: '', error, exitCode: null,
        ...(nativeSessionId ? { sessionId: nativeSessionId } : {}),
        ...(ERRORS[error] ? { errorMessage: ERRORS[error] } : {}) });
      if (active) return simple('native_agent_busy');
      if (closed) return simple('claude_session_closed');
      if (blocked) return simple('native_session_unresolved');
      if (!text(prompt, PROMPT_LIMIT) || !prompt.trim()) return simple('native_prompt_invalid');
      if (signal !== undefined && !(signal instanceof AbortSignal)) return simple('native_signal_invalid');
      if (signal?.aborted) return { ...simple('native_cancelled'), status: 'cancelled' };
      let resolveDone;
      const turn = { prompt, expectedSessionId: nativeSessionId ?? randomUUID(), initializeId: randomUUID(),
        handle: undefined, failure: undefined, cancelled: false, launched: false, initialized: false,
        sawSession: false, sentPrompt: false, sawState: false, state: undefined, resultSeen: false,
        completed: false, nativeFailed: false, denied: false, unsupportedControl: false,
        inputClosed: false, text: '', partialText: '', partialBytes: 0, streamed: false,
        buffer: '', diagnosticTail: '', observerFailed: false, pendingObservers: 0,
        tools: new Map(), tasks: new Set(), approvals: new Map(), approvalTasks: new Set(), seenRequests: new Set(),
        deadline: performance.now() + timeoutMs,
        done: new Promise(resolve => { resolveDone = resolve; }),
        fail(code) { this.failure ??= code; abortApprovals(this); this.handle?.stop(); } };
      active = turn;
      const abort = () => { turn.cancelled = true; abortApprovals(turn); turn.handle?.stop(); };
      signal?.addEventListener('abort', abort, { once: true });
      const env = environment();
      let outcome;
      try {
        emit(turn, { type: 'agent_status', status: 'starting' });
        if (!turn.failure && !turn.cancelled) {
          const error = await authenticate(turn, env);
          if (error) turn.failure ??= error;
        }
        if (performance.now() >= turn.deadline) turn.failure ??= 'timeout';
        if (!turn.failure && !turn.cancelled) {
          const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
            '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio'];
          if (nativeSessionId) args.push(`--resume=${nativeSessionId}`);
          else args.push(`--session-id=${turn.expectedSessionId}`);
          if (model) args.push('--model', model);
          if (effort) args.push('--effort', effort);
          if (mode === 'conversation') args.push('--permission-mode', 'plan', '--tools', 'Read,Glob,Grep', '--disallowedTools', 'mcp__*');
          const line = source => {
            if (!source.trim() || turn.failure) return;
            if (Buffer.byteLength(source) > LINE_LIMIT) { turn.fail('claude_line_limit'); return; }
            // The official transport also ignores startup diagnostic lines on
            // stdout. They never count as a session, permission or completion.
            if (!source.trimStart().startsWith('{')) {
              turn.diagnosticTail = Buffer.from(turn.diagnosticTail + source).subarray(-16_384).toString('utf8');
              return;
            }
            let value;
            try { value = JSON.parse(source); } catch { turn.fail('claude_json_invalid'); return; }
            record(turn, value);
          };
          turn.launched = true;
          turn.handle = startCommand({ id, command, args, cwd, env,
            timeoutMs: Math.max(1, Math.floor(turn.deadline - performance.now())),
            onEvent(event) {
              if (event.type === 'started') { emit(turn, { type: 'started', pid: event.pid }); return; }
              if (event.type === 'output' && event.stream === 'stderr') {
                turn.diagnosticTail = Buffer.from(turn.diagnosticTail + event.text).subarray(-16_384).toString('utf8');
                return;
              }
              if (event.type !== 'output' || event.stream !== 'stdout' || turn.failure) return;
              turn.buffer += event.text;
              let newline;
              while ((newline = turn.buffer.indexOf('\n')) !== -1) {
                const source = turn.buffer.slice(0, newline);
                turn.buffer = turn.buffer.slice(newline + 1);
                line(source);
                if (turn.failure) return;
              }
              if (Buffer.byteLength(turn.buffer) > LINE_LIMIT) turn.fail('claude_line_limit');
            } });
          turn.initializeTimer = setTimeout(() => turn.fail('claude_control_initialization_failed'),
            Math.max(1, Math.min(60_000, turn.deadline - performance.now())));
          write(turn, { type: 'control_request', request_id: turn.initializeId,
            request: { subtype: 'initialize', hooks: null } });
          outcome = await turn.handle.completion;
          if (turn.buffer.trim() && !turn.failure) line(turn.buffer);
        }
      } catch { turn.failure ??= 'claude_launch_failed'; }
      finally {
        abortApprovals(turn);
        await Promise.allSettled([...turn.approvalTasks]);
        clearTimeout(turn.initializeTimer); clearTimeout(turn.stateTimer); clearTimeout(turn.exitTimer);
        if (turn.handle) {
          if (turn.failure || turn.cancelled) turn.handle.stop();
          outcome = await turn.handle.completion;
        }
        signal?.removeEventListener('abort', abort);
        active = undefined;
        resolveDone();
      }
      const error = outcome?.error === 'cleanup_unconfirmed' ? 'cleanup_unconfirmed'
        : turn.failure ?? (turn.cancelled ? 'native_cancelled'
          : outcome?.status !== 'succeeded' ? startupFailure(turn) ?? outcome?.error ?? 'claude_process_failed'
            : !turn.sawSession ? 'native_session_missing' : !turn.completed || !turn.resultSeen ? 'native_completion_missing'
              : !turn.sawState || turn.state !== 'idle' || turn.tasks.size ? 'claude_run_unresolved'
                : turn.denied ? 'native_permission_denied' : turn.unsupportedControl ? 'claude_control_unsupported'
                  : turn.nativeFailed ? 'native_turn_failed' : mode === 'conversation' && !(turn.text || turn.partialText).trim()
                    ? 'native_response_empty' : undefined);
      if (error === 'cleanup_unconfirmed' || (turn.launched && !turn.sawSession)) blocked = true;
      const status = turn.cancelled ? 'cancelled' : error ? 'failed' : 'succeeded';
      const result = { status, text: turn.text || turn.partialText, exitCode: outcome?.exitCode ?? null,
        ...(nativeSessionId ? { sessionId: nativeSessionId } : {}),
        ...(turn.usage ? { usage: turn.usage } : {}), ...(error ? { error } : {}),
        ...(ERRORS[error] ? { errorMessage: ERRORS[error] } : {}),
        ...(outcome?.signal ? { signal: outcome.signal } : {}) };
      emit(turn, { type: 'agent_status', status, ...(error ? { error } : {}) });
      return result;
    },
  };
  return api;
}
