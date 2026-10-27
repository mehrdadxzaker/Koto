import { createHash } from 'node:crypto';
import path from 'node:path';

const KINDS = new Set(['codex', 'opencode']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 100_000;
const MAX_STEPS = 4096;

function fail(code) {
  throw Object.assign(new Error(code), { name: 'NativeAgentError', code });
}

function nonempty(value, maximum = 65_536) {
  return typeof value === 'string' && value.trim().length > 0
    && !value.includes('\0') && Buffer.byteLength(value) <= maximum;
}

/** Native metadata is an explicit adapter declaration, never command discovery. */
export function normalizeNativeAgent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['kind', 'protocol', 'model', 'account', 'effort', 'sandbox'].includes(key))
    || !KINDS.has(value.kind)) fail('native_agent_invalid');
  const protocol = value.protocol ?? 'jsonl';
  const account = value.account ?? 'host';
  if (!['jsonl', 'terminal'].includes(protocol)
    || !['host', ...(value.kind === 'codex' ? ['chatgpt'] : [])].includes(account)
    || (value.model !== undefined && (typeof value.model !== 'string' || !MODEL.test(value.model)))
    || (value.effort !== undefined && (value.kind !== 'codex' || !EFFORTS.has(value.effort)))
    || (value.sandbox !== undefined && (value.kind !== 'codex' || !['read-only', 'workspace-write'].includes(value.sandbox)))) {
    fail('native_agent_invalid');
  }
  return Object.freeze({ kind: value.kind, protocol, account,
    ...(value.model === undefined ? {} : { model: value.model }),
    ...(value.effort === undefined ? {} : { effort: value.effort }),
    ...(value.kind === 'codex' ? { sandbox: value.sandbox ?? 'workspace-write' } : {}) });
}

/** A terminal's human interface is not a machine-readable lifecycle protocol. */
export function describeNativeCapabilities(kind, transport = 'pipe') {
  const native = normalizeNativeAgent(typeof kind === 'string'
    ? { kind, protocol: transport === 'pty' ? 'terminal' : 'jsonl' } : kind);
  if (!['pipe', 'pty'].includes(transport)) fail('native_transport_invalid');
  const structured = transport === 'pipe' && native.protocol === 'jsonl';
  return Object.freeze({ structuredEvents: structured, nativeSessionId: structured,
    completion: structured, usage: structured, resume: structured,
    interactiveInput: transport === 'pty', permissionRequests: false,
    permissionDecisions: structured && native.kind === 'codex',
    terminalOutput: transport === 'pty' });
}

function validSessionId(kind, value) {
  return typeof value === 'string' && (kind === 'codex'
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    : /^ses_[A-Za-z0-9]{8,128}$/.test(value));
}

function origin({ native, command, args, transport = 'pipe', unsetEnv = [], workspace }) {
  const adapter = normalizeNativeAgent(native);
  if (!nonempty(command, 4096) || !path.isAbsolute(command)
    || !Array.isArray(args) || args.length > 128 || args.some(arg => typeof arg !== 'string' || arg.includes('\0') || Buffer.byteLength(arg) > 65_536)
    || !['pipe', 'pty'].includes(transport)
    || (adapter.protocol === 'jsonl') !== (transport === 'pipe')
    || !nonempty(workspace, 4096) || !path.isAbsolute(workspace)
    || !Array.isArray(unsetEnv) || unsetEnv.length > 32
    || unsetEnv.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))) {
    fail('native_origin_invalid');
  }
  return { native: adapter, command, args: [...args], transport,
    unsetEnv: [...unsetEnv].sort(), workspace: path.resolve(workspace) };
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function resumePrefix(source) {
  const args = source.args;
  const forbidden = ['--last', '--continue', '--fork', '--ephemeral', '--session', '-s', '--',
    ...(source.native.kind === 'opencode' ? ['-c'] : [])];
  if (source.transport !== 'pipe' || args.at(-1) !== '{prompt}' || source.native.model === undefined
    || args.some(arg => forbidden.includes(arg.split('=', 1)[0]))
    || args.slice(0, -1).some(arg => /\{(?:prompt|project|goal|agent)\}/.test(arg))) {
    fail('native_resume_invocation_unsupported');
  }
  const modelIndex = args.indexOf('--model');
  if (modelIndex < 0 || args[modelIndex + 1] !== source.native.model) fail('native_resume_model_unbound');
  if (source.native.kind === 'codex') {
    if (args[0] !== 'exec' || !args.includes('--json') || args.includes('resume')) fail('native_resume_invocation_unsupported');
  } else {
    const formatIndex = args.indexOf('--format');
    if (args[0] !== 'run' || formatIndex < 0 || args[formatIndex + 1] !== 'json') fail('native_resume_invocation_unsupported');
  }
  return args.slice(0, -1).map(arg => arg.replaceAll('{workspace}', () => source.workspace));
}

