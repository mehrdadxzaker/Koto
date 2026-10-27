import path from 'node:path';
import { startCommand } from './command-session.js';

// Derived from the installed codex-cli 0.163.0 generated v2 schemas, not from
// exec JSON events. Protocol reference: https://developers.openai.com/codex/app-server
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const AGENT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/;
const RPC_LIMIT = 256 * 1024;
const LINE_LIMIT = 1024 * 1024;
const TEXT_LIMIT = 512 * 1024;
const APPROVAL_METHODS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']);
const NATIVE_WORK = new Set(['commandExecution', 'fileChange', 'collabAgentToolCall', 'mcpToolCall', 'dynamicToolCall']);
const FINISHED_AGENT = new Set(['completed', 'errored', 'shutdown']);
const API_ENV = new Set(['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
  'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && ID.test(value);
const requestId = value => typeof value === 'string' && value.length <= 128 || Number.isSafeInteger(value);
const text = (value, maximum) => typeof value === 'string' && value.trim() && !value.includes('\0') && Buffer.byteLength(value) <= maximum;
const detail = (value, maximum = 2048) => typeof value === 'string' ? value.slice(0, maximum) : undefined;
function failure(code) { return Object.assign(new Error(code), { code }); }

/** Stateful native Codex JSON-RPC client. No tokens are read or copied. One
 * explicit operator decision answers one native request; policy amendments,
 * session grants and unknown request types are never automatically accepted.
 * Coding turns close their owned server before returning, while conversation
 * callers must close() their persistent transport when finished.
 */
export function createCodexAppServerSession({ id = 'codex', command, cwd, model, effort,
  account = 'chatgpt', mode = 'conversation', sessionId, timeoutMs = 300_000, onEvent, onApproval, unsetEnv = [] } = {}) {
  if (typeof id !== 'string' || !AGENT_ID.test(id) || !text(command, 4096) || !path.isAbsolute(command) || /\.(cmd|bat)$/i.test(command)
    || !text(cwd, 4096) || !path.isAbsolute(cwd) || account !== 'chatgpt'
    || !['conversation', 'coding'].includes(mode)
    || (model !== undefined && (typeof model !== 'string' || !MODEL.test(model)))
    || (effort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort))
    || (sessionId !== undefined && !validId(sessionId))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000
    || (onEvent !== undefined && typeof onEvent !== 'function')
    || (onApproval !== undefined && typeof onApproval !== 'function')
    || !Array.isArray(unsetEnv) || unsetEnv.length > 32 || unsetEnv.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))) {
    throw new TypeError('Invalid Codex app-server session configuration');
  }
  let threadId = sessionId;
  let rootSessionId;
  let connection;
  let active;
  let blocked = false;
  let closedByCaller = false;
  let nextRequest = 0;
  let pendingObservers = 0;

  const emit = event => {
    if (!onEvent) return;
    if (pendingObservers >= 64) { breakConnection(connection, 'native_observer_overflow'); return; }
    try {
      const value = onEvent(Object.freeze({ ...event, agentId: id, kind: 'codex' }));
      if (value && typeof value.then === 'function') {
        pendingObservers += 1;
        Promise.resolve(value).then(() => { pendingObservers -= 1; }, () => {
          pendingObservers -= 1; breakConnection(connection, 'native_observer_failed');
        });
      }
    } catch { breakConnection(connection, 'native_observer_failed'); }
  };
  const environment = () => Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^GIT_/i.test(key) && !API_ENV.has(key.toUpperCase())
      && !unsetEnv.some(name => process.platform === 'win32' ? name.toUpperCase() === key.toUpperCase() : name === key)));

  function finishTurn(turn, outcome) {
    if (turn.settled) return;
    turn.settled = true;
    turn.terminalOutcome = outcome;
    turn.resolveReady(false);
    clearTimeout(turn.timer);
    clearTimeout(turn.interruptTimer);
    turn.resolve(outcome);
  }

  function breakConnection(current, code) {
    if (!current || current.closed) {
      if (active && !active.connection) finishTurn(active, { error: code });
      return;
    }
    if (current.parentCompleted) current.observationLost = true;
    current.error ??= code;
    current.broken = true;
    for (const pending of current.pending.values()) { clearTimeout(pending.timer); pending.reject(failure(code)); }
    current.pending.clear();
    for (const approval of current.approvals.values()) { approval.cancelled = true; approval.controller.abort(); }
    current.approvals.clear();
    current.handle?.stop();
    if (active?.connection === current) finishTurn(active, { error: code });
  }

  function sendMessage(current, message) {
    if (!current || current.closed || current.broken) throw failure('native_transport_closed');
    const encoded = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(encoded) > RPC_LIMIT) throw failure('native_rpc_input_limit');
    for (let offset = 0; offset < encoded.length;) {
      let end = Math.min(offset + 16_384, encoded.length);
      if (end < encoded.length && /[\uD800-\uDBFF]/.test(encoded[end - 1])) end -= 1;
      if (!current.handle.send(encoded.slice(offset, end))) {
        breakConnection(current, 'native_rpc_input_rejected');
        throw failure('native_rpc_input_rejected');
      }
      offset = end;
    }
  }

  function rpc(current, method, params, maximum = 15_000) {
    if (current.pending.size >= 64) return Promise.reject(failure('native_rpc_queue_limit'));
    const request = ++nextRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => breakConnection(current, 'native_rpc_timeout'), Math.max(1, maximum));
      current.pending.set(request, { resolve, reject, timer });
      try { sendMessage(current, { id: request, method, params }); }
      catch (error) { clearTimeout(timer); current.pending.delete(request); reject(error); }
    });
  }

  function respond(current, request, payload, unsupported = false) {
    try {
      sendMessage(current, unsupported ? { id: request, error: { code: -32601, message: 'Unsupported server request' } }
        : { id: request, result: payload });
    } catch { breakConnection(current, 'native_approval_response_failed'); }
  }

  async function approvalRequest(current, message) {
    if (!APPROVAL_METHODS.has(message.method)) { respond(current, message.id, undefined, true); return; }
    const params = message.params;
    const turn = active;
    if (!turn || turn.connection !== current || turn.settled || turn.cancelled || !turn.startRequested
      || !object(params) || params.threadId !== threadId || !validId(params.turnId) || !validId(params.itemId)
      || current.approvals.has(message.id) || current.approvals.size >= 32) {
      respond(current, message.id, { decision: 'decline' });
      return;
    }
    const entry = { controller: new AbortController(), cancelled: false, turn };
    current.approvals.set(message.id, entry);
    const cancelled = new Promise(resolve => entry.controller.signal.addEventListener('abort', () => resolve('deny'), { once: true }));
    // Tool requests can reach the transport before turn/start's response.
    // Wait for an acknowledged/started turn identity instead of discarding or
    // approving an event for an unconfirmed turn.
    if (!turn.turnId) await Promise.race([turn.ready, cancelled]);
    if (entry.cancelled || turn.settled || turn.cancelled || turn !== active || params.turnId !== turn.turnId) {
      if (!entry.cancelled && !current.closed) respond(current, message.id, { decision: 'decline' });
      entry.cancelled = true; entry.controller.abort(); current.approvals.delete(message.id);
      return;
    }
    const item = current.items.get(params.itemId);
    const commandPreview = typeof params.command === 'string' ? params.command
      : item?.type === 'commandExecution' ? item.command : undefined;
    const commandCwd = typeof params.cwd === 'string' ? params.cwd
      : item?.type === 'commandExecution' ? item.cwd : undefined;
    const fileApproval = message.method === 'item/fileChange/requestApproval';
    const visibleAction = fileApproval
      ? item?.type === 'fileChange' && Array.isArray(item.changes) && item.changes.length > 0
      : Boolean(commandPreview) || object(params.networkApprovalContext);
    // grantRoot may widen a whole session; this minimal adapter only supports
    // one-action approval. Unknown command/input approval kinds fail closed.
    const supported = visibleAction && !params.grantRoot && (params.kind === undefined || params.kind === 'command')
      && (!item?.changes || item.changes.length <= 64);
    emit({ type: 'agent_status', status: 'waiting_permission' });
    emit({ type: 'activity', activity: 'permission_request', status: 'waiting', description: 'Native approval requested',
      requestId: message.id, threadId, turnId: turn.turnId, itemId: params.itemId });
    const payload = { requestId: message.id, method: message.method, threadId, turnId: turn.turnId,
      itemId: params.itemId, signal: entry.controller.signal,
      ...(typeof commandPreview === 'string' ? { command: commandPreview } : {}),
      ...(typeof commandCwd === 'string' ? { cwd: commandCwd } : {}),
      ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
      ...(Array.isArray(params.availableDecisions) ? { availableDecisions: params.availableDecisions } : {}),
      ...(params.networkApprovalContext ? { networkApprovalContext: params.networkApprovalContext } : {}),
      ...(item?.changes ? { changes: item.changes } : {}) };
    let timer;
    let decision = 'deny';
    try {
      if (supported && onApproval && Buffer.byteLength(JSON.stringify({ ...payload, signal: undefined })) <= 64 * 1024) {
        decision = await Promise.race([
          Promise.resolve().then(() => entry.cancelled ? 'deny' : onApproval(Object.freeze(payload))),
          cancelled,
          new Promise(resolve => { timer = setTimeout(() => resolve('deny'), Math.max(1, Math.min(60_000, turn.deadline - performance.now()))); }),
        ]);
      }
    } catch { decision = 'deny'; }
    finally { clearTimeout(timer); }
    if (entry.cancelled || turn !== active || turn.settled || turn.cancelled || current.closed) return;
    const acceptAvailable = !Array.isArray(params.availableDecisions) || params.availableDecisions.includes('accept');
    const nativeDecision = decision === 'approve' && acceptAvailable ? 'accept' : 'decline';
    if (nativeDecision === 'accept') turn.approved += 1; else turn.denied += 1;
    // A response completes this local question. Do not depend on a later
    // serverRequest/resolved notification to release the bounded prompt slot.
    current.approvals.delete(message.id);
    entry.cancelled = true; entry.controller.abort();
    respond(current, message.id, { decision: nativeDecision });
    emit({ type: 'activity', activity: 'permission_decision', status: nativeDecision === 'accept' ? 'approved' : 'denied',
      description: nativeDecision === 'accept' ? 'Operator approved native action' : 'Native action denied', requestId: message.id });
    if (active === turn && !turn.settled && !turn.cancelled && current.approvals.size === 0) {
      emit({ type: 'agent_status', status: 'running' });
    }
  }

  function bindTurn(current, turn, value) {
    if (!validId(value) || turn.turnId && turn.turnId !== value) {
      breakConnection(current, 'native_turn_mismatch'); return false;
    }
    turn.turnId = value;
    turn.resolveReady(true);
    const early = turn.earlyEvents.splice(0);
    for (const event of early) notification(current, event.method, event.params);
    return true;
  }

  function rememberWork(current, owner, item, method) {
    if (!NATIVE_WORK.has(item.type)) return;
    if (!validId(owner) || !validId(item.id)) { current.unknownWork = true; return; }
    const key = `${owner}/${item.id}`;
    // item/completed is a tool notification, not necessarily process/agent
    // completion. Unified-exec background commands can still be inProgress.
    const terminal = item.type === 'collabAgentToolCall'
      ? ['completed', 'failed', 'interrupted'].includes(item.status)
      : ['commandExecution', 'fileChange'].includes(item.type)
        ? ['completed', 'failed', 'declined'].includes(item.status) : ['completed', 'failed'].includes(item.status);
    if (method === 'item/completed' && terminal) current.work.delete(key);
    else {
      if (current.work.size >= 256 && !current.work.has(key)) {
        current.unknownWork = true; breakConnection(current, 'cleanup_unconfirmed'); return;
      }
      current.work.set(key, false);
    }
    if (item.type !== 'collabAgentToolCall') return;
    if (!Array.isArray(item.receiverThreadIds) || !object(item.agentsStates)) {
      current.unknownWork = true; return;
    }
    const receivers = new Set([...item.receiverThreadIds, ...Object.keys(item.agentsStates)]);
    if (receivers.size > 256) { current.unknownWork = true; breakConnection(current, 'cleanup_unconfirmed'); return; }
    for (const receiver of receivers) {
      if (receiver === threadId) continue;
      if (!rememberDelegate(current, receiver)) return;
      const state = item.agentsStates[receiver];
      // A previous completed state cannot establish the outcome of a new
      // send/resume/close operation whose target state is absent now.
      current.delegates.set(receiver, object(state) && FINISHED_AGENT.has(state.status) ? state.status : 'unknown');
    }
    if (item.status === 'completed' && ['spawnAgent', 'resumeAgent', 'followupTask', 'sendInput'].includes(item.tool)
      && receivers.size === 0) current.unknownWork = true;
  }

  function rememberDelegate(current, receiver) {
    if (!validId(receiver)) { current.unknownWork = true; return false; }
    if (!current.delegates.has(receiver)) {
      if (current.delegates.size >= 256) {
        current.unknownWork = true; breakConnection(current, 'cleanup_unconfirmed'); return false;
      }
      current.delegates.set(receiver, 'unknown');
    }
    return true;
  }

  function unresolvedWork(current) {
    return Boolean(current && (current.unknownWork || current.observationLost || current.turns.size > 0 || current.work.size > 0
      || [...current.delegates.values()].some(status => !FINISHED_AGENT.has(status))));
  }

  function rememberTurn(current, owner, method, turn) {
    if (!validId(turn?.id)) { current.unknownWork = true; return; }
    const key = `${owner}/${turn.id}`;
    if (method === 'turn/completed' && ['completed', 'interrupted', 'failed'].includes(turn.status)) {
      current.turns.delete(key);
    } else if (method === 'turn/started') {
      if (current.turns.size >= 256 && !current.turns.has(key)) {
        current.unknownWork = true; breakConnection(current, 'cleanup_unconfirmed'); return;
      }
      current.turns.add(key);
    } else current.unknownWork = true;
  }

  function notification(current, method, params) {
    if (!object(params)) return;
    if (method === 'thread/started' && object(params.thread)) {
      const child = params.thread;
      const parent = child.parentThreadId ?? child.source?.subAgent?.thread_spawn?.parent_thread_id;
      if (child.id !== threadId && (parent === threadId || current.delegates.has(parent))) rememberDelegate(current, child.id);
    }
    if ((params.threadId === threadId || current.delegates.has(params.threadId)) && ['turn/started', 'turn/completed'].includes(method)) {
      rememberTurn(current, params.threadId, method, params.turn);
    }
    // Child activity is separate from the parent's turn. Only track descendants
    // actually attributed by native thread/collaboration events, and retain
    // uncertainty when a thread is merely idle, unloaded or missing.
    if (params.threadId !== threadId && current.delegates.has(params.threadId)) {
      if (['item/started', 'item/completed'].includes(method) && object(params.item)) {
        rememberWork(current, params.threadId, params.item, method);
      } else if (method === 'turn/completed') {
        current.delegates.set(params.threadId, params.turn?.status === 'completed' ? 'completed'
          : params.turn?.status === 'failed' ? 'errored' : 'unknown');
      } else if (method === 'turn/started'
        || method === 'thread/status/changed' && ['active', 'systemError'].includes(params.status?.type)) {
        current.delegates.set(params.threadId, 'unknown');
      }
      return;
    }
    if ((!active || active.connection !== current || active.settled || !active.startRequested) && params.threadId === threadId
      && ['item/started', 'item/completed'].includes(method) && object(params.item)) {
      rememberWork(current, params.threadId, params.item, method);
      return;
    }
    if (method === 'serverRequest/resolved') {
      if (params.threadId !== threadId) return;
      const entry = current.approvals.get(params.requestId);
      if (entry) { entry.cancelled = true; entry.controller.abort(); current.approvals.delete(params.requestId); }
      if (active && current.approvals.size === 0) emit({ type: 'agent_status', status: 'running' });
      return;
    }
    const turn = active;
    if (!turn || turn.connection !== current || turn.settled || !turn.startRequested || params.threadId !== threadId) return;
    if (method === 'turn/started') {
      if (!bindTurn(current, turn, params.turn?.id)) return;
      emit({ type: 'agent_status', status: 'running' });
      return;
    }
    if (method === 'turn/completed') {
      if (!validId(params.turn?.id) || turn.turnId && turn.turnId !== params.turn.id
        || !['completed', 'interrupted', 'failed'].includes(params.turn?.status)) {
        breakConnection(current, 'native_turn_mismatch'); return;
      }
      if (!bindTurn(current, turn, params.turn.id)) return;
      for (const [key, entry] of current.approvals) if (entry.turn === turn) {
        entry.cancelled = true; entry.controller.abort(); current.approvals.delete(key);
      }
      // A parent turn ending does not await native children or a background
      // command. Neither shutting down our server nor its exit code supplies
      // a missing native completion observation for that work.
      current.parentCompleted = true;
      const incomplete = unresolvedWork(current);
      if (incomplete) emit({ type: 'activity', activity: 'native_work', status: 'unknown', description: 'Native work completion unconfirmed' });
      finishTurn(turn, { nativeStatus: params.turn.status, ...(incomplete ? { error: 'cleanup_unconfirmed' } : {}) });
      return;
    }
    if (!turn.turnId && turn.startRequested && validId(params.turnId)
      && ['item/agentMessage/delta', 'item/started', 'item/completed', 'error', 'thread/tokenUsage/updated'].includes(method)) {
      if (params.item?.type === 'reasoning') return;
      if (turn.earlyEvents.length >= 256) { breakConnection(current, 'native_event_queue_limit'); return; }
      turn.earlyEvents.push({ method, params }); return;
    }
    if (params.turnId !== turn.turnId) return;
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      turn.deltaText += params.delta;
      if (Buffer.byteLength(turn.deltaText) > TEXT_LIMIT) { breakConnection(current, 'native_text_limit'); return; }
      if (validId(params.itemId)) {
        if (turn.streamedItems.size >= 256 && !turn.streamedItems.has(params.itemId)) { breakConnection(current, 'native_activity_limit'); return; }
        turn.streamedItems.add(params.itemId);
      }
      emit({ type: 'assistant_delta', text: params.delta });
    } else if (['item/started', 'item/completed'].includes(method) && object(params.item)) {
      const item = params.item;
      rememberWork(current, params.threadId, item, method);
      if (['fileChange', 'commandExecution'].includes(item.type) && validId(item.id)) {
        if (current.items.size >= 256 && !current.items.has(item.id)) { breakConnection(current, 'native_activity_limit'); return; }
        current.items.set(item.id, item.type === 'fileChange' ? { type: item.type, changes: item.changes }
          : { type: item.type, command: item.command, cwd: item.cwd });
      }
      const status = typeof item.status === 'string' ? item.status === 'inProgress' ? 'running'
        : ['completed', 'failed', 'declined', 'interrupted'].includes(item.status) ? item.status : 'unknown'
        : NATIVE_WORK.has(item.type) ? 'unknown' : method === 'item/completed' ? 'completed' : 'started';
      if (item.type === 'agentMessage' && method === 'item/completed' && typeof item.text === 'string') {
        if (Buffer.byteLength(item.text) > TEXT_LIMIT) { breakConnection(current, 'native_text_limit'); return; }
        turn.text = item.text;
        emit({ type: 'assistant_message', text: item.text, messageId: item.id, streamed: turn.streamedItems.has(item.id) });
      } else if (item.type === 'commandExecution') {
        emit({ type: 'activity', activity: 'command', description: 'Native command', status, command: detail(item.command) });
      } else if (item.type === 'fileChange') {
        emit({ type: 'activity', activity: 'file_change', description: 'Native file changes', status,
          files: Array.isArray(item.changes) ? item.changes.slice(0, 64).map(change => detail(change.path)).filter(Boolean) : [] });
      } else if (item.type === 'collabAgentToolCall') {
        emit({ type: 'activity', activity: 'delegation', description: 'Native agent operation', status, tool: detail(item.tool, 128) });
      } else if (item.type === 'mcpToolCall') {
        emit({ type: 'activity', activity: 'tool', description: 'Native tool call', status, tool: detail(item.tool, 128) });
      }
    } else if (method === 'error') {
      emit({ type: 'activity', activity: 'native_turn', description: params.willRetry ? 'Native transport retry reported' : 'Native error reported', status: 'failed' });
    } else if (method === 'thread/tokenUsage/updated' && object(params.tokenUsage?.last)) {
      const source = params.tokenUsage.last;
      const usage = { actualCostUsd: null, scope: 'turn' };
      for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens', 'totalTokens', 'cacheWriteInputTokens']) {
        if (Number.isSafeInteger(source[key]) && source[key] >= 0) usage[key] = source[key];
      }
      turn.usage = usage;
      emit({ type: 'usage', usage });
    }
  }

  function parseLine(current, line) {
    let message;
    try { message = JSON.parse(line); } catch { breakConnection(current, 'native_json_invalid'); return; }
    if (!object(message)) { breakConnection(current, 'native_event_invalid'); return; }
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        if (!requestId(message.id)) { breakConnection(current, 'native_request_id_invalid'); return; }
        void approvalRequest(current, message).catch(() => breakConnection(current, 'native_approval_failed'));
      } else notification(current, message.method, message.params);
      return;
    }
    const pending = current.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); current.pending.delete(message.id);
    if (object(message.error)) pending.reject(failure('native_rpc_failed'));
    else if ('result' in message) pending.resolve(message.result);
    else pending.reject(failure('native_rpc_response_invalid'));
  }

  function startupError(current, fallback) {
    if (/read-only file system|\bEROFS\b|os error 30/i.test(current?.diagnostics ?? '')) return 'native_state_not_writable';
    return current?.error ?? fallback;
  }

  async function ensureConnection(turn) {
    if (connection && !connection.closed && !connection.broken) { turn.connection = connection; return connection; }
    if (connection?.handle && !connection.closed) await shutdownConnection(connection);
    if (blocked) throw failure('native_session_unresolved');
    const current = { pending: new Map(), approvals: new Map(), items: new Map(), work: new Map(), delegates: new Map(), turns: new Set(), unknownWork: false,
      observationLost: false, parentCompleted: false, buffer: '', diagnostics: '',
      closed: false, broken: false, error: undefined, outcome: undefined, initialized: false, closePromise: undefined };
    connection = current;
    turn.connection = current;
    current.handle = startCommand({ id, command, cwd, env: environment(), timeoutMs: 3_600_000,
      args: ['app-server', '--listen', 'stdio://', '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"'],
      onEvent(event) {
        if (event.type === 'started') { emit({ type: 'started', pid: event.pid }); return; }
        if (event.type !== 'output') return;
        if (event.stream === 'stderr') {
          current.diagnostics = Buffer.from(current.diagnostics + event.text).subarray(-16_380).toString('utf8'); return;
        }
        if (current.broken) return;
        current.buffer += event.text;
        let newline;
        while ((newline = current.buffer.indexOf('\n')) !== -1) {
          const line = current.buffer.slice(0, newline); current.buffer = current.buffer.slice(newline + 1);
          if (Buffer.byteLength(line) > LINE_LIMIT) { breakConnection(current, 'native_line_limit'); return; }
          if (line.trim()) parseLine(current, line);
          if (current.broken) return;
        }
        if (Buffer.byteLength(current.buffer) > LINE_LIMIT) breakConnection(current, 'native_line_limit');
      } });
    current.handle.completion.then(outcome => {
      current.closed = true; current.outcome = outcome;
      if (current.parentCompleted && (outcome.error || current.buffer.trim())) current.observationLost = true;
      if (outcome.error === 'cleanup_unconfirmed' || unresolvedWork(current)) blocked = true;
      const error = startupError(current, outcome.error ?? 'native_transport_closed');
      for (const pending of current.pending.values()) { clearTimeout(pending.timer); pending.reject(failure(error)); }
      current.pending.clear();
      for (const entry of current.approvals.values()) { entry.cancelled = true; entry.controller.abort(); }
      current.approvals.clear();
      if (active?.connection === current) finishTurn(active, { error });
    });
    await rpc(current, 'initialize', { clientInfo: { name: 'koto', title: 'Koto', version: '3.0.0-alpha.0' },
      capabilities: { experimentalApi: false } }, Math.min(15_000, timeoutMs));
    sendMessage(current, { method: 'initialized' });
    const accountInfo = await rpc(current, 'account/read', { refreshToken: false });
    if (accountInfo?.account?.type !== 'chatgpt') throw failure('native_chatgpt_login_required');
    current.initialized = true;
    return current;
  }

  async function shutdownConnection(current) {
    if (!current?.handle) return undefined;
    if (current.closePromise) return current.closePromise;
    current.closePromise = (async () => {
      current.handle.endInput();
      const timer = setTimeout(() => current.handle.stop(), 500);
      try { return await current.handle.completion; }
      finally { clearTimeout(timer); }
    })();
    return current.closePromise;
  }

  const api = {
    get pid() { return connection && !connection.closed ? connection.handle?.pid ?? null : null; },
    get sessionId() { return threadId; },
    stop() {
      const turn = active;
      if (!turn || turn.settled || turn.cancelled) return;
      turn.cancelled = true;
      const current = turn.connection;
      if (!current) { finishTurn(turn, { error: 'native_cancelled' }); return; }
      for (const [key, entry] of current.approvals) {
        entry.cancelled = true; entry.controller.abort();
        respond(current, key, { decision: 'cancel' }); current.approvals.delete(key);
      }
      if (turn.turnId && !current.closed && !current.broken) {
        void rpc(current, 'turn/interrupt', { threadId, turnId: turn.turnId }, 1500).catch(() => current.handle.stop());
        turn.interruptTimer = setTimeout(() => current.handle.stop(), 2000);
      } else { current.handle.stop(); finishTurn(turn, { error: 'native_cancelled' }); }
    },
    async close() {
      closedByCaller = true;
      api.stop();
      const current = connection;
      const outcome = await shutdownConnection(current);
      if (unresolvedWork(current)) {
        blocked = true;
        return { ...outcome, status: 'failed', exitCode: outcome?.exitCode ?? null, error: 'cleanup_unconfirmed' };
      }
      return outcome;
    },
    async send(prompt, { signal } = {}) {
      const simple = error => ({ status: 'failed', text: '', error, ...(threadId ? { sessionId: threadId } : {}), exitCode: null });
      if (active) return simple('native_agent_busy');
      if (closedByCaller || blocked) return simple(blocked ? 'native_session_unresolved' : 'native_session_closed');
      if (!text(prompt, 64 * 1024) || signal !== undefined && !(signal instanceof AbortSignal)) return simple('native_prompt_invalid');
      if (signal?.aborted) return { ...simple('native_cancelled'), status: 'cancelled' };
      let resolve;
      const terminal = new Promise(done => { resolve = done; });
      let resolveReady;
      const ready = new Promise(done => { resolveReady = done; });
      const turn = { resolve, terminal, settled: false, cancelled: false, turnId: undefined, connection: undefined,
        ready, resolveReady, earlyEvents: [], startRequested: false,
        deadline: performance.now() + timeoutMs, text: '', deltaText: '', streamedItems: new Set(), usage: undefined, approved: 0, denied: 0 };
      active = turn;
      const abort = () => api.stop();
      signal?.addEventListener('abort', abort, { once: true });
      turn.timer = setTimeout(() => {
        breakConnection(turn.connection, 'timeout');
        if (!turn.connection) finishTurn(turn, { error: 'timeout' });
      }, timeoutMs);
      let final;
      let processOutcome;
      try {
        emit({ type: 'agent_status', status: 'starting' });
        if (turn.settled) throw failure(turn.terminalOutcome?.error ?? 'native_observer_failed');
        const current = await ensureConnection(turn);
        turn.connection = current;
        if (turn.cancelled || turn.settled) throw failure(current.error ?? 'native_cancelled');
        const sandbox = mode === 'coding' ? 'workspace-write' : 'read-only';
        const common = { cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox, ...(model ? { model } : {}) };
        const resumed = threadId !== undefined;
        const opened = await rpc(current, resumed ? 'thread/resume' : 'thread/start',
          resumed ? { ...common, threadId, excludeTurns: true } : common);
        if (!validId(opened?.thread?.id) || resumed && opened.thread.id !== threadId
          || path.resolve(opened.cwd ?? '') !== path.resolve(cwd)
          || opened.sandbox?.type !== (mode === 'coding' ? 'workspaceWrite' : 'readOnly')
          || opened.approvalPolicy !== 'on-request' || opened.approvalsReviewer !== 'user'
          || opened.modelProvider !== 'openai') throw failure('native_effective_policy_mismatch');
        threadId = opened.thread.id;
        rootSessionId = opened.thread.sessionId;
        current.items.clear();
        emit({ type: 'session_started', sessionId: threadId, rootSessionId, resumed });
        if (turn.cancelled || turn.settled) throw failure(current.error ?? 'native_cancelled');
        turn.startRequested = true;
        const started = await rpc(current, 'turn/start', { threadId, cwd, input: [{ type: 'text', text: prompt }],
          approvalPolicy: 'on-request', approvalsReviewer: 'user', ...(model ? { model } : {}), ...(effort ? { effort } : {}),
          sandboxPolicy: mode === 'coding' ? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false }
            : { type: 'readOnly', networkAccess: false } });
        if (!bindTurn(current, turn, started?.turn?.id)) throw failure('native_turn_mismatch');
        final = await terminal;
      } catch (error) {
        final = { error: error.code ?? 'native_app_server_failed' };
        if (turn.connection) breakConnection(turn.connection, final.error);
      } finally {
        clearTimeout(turn.timer); clearTimeout(turn.interruptTimer);
        signal?.removeEventListener('abort', abort);
        if (mode === 'coding' || final?.error || turn.cancelled) processOutcome = await shutdownConnection(turn.connection);
        active = undefined;
      }
      const error = processOutcome?.error === 'cleanup_unconfirmed' || unresolvedWork(turn.connection) ? 'cleanup_unconfirmed'
        : (final?.error || turn.connection?.error ? startupError(turn.connection, final?.error) : undefined) ?? processOutcome?.error ?? (turn.cancelled || final?.nativeStatus === 'interrupted' ? 'native_cancelled'
          : final?.nativeStatus !== 'completed' ? 'native_turn_failed'
            : mode === 'conversation' && !(turn.text || turn.deltaText).trim() ? 'native_response_empty' : undefined);
      if (error === 'cleanup_unconfirmed' || error === 'native_effective_policy_mismatch') blocked = true;
      const status = turn.cancelled || final?.nativeStatus === 'interrupted' ? 'cancelled' : error ? 'failed' : 'succeeded';
      const result = { status, text: turn.text || turn.deltaText, ...(threadId ? { sessionId: threadId } : {}),
        ...(rootSessionId ? { rootSessionId } : {}), ...(turn.usage ? { usage: turn.usage } : {}),
        approvals: { approved: turn.approved, denied: turn.denied }, ...(error ? { error } : {}),
        ...(error === 'native_state_not_writable' ? { errorMessage: 'Codex requires a writable native runtime home. Use its supported account-owned environment without moving managed credentials.' } : {}),
        exitCode: processOutcome?.exitCode ?? null, ...(processOutcome?.signal ? { signal: processOutcome.signal } : {}) };
      emit({ type: 'agent_status', status, ...(error ? { error } : {}) });
      return result;
    },
  };
  return api;
}