/** Observe bounded native stdout JSONL. stderr and terminal text are never parsed.
 * args must be the original plan's templates, including its {prompt} argument,
 * and command must be the resolved executable recorded for that plan.
 */
export function createNativeObserver(options) {
  const source = origin(options);
  const { native } = source;
  const expectedSessionId = options.expectedSessionId;
  if (expectedSessionId !== undefined && !validSessionId(native.kind, expectedSessionId)) fail('native_session_id_invalid');
  const capabilities = describeNativeCapabilities(native, source.transport);
  let resumeSupported = capabilities.resume;
  try { resumePrefix(source); } catch { resumeSupported = false; }
  const observed = { schemaVersion: 1, kind: native.kind, protocol: native.protocol,
    affinity: fingerprint(source), capabilities, sessionId: expectedSessionId ?? null,
    status: 'unobserved', ended: false, resumable: false,
    turnsCompleted: 0, turnsFailed: 0, stepsCompleted: 0,
    permissionsDenied: 0, diagnostics: 0, unknownEvents: 0,
    usage: { inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null,
      outputTokens: null, reasoningOutputTokens: null, cost: null } };
  let buffer = '';
  let bytes = 0;
  let records = 0;
  let terminalMarker = false;
  let pendingError = false;
  let identityObserved = false;
  const steps = new Set();
  const decisions = new Set();

  function protocolError(code) {
    observed.protocolError ??= code;
    observed.status = 'unknown';
    terminalMarker = false;
    buffer = '';
  }

  function session(value) {
    if (!validSessionId(native.kind, value)) { protocolError('native_session_id_invalid'); return false; }
    if ((expectedSessionId !== undefined && value !== expectedSessionId)
      || (observed.sessionId !== null && observed.sessionId !== value)) {
      protocolError('native_session_id_changed');
      return false;
    }
    observed.sessionId = value;
    identityObserved = true;
    return true;
  }

  function usage(values) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const previous = observed.usage[key] ?? 0;
      if ((key === 'cost' ? !Number.isFinite(value) || value < 0 : !count(value))
        || !Number.isFinite(previous + value)
        || (key !== 'cost' && !Number.isSafeInteger(previous + value))) {
        protocolError('native_usage_invalid');
        return;
      }
      observed.usage[key] = previous + value;
    }
  }

  function codex(event) {
    if (event.type === 'thread.started') { session(event.thread_id); return; }
    if (event.type === 'turn.started') {
      terminalMarker = false;
      observed.status = 'running';
      return;
    }
    if (event.type === 'turn.completed') {
      if (!identityObserved || !event.usage || typeof event.usage !== 'object' || Array.isArray(event.usage)) {
        protocolError('native_completion_invalid'); return;
      }
      observed.turnsCompleted += 1;
      usage({ inputTokens: event.usage.input_tokens, cachedInputTokens: event.usage.cached_input_tokens,
        cacheWriteInputTokens: event.usage.cache_write_input_tokens, outputTokens: event.usage.output_tokens,
        reasoningOutputTokens: event.usage.reasoning_output_tokens });
      terminalMarker = true;
      pendingError = false;
      // Completion also requires the process outcome in end().
      observed.status = 'running';
      return;
    }
    if (event.type === 'turn.failed') {
      observed.turnsFailed += 1;
      observed.status = 'failed';
      terminalMarker = false;
      return;
    }
    if (event.type === 'error') {
      observed.diagnostics += 1;
      pendingError = true;
      terminalMarker = false;
      return;
    }
    if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
      const item = event.item;
      if (item?.type === 'command_execution' && item.status === 'declined') {
        if (!nonempty(item.id, 256)) { protocolError('native_item_invalid'); return; }
        if (!decisions.has(item.id)) {
          if (decisions.size >= MAX_STEPS) { protocolError('native_item_limit'); return; }
          decisions.add(item.id);
          observed.permissionsDenied += 1;
        }
      }
      return;
    }
    observed.unknownEvents += 1;
  }

  function opencode(event) {
    if (!['step_start', 'step_finish', 'text', 'reasoning', 'tool_use', 'error'].includes(event.type)) {
      observed.unknownEvents += 1;
      return;
    }
    // A native startup error may precede creation of a session.
    if (!(event.type === 'error' && !event.sessionID) && !session(event.sessionID)) return;
    if (event.type === 'error') {
      observed.diagnostics += 1;
      observed.turnsFailed += 1;
      observed.status = 'failed';
      terminalMarker = false;
      return;
    }
    const part = event.part;
    if (!part || typeof part !== 'object' || Array.isArray(part)
      || (part.sessionID !== undefined && part.sessionID !== observed.sessionId)) {
      protocolError('native_part_invalid'); return;
    }
    if (event.type === 'step_start') {
      terminalMarker = false;
      observed.status = 'running';
      return;
    }
    if (event.type !== 'step_finish') return;
    if (!nonempty(part.id, 256) || typeof part.reason !== 'string') { protocolError('native_step_invalid'); return; }
    if (!steps.has(part.id)) {
      if (steps.size >= MAX_STEPS) { protocolError('native_step_limit'); return; }
      steps.add(part.id);
      observed.stepsCompleted += 1;
      const tokens = part.tokens;
      if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) { protocolError('native_usage_invalid'); return; }
      usage({ inputTokens: tokens.input, outputTokens: tokens.output,
        reasoningOutputTokens: tokens.reasoning, cachedInputTokens: tokens.cache?.read,
        cacheWriteInputTokens: tokens.cache?.write, cost: part.cost });
    }
    terminalMarker = part.reason === 'stop';
    observed.status = 'running';
  }

  function line(value) {
    if (!value.trim() || observed.protocolError) return;
    if (++records > MAX_EVENTS) { protocolError('native_event_limit'); return; }
    let event;
    try { event = JSON.parse(value); }
    catch { protocolError('native_json_invalid'); return; }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
      protocolError('native_event_invalid'); return;
    }
    if (native.kind === 'codex') codex(event);
    else opencode(event);
  }

  function state() { return structuredClone(observed); }

  function feed(stream, chunk) {
    if (observed.ended || !capabilities.structuredEvents || stream !== 'stdout' || observed.protocolError) return false;
    if (typeof chunk !== 'string') { protocolError('native_output_invalid'); return true; }
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_STREAM_BYTES) { protocolError('native_stream_limit'); return true; }
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const next = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(next) > MAX_LINE_BYTES) { protocolError('native_line_limit'); break; }
      line(next);
      if (observed.protocolError) break;
    }
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) protocolError('native_line_limit');
    return true;
  }

  function end(outcome) {
    if (observed.ended) return state();
    if (buffer && capabilities.structuredEvents && !observed.protocolError) line(buffer);
    buffer = '';
    observed.ended = true;
    if (outcome?.status === 'cancelled') observed.status = 'interrupted';
    else if (outcome?.status === 'failed' || (outcome?.exitCode !== undefined && outcome.exitCode !== null && outcome.exitCode !== 0)
      || observed.turnsFailed > 0 || pendingError) observed.status = 'failed';
    else if (observed.protocolError || !capabilities.structuredEvents || !terminalMarker
      || outcome?.status !== 'succeeded' || outcome.exitCode !== 0) observed.status = 'unknown';
    else observed.status = 'completed';
    // OpenCode run emits steps rather than a distinct turn-completed record.
    // A final stop plus successful exit completes this invocation's single turn.
    if (native.kind === 'opencode' && observed.status === 'completed') observed.turnsCompleted = 1;
    observed.resumable = resumeSupported && observed.sessionId !== null && !observed.protocolError;
    return state();
  }

  return Object.freeze({ feed, end, state });
}

/** Continue exactly the captured provider session in its original worktree.
 * Returned argv is fully expanded. The caller must keep the original record's
 * args and affinity unchanged, lock the worktree, and confirm prior cleanup.
 */
export function createNativeResumePlan(record, { prompt } = {}) {
  if (!nonempty(prompt)) fail('native_resume_prompt_required');
  const source = origin({ ...record, workspace: record.workspace?.path });
  const observed = record.nativeState;
  if (observed?.schemaVersion !== 1 || !observed.ended || !observed.resumable || observed.protocolError
    || observed.kind !== source.native.kind || observed.protocol !== source.native.protocol
    || !validSessionId(source.native.kind, observed.sessionId)) fail('native_resume_unavailable');
  if (observed.affinity !== fingerprint(source)) fail('native_resume_affinity_changed');
  const prefix = resumePrefix(source);
  let continuation;
  if (source.native.kind === 'codex') {
    continuation = [...prefix, 'resume', observed.sessionId, '--', prompt];
  } else {
    continuation = [...prefix, '--session', observed.sessionId, '--', prompt];
  }
  return { command: source.command, args: continuation, native: source.native,
    transport: source.transport, inputMode: 'closed', unsetEnv: [...source.unsetEnv],
    expectedSessionId: observed.sessionId };
}

// Conversational Codex/Claude turns coexist with retained raw-CLI observers.
export { createNativeAgentSession } from './native-conversation.js';
