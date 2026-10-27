import { appendFileSync, closeSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { runWorkflow } from './core.js';
import { startCommand } from './command-session.js';
import { startTerminalCommand } from './terminal-session.js';
import { resolveTerminalHelper } from './terminal-helper.js';
import { createProjectWorkspaces, inspectWorkspace, integrateWorkspace, finalizeWorkspaceIntegration } from './project-workspaces.js';
import { normalizeProjectPrerequisites, preflightProjectPlan, preflightProjectRuntime } from './project-plan.js';
import { normalizeNativeAgent, createNativeObserver, createNativeResumePlan } from './native-agent.js';
import { createCodingAgentSession } from './coding-agent.js';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const STATE_FILE = 'project-session.json';
const MAX_LOG_BYTES = 80 * 1024 * 1024;

function fail(code) { throw new Error(code); }
function string(value, maximum = 65_536) {
  return typeof value === 'string' && value.trim() && !value.includes('\0')
    && Buffer.byteLength(value) <= maximum;
}
function duration(value, fallback) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 3_600_000) fail('project_invalid_timeout');
  return result;
}

/** Explicit raw executable plans. No provider protocol, login or model selection is inferred. */
export function validateProjectPlan(source) {
  if (!source || source.schemaVersion !== 1 || !string(source.project, 4096)
      || !path.isAbsolute(source.project) || !string(source.goal)
      || !Array.isArray(source.agents) || source.agents.length < 1 || source.agents.length > 8) {
    fail('project_invalid_plan');
  }
  const ids = new Set();
  const timeoutMs = duration(source.timeoutMs, 300_000);
  if (source.controlRoot !== undefined && (!string(source.controlRoot, 4096) || !path.isAbsolute(source.controlRoot))) fail('project_invalid_control_root');
  if (source.nativeHelperDirectory !== undefined && (!string(source.nativeHelperDirectory, 4096) || !path.isAbsolute(source.nativeHelperDirectory))) fail('project_invalid_native_helper_directory');
  const agents = source.agents.map(agent => {
    if (!agent || !ID.test(agent.id) || ids.has(agent.id) || !string(agent.command, 4096)
        || /\.(?:cmd|bat)$/i.test(agent.command) || !string(agent.task)
        || !Array.isArray(agent.args) || agent.args.length > 128
        || agent.args.some(arg => typeof arg !== 'string' || arg.includes('\0') || Buffer.byteLength(arg) > 16_384)
        || !Array.isArray(agent.owns) || !agent.owns.length || agent.owns.length > 64) fail('project_invalid_agent');
    ids.add(agent.id);
    const dependsOn = agent.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.length > 8 || dependsOn.some(id => typeof id !== 'string' || !ID.test(id))) fail('project_invalid_dependencies');
    const nativeKind = agent.nativeKind;
    if (nativeKind !== undefined && !['codex', 'claude', 'local'].includes(nativeKind)) fail('project_invalid_native_kind');
    if (nativeKind && agent.transport === 'pty') fail('project_native_protocol_requires_pipe');
    for (const key of ['model', 'effort', 'account', 'localEndpoint']) if (agent[key] !== undefined && !string(agent[key], 4096)) fail('project_invalid_native_setting');
    const owns = agent.owns.map(item => {
      if (!string(item, 4096) || item.includes('\\') || item.startsWith('/')
          || item.split('/').some(part => part === '..' || part === '.git')
          || (item !== '.' && path.posix.normalize(item).replace(/\/$/, '') !== item.replace(/\/$/, ''))) {
        fail('project_invalid_ownership');
      }
      return item.replace(/\/$/, '');
    });
    if (agent.input !== undefined && !string(agent.input)) fail('project_invalid_input');
    const transport = agent.transport ?? 'pipe';
    if (!['pipe', 'pty'].includes(transport)) fail('project_invalid_transport');
    let terminal;
    if (transport === 'pty') {
      if (agent.terminal !== undefined && (!agent.terminal || typeof agent.terminal !== 'object' || Array.isArray(agent.terminal))) fail('project_invalid_terminal');
      const columns = agent.terminal?.columns ?? 80;
      const rows = agent.terminal?.rows ?? 24;
      if (![columns, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 1000)) fail('project_invalid_terminal_size');
      terminal = { columns, rows };
    } else if (agent.terminal !== undefined) fail('project_terminal_requires_pty');
    const inputMode = agent.inputMode ?? (transport === 'pty' ? 'pipe' : 'closed');
    if (!['closed', 'pipe'].includes(inputMode)) fail('project_invalid_input_mode');
    const unsetEnv = agent.unsetEnv ?? [];
    if (!Array.isArray(unsetEnv) || unsetEnv.length > 32 || unsetEnv.some(key => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))) fail('project_invalid_environment');
    const native = agent.native === undefined ? undefined : normalizeNativeAgent(agent.native);
    if (native && (native.protocol === 'jsonl') !== (transport === 'pipe')) fail('project_native_transport_mismatch');
    if (native && nativeKind) fail('project_native_mode_conflict');
    if (nativeKind && agent.input !== undefined) fail('project_native_prompt_input_conflict');
    return { id: agent.id, command: agent.command, args: [...agent.args], task: agent.task,
      ...(native ? { native } : {}),
      owns, dependsOn: [...new Set(dependsOn)], transport, ...(terminal ? { terminal } : {}), inputMode, unsetEnv: [...unsetEnv], timeoutMs: duration(agent.timeoutMs, timeoutMs), ...(agent.input === undefined ? {} : { input: agent.input }),
      ...(nativeKind ? { nativeKind } : {}), ...Object.fromEntries(['model', 'effort', 'account', 'localEndpoint'].filter(key => agent[key] !== undefined).map(key => [key, agent[key]])) };
  });
  for (const agent of agents) if (agent.dependsOn.some(id => !ids.has(id) || id === agent.id)) fail('project_invalid_dependencies');
  const visited = new Set(), visiting = new Set();
  const visit = agent => {
    if (visiting.has(agent.id)) fail('project_dependency_cycle');
    if (visited.has(agent.id)) return;
    visiting.add(agent.id);
    for (const id of agent.dependsOn) visit(agents.find(candidate => candidate.id === id));
    visiting.delete(agent.id); visited.add(agent.id);
  };
  agents.forEach(visit);
  const maxConcurrency = source.maxConcurrency ?? agents.length;
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > agents.length) fail('project_invalid_concurrency');
  const plan = { schemaVersion: 1, project: source.project, goal: source.goal, agents, timeoutMs, maxConcurrency,
    ...(source.controlRoot === undefined ? {} : { controlRoot: source.controlRoot }) };
  if (source.nativeHelperDirectory !== undefined) plan.nativeHelperDirectory = source.nativeHelperDirectory;
  const prerequisites = normalizeProjectPrerequisites(source.prerequisites, ids);
  if (Object.keys(prerequisites).length) plan.prerequisites = prerequisites;
  if (Buffer.byteLength(JSON.stringify(plan)) > 512 * 1024) fail('project_plan_too_large');
  return plan;
}

function persist(state) {
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(contents) > 1024 * 1024) fail('project_state_limit');
  const temporary = path.join(state.sessionRoot, `.project-${randomUUID()}.tmp`);
  writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path.join(state.sessionRoot, STATE_FILE));
}

function readState(sessionRoot) {
  const filename = path.join(sessionRoot, STATE_FILE);
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('project_invalid_session');
  const state = JSON.parse(readFileSync(filename, 'utf8'));
  if (state.kind !== 'koto-project-session' || state.schemaVersion !== 1
      || path.resolve(state.sessionRoot) !== path.resolve(sessionRoot) || !Array.isArray(state.agents)) fail('project_invalid_session');
  return state;
}

function agentRecord(state, id) {
  const record = state.agents.find(agent => agent.id === id);
  if (!record) fail('project_unknown_agent');
  return record;
}

function owned(record, filename) {
  return record.owns.some(prefix => prefix === '.' || filename === prefix || filename.startsWith(`${prefix}/`));
}

function previousIntegration(record) {
  return record.lastSuccessfulIntegration ?? (record.integration?.status === 'integrated' ? record.integration : undefined);
}

function requireSettled(state, { allowConflicts = false } = {}) {
  if (state.active || state.agents.some(agent => ['pending', 'running'].includes(agent.status))) fail('project_session_must_finish_before_integration');
  if (state.agents.some(agent => agent.result?.error === 'cleanup_unconfirmed'
      || agent.commandOutcome?.error === 'cleanup_unconfirmed')) fail('project_agent_cleanup_not_confirmed');
  if (!allowConflicts && state.agents.some(agent => agent.integration?.status === 'conflicts')) fail('project_integration_conflicts_unresolved');
}

function lease(sessionRoot) {
  const filename = path.join(sessionRoot, 'integration.lock');
  let fd;
  try { fd = openSync(filename, 'wx', 0o600); }
  catch { fail('project_integration_busy_or_interrupted'); }
  return () => { closeSync(fd); unlinkSync(filename); };
}

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function nativeOrigin(record) {
  return fingerprint({ schemaVersion: 1, kind: record.nativeKind, mode: 'coding',
    command: record.command, args: record.args, workspace: path.resolve(record.workspace.path),
    model: record.model ?? null, effort: record.effort ?? null,
    account: record.account ?? (record.nativeKind === 'claude' ? 'subscription' : 'host'),
    endpoint: record.localEndpoint ?? null, transport: record.transport,
    unsetEnv: [...record.unsetEnv].sort() });
}

function recordIntegrationEvent(state, agentId, status, onEvent) {
  const message = { type: 'integration', agentId, status, sessionId: state.sessionId,
    sequence: (state.eventSequence ?? 0) + 1, time: new Date().toISOString() };
  state.eventSequence = message.sequence;
  // Persist the outcome and reserved sequence before appending. A failed log
  // write can leave a gap, but a subsequent continuation cannot reuse the ID.
  persist(state);
  const log = path.join(state.sessionRoot, 'events.jsonl');
  const line = `${JSON.stringify(message)}\n`;
  let size = 0;
  try { size = lstatSync(log).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (size + Buffer.byteLength(line) > MAX_LOG_BYTES) fail('project_event_limit');
  appendFileSync(log, line, { mode: 0o600 });
  // Observers cannot undo a completed and persisted integration.
  try { Promise.resolve(onEvent?.(Object.freeze(message))).catch(() => {}); } catch { /* retained outcome is authoritative */ }
}

async function inspect(state, id) {
  const record = agentRecord(state, id);
  const review = await inspectWorkspace({ workspace: record.workspace, previousIntegration: previousIntegration(record) });
  const outsideOwnership = [...new Set([...review.changedPaths, ...(review.integrationChangedPaths ?? [])])].filter(filename => !owned(record, filename));
  return { ...review, agentId: id, agentStatus: record.status, owns: record.owns, outsideOwnership };
}

async function integrate(state, id, approve) {
  const record = agentRecord(state, id);
  requireSettled(state);
  if (!['succeeded', 'failed', 'cancelled'].includes(record.status)) fail('project_agent_not_reviewable');
  // All session agents share Git metadata and may retain host permissions.
  // An unresolved peer can still write while another contribution integrates.
  // Consult retained outcomes as well so reopening the API cannot clear it.
  if (state.agents.some(agent => agent.result?.error === 'cleanup_unconfirmed'
      || agent.commandOutcome?.error === 'cleanup_unconfirmed')) fail('project_agent_cleanup_not_confirmed');
  if (!string(approve, 256)) fail('project_review_token_required');
  const review = await inspect(state, id);
  if (review.outsideOwnership.length) fail('project_changes_outside_declared_ownership');
  if (approve !== review.reviewToken) fail('project_review_changed');
  if (record.integration?.status === 'integrated' && record.integration.reviewTree === review.tree) fail('project_contribution_already_integrated');
  const result = await integrateWorkspace({ workspace: record.workspace, integration: state.integration,
    baseCommit: state.baseCommit, expectedReviewToken: approve, previousIntegration: previousIntegration(record) });
  record.integration = result;
  if (result.status === 'integrated') record.lastSuccessfulIntegration = result;
  persist(state);
  return result;
}

/** Inspect retained changes after exit; no command or model is launched. */
export async function inspectProjectSession(sessionRoot, agentId) {
  return inspect(readState(sessionRoot), agentId);
}

/** Read retained state without launching or resuming a native process. */
export function readProjectSession(sessionRoot) { return structuredClone(readState(sessionRoot)); }

/** Explicitly integrate an inspected contribution into the session branch, never main. */
export async function integrateProjectSession(sessionRoot, agentId, { approve, onEvent } = {}) {
  const initial = readState(sessionRoot);
  const release = lease(initial.sessionRoot);
  try {
    const state = readState(sessionRoot);
    const result = await integrate(state, agentId, approve);
    recordIntegrationEvent(state, agentId, result.status, onEvent);
    return result;
  }
  finally { release(); }
}

/** Acknowledge a manually reviewed conflict resolution at the exact target HEAD. */
export async function finalizeProjectSessionIntegration(sessionRoot, agentId, { approveIntegrationCommit, onEvent } = {}) {
  const initial = readState(sessionRoot);
  const release = lease(initial.sessionRoot);
  try {
    const state = readState(sessionRoot);
    requireSettled(state, { allowConflicts: true });
    const record = agentRecord(state, agentId);
    if (record.integration?.status !== 'conflicts') fail('project_integration_has_no_conflicts');
    const result = await finalizeWorkspaceIntegration({ workspace: record.workspace,
      integration: state.integration, conflictIntegration: record.integration, approveIntegrationCommit });
    record.integration = result;
    record.lastSuccessfulIntegration = result;
    recordIntegrationEvent(state, agentId, result.status, onEvent);
    return result;
  } finally { release(); }
}

function expand(template, values) {
  return template.replace(/\{(prompt|workspace|project|goal|agent)\}/g, (_, key) => values[key]);
}

/** Prepare one owned branch/worktree per task. run() starts the already approved executables once. */
export async function createProjectSession(source, { onEvent, signal, onApproval } = {}) {
  const plan = validateProjectPlan(source);
  if ((onEvent !== undefined && typeof onEvent !== 'function')
    || (onApproval !== undefined && typeof onApproval !== 'function')
    || (signal !== undefined && !(signal instanceof AbortSignal))) fail('project_invalid_observer_or_signal');
  if (signal?.aborted) fail('project_cancelled');
  const readiness = await preflightProjectPlan(plan);
  if (!readiness.ok) {
    const error = new Error('project_preflight_failed');
    error.checks = readiness.checks;
    throw error;
  }
  if (signal?.aborted) fail('project_cancelled');
  // Bind launch to the executable inspected on absolute PATH entries. A worker
  // worktree must not change command selection via a relative PATH entry.
  for (const agent of plan.agents) agent.command = readiness.executables[agent.id];
  // Resolving verifies an explicitly built local artifact. Session launch never
  // invokes a compiler, installs a runtime or starts a model during preflight.
  const ptyHelper = plan.agents.some(agent => agent.transport === 'pty') || process.platform === 'win32'
    ? await resolveTerminalHelper({ directory: plan.nativeHelperDirectory }) : undefined;
  const sessionId = `s-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const workspaces = await createProjectWorkspaces({ projectRoot: plan.project, sessionId, agents: plan.agents,
    nativeHelperDirectory: plan.nativeHelperDirectory,
    controlRoot: plan.controlRoot ?? path.join(homedir(), '.koto', 'sessions') });
  const state = { schemaVersion: 1, kind: 'koto-project-session', sessionId, createdAt: new Date().toISOString(),
    sessionRoot: workspaces.sessionRoot, projectRoot: workspaces.projectRoot, baseCommit: workspaces.baseCommit,
    goal: plan.goal, timeoutMs: plan.timeoutMs, maxConcurrency: plan.maxConcurrency,
    ...(plan.prerequisites ? { prerequisites: plan.prerequisites } : {}),
    ...(plan.nativeHelperDirectory ? { nativeHelperDirectory: plan.nativeHelperDirectory } : {}),
    ownerPid: process.pid, active: false, started: false, integration: workspaces.integration,
    agents: plan.agents.map(agent => ({ ...agent, workspace: workspaces.agents[agent.id], status: 'pending' })) };
  for (const record of state.agents) if (record.nativeKind) record.nativeOrigin = nativeOrigin(record);
  persist(state);
  return sessionRunner(plan, state, { onEvent, signal, ptyHelper, onApproval });
}

/** Explicit continuation in the original worktree and native conversation.
 * Preparing it launches nothing. run() takes the shared integration/resume lease
 * and refuses any intervening state change; interrupted runs are never replayed.
 */
export async function resumeProjectSession(sessionRoot, agentId, { prompt, onEvent, signal, onApproval } = {}) {
  if (!string(prompt, 12_000)) fail('project_resume_prompt_required');
  if ((onEvent !== undefined && typeof onEvent !== 'function')
    || (onApproval !== undefined && typeof onApproval !== 'function')
    || (signal !== undefined && !(signal instanceof AbortSignal))) fail('project_invalid_observer_or_signal');
  if (signal?.aborted) fail('project_cancelled');
  const state = readState(sessionRoot);
  requireSettled(state);
  const expectedState = fingerprint(state);
  const record = agentRecord(state, agentId);
  if ((record.attempts?.length ?? 0) >= 32) fail('project_attempt_limit');
  await inspect(state, agentId); // validates the original owned worktree, including dirty partial edits
  let continuation;
  if (record.nativeKind) {
    if (typeof record.nativeOrigin !== 'string' || record.nativeOrigin !== nativeOrigin(record)) fail('project_native_origin_changed');
    const sessionId = record.nativeKind === 'local' ? record.localSessionId : record.nativeSessionId;
    if (!string(sessionId, 256)) fail('project_native_session_resume_unavailable');
    if (record.nativeKind === 'local' && (!record.localContinuation || record.localContinuationUnavailableReason
      || record.localContinuation.sessionId !== sessionId)) fail('project_local_resume_unavailable');
    continuation = { command: record.command, args: [...record.args], expectedSessionId: sessionId,
      sessionId, ...(record.nativeKind === 'local' ? { resumeState: structuredClone(record.localContinuation) } : {}) };
  } else continuation = createNativeResumePlan(record, { prompt });
  const plan = validateProjectPlan({ schemaVersion: 1, project: state.projectRoot, goal: state.goal,
    timeoutMs: record.timeoutMs, maxConcurrency: 1, agents: [{ ...record, dependsOn: [] }],
    nativeHelperDirectory: state.nativeHelperDirectory,
    ...(state.prerequisites?.[agentId] ? { prerequisites: { [agentId]: state.prerequisites[agentId] } } : {}) });
  const readiness = await preflightProjectRuntime(plan);
  if (!readiness.ok) throw Object.assign(new Error('project_preflight_failed'), { checks: readiness.checks });
  if (readiness.executables[agentId] !== record.command) fail('project_native_executable_changed');
  const ptyHelper = record.transport === 'pty' || process.platform === 'win32'
    ? await resolveTerminalHelper({ directory: state.nativeHelperDirectory }) : undefined;
  record.status = 'pending';
  return sessionRunner(plan, state, { onEvent, signal, ptyHelper, onApproval,
    resume: { agentId, continuation, prompt, expectedState } });
}

function sessionRunner(plan, state, { onEvent, signal, ptyHelper, resume, onApproval }) {
  const sessionId = state.sessionId;
  const controller = new AbortController();
  const handles = new Map();
  const nativeObservers = new Map();
  const outputTails = new Map(plan.agents.map(agent => [agent.id, Buffer.alloc(0)]));
  const localStops = new Map(plan.agents.map(agent => [agent.id, new AbortController()]));
  let eventBytes = 0;
  try { eventBytes = lstatSync(path.join(state.sessionRoot, 'events.jsonl')).size; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let sequence = state.eventSequence ?? 0;
  let hasRun = false;
  let storageFailure = false;
  let integrationBusy = false;
  let pendingObservers = 0;
  const emit = event => {
    const message = { ...event, sessionId, sequence: ++sequence, time: new Date().toISOString() };
    state.eventSequence = sequence;
    try {
      const line = `${JSON.stringify(message)}\n`;
      eventBytes += Buffer.byteLength(line);
      if (eventBytes > MAX_LOG_BYTES) fail('project_event_limit');
      appendFileSync(path.join(state.sessionRoot, 'events.jsonl'), line, { mode: 0o600 });
    } catch {
      storageFailure = true;
      controller.abort();
      for (const handle of handles.values()) handle.stop();
    }
    try {
      if (pendingObservers >= 64) { controller.abort(); return; }
      const result = onEvent?.(Object.freeze(message));
      if (result && typeof result.then === 'function') {
        pendingObservers += 1;
        Promise.resolve(result).then(() => { pendingObservers -= 1; }, () => { pendingObservers -= 1; controller.abort(); });
      }
    }
    catch { controller.abort(); }
  };
  const stopAll = () => {
    controller.abort();
    if (!hasRun) signal?.removeEventListener('abort', stopAll);
    for (const handle of handles.values()) handle.stop();
  };
  const applyOutcome = (record, outcome) => {
    const observer = nativeObservers.get(record.id);
    if (observer) record.nativeState = observer.end(outcome);
    const setupError = record.setupError;
    record.commandOutcome = outcome;
    record.result = outcome.error === 'cleanup_unconfirmed' || !setupError
      ? outcome : { ...outcome, status: 'failed', error: setupError };
    if (record.result.status === 'succeeded' && record.nativeState?.protocol === 'jsonl'
        && record.nativeState.status !== 'completed') {
      record.result = { ...outcome, status: 'failed', error: record.nativeState.status === 'failed'
        ? 'native_turn_failed' : 'native_completion_unconfirmed' };
    }
    record.status = record.result.status;
    record.finishedAt ??= new Date().toISOString();
    return record.result;
  };
  const settleCommands = async () => {
    await Promise.all([...handles.entries()].map(async ([id, handle]) => {
      const outcome = await handle.completion;
      const record = agentRecord(state, id);
      applyOutcome(record, outcome);
    }));
    for (const [id] of nativeObservers) if (!handles.has(id)) {
      const record = agentRecord(state, id);
      applyOutcome(record, record.result ?? { status: 'cancelled', exitCode: null });
    }
  };
  signal?.addEventListener('abort', stopAll, { once: true });
  if (signal?.aborted) stopAll();

  const api = {
    sessionRoot: state.sessionRoot,
    launchPlan: structuredClone(resume ? { ...plan, agents: plan.agents.map(agent =>
      ({ ...agent, args: resume.continuation.args, task: resume.prompt })) } : plan),
    status: () => structuredClone(!state.active && hasRun ? readState(state.sessionRoot) : state),
    stop(id) {
      if (id === undefined || id === 'all') stopAll();
      else { agentRecord(state, id); localStops.get(id)?.abort(); handles.get(id)?.stop(); }
    },
    send(id, input) {
      const record = agentRecord(state, id);
      if (record.transport !== 'pty' && typeof input !== 'string') return false;
      return handles.get(id)?.send(input) ?? false;
    },
    endInput(id) { agentRecord(state, id); return handles.get(id)?.endInput() ?? false; },
    resize(id, columns, rows) {
      const record = agentRecord(state, id);
      if (record.transport !== 'pty' || ![columns, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 1000)) return false;
      const accepted = handles.get(id)?.resize(columns, rows) ?? false;
      if (accepted) {
        record.terminal = { columns, rows };
        emit({ type: 'terminal_resized', agentId: id, columns, rows });
      }
      return accepted;
    },
    outputTail(id) {
      agentRecord(state, id);
      const bytes = outputTails.get(id) ?? Buffer.alloc(0);
      // A retained tail may begin in the middle of one UTF-8 codepoint.
      let offset = 0;
      while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset += 1;
      return bytes.subarray(offset).toString('utf8');
    },
    inspect: id => inspect(!state.active && hasRun ? readState(state.sessionRoot) : state, id),
    async integrate(id, { approve } = {}) {
      if (integrationBusy) fail('project_integration_busy_or_interrupted');
      integrationBusy = true;
      try {
        // Use the same on-disk lease as a second terminal.
        const result = await integrateProjectSession(state.sessionRoot, id, { approve, onEvent });
        agentRecord(state, id).integration = result;
        if (result.status === 'integrated') agentRecord(state, id).lastSuccessfulIntegration = result;
        sequence = readState(state.sessionRoot).eventSequence;
        state.eventSequence = sequence;
        return result;
      } finally { integrationBusy = false; }
    },
    async resolveIntegration(id, approveIntegrationCommit) {
      if (integrationBusy) fail('project_integration_busy_or_interrupted');
      integrationBusy = true;
      try {
        const result = await finalizeProjectSessionIntegration(state.sessionRoot, id, { approveIntegrationCommit, onEvent });
        agentRecord(state, id).integration = result;
        agentRecord(state, id).lastSuccessfulIntegration = result;
        sequence = readState(state.sessionRoot).eventSequence;
        state.eventSequence = sequence;
        return result;
      } finally { integrationBusy = false; }
    },
    async run() {
      if (hasRun) fail('project_session_already_started');
      hasRun = true;
      if (controller.signal.aborted) fail('project_cancelled');
      const release = lease(state.sessionRoot);
      try {
      if (resume) {
        const current = readState(state.sessionRoot);
        requireSettled(current);
        if (fingerprint(current) !== resume.expectedState) fail('project_resume_state_changed');
        await inspect(current, resume.agentId);
      }
      state.started = true;
      state.active = true;
      state.ownerPid = process.pid;
      delete state.finishedAt;
      delete state.report;
      for (const agent of plan.agents) {
        const record = agentRecord(state, agent.id);
        record.status = 'pending';
        for (const key of ['startedAt', 'finishedAt', 'result', 'commandOutcome', 'setupError', 'pid', 'nativeState']) delete record[key];
        if (agent.native) {
          const observer = createNativeObserver({ native: agent.native, command: agent.command,
            args: agent.args, transport: agent.transport, unsetEnv: agent.unsetEnv,
            workspace: record.workspace.path, ...(resume ? { expectedSessionId: resume.continuation.expectedSessionId } : {}) });
          nativeObservers.set(agent.id, observer);
          record.nativeState = observer.state();
        }
      }
      persist(state);
      emit({ type: resume ? 'session_resumed' : 'session_started', status: 'running',
        ...(resume ? { agentId: resume.agentId,
          ...(plan.agents[0]?.nativeKind === 'local'
            ? { localSessionId: resume.continuation.expectedSessionId }
            : { nativeSessionId: resume.continuation.expectedSessionId }),
          prompt: resume.prompt } : {}) });
      // Each command transport owns its agent deadline and bounded OS cleanup.
      // Keep the scheduler's adapter timeout at the total session deadline so
      // its short JS cancellation grace cannot release a concurrency slot
      // before a timed-out native command has finished cleanup.
      const agents = Object.fromEntries(plan.agents.map(agent => [agent.id,
        { command: agent.command, args: agent.args, timeoutMs: plan.timeoutMs }]));
      const adapters = Object.fromEntries(plan.agents.map(agent => [agent.id, async (assignment, context) => {
        const record = agentRecord(state, agent.id);
        const commandSignal = AbortSignal.any([context.signal, localStops.get(agent.id).signal]);
        if (commandSignal.aborted) { record.status = 'cancelled'; throw new Error('project_cancelled'); }
        const prompt = resume?.prompt ?? `${plan.goal}\n\nYour task: ${agent.task}\nDeclared file ownership: ${agent.owns.join(', ')}\nWork in this task's Git worktree. Do not integrate another task or change the original checkout. Do not add or run automated test suites. Report your changes and limitations.${agent.dependsOn.length ? `\n\nSuccessful direct dependency results (reference their worktrees read-only; integration remains operator-controlled):\n${JSON.stringify(assignment.inputs).slice(0, 24_000)}` : ''}`;
        const values = { prompt, workspace: record.workspace.path, project: state.projectRoot, goal: plan.goal, agent: agent.id };
        const args = resume ? [...resume.continuation.args] : agent.args.map(arg => expand(arg, values));
        let tail = '';
        record.status = 'running';
        record.startedAt = new Date().toISOString();
        delete record.finishedAt;
        delete record.result;
        delete record.commandOutcome;
        delete record.setupError;
        delete record.pid;
        try {
        persist(state);
        emit({ type: 'agent_status', agentId: agent.id, status: 'running', workspace: record.workspace.path });
          const input = agent.input === undefined ? undefined : expand(agent.input, values);
          if (args.some(arg => Buffer.byteLength(arg) > 16_384) || (input !== undefined && Buffer.byteLength(input) > 65_536)) fail('project_expanded_input_too_large');
          const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)
            && !agent.unsetEnv.some(name => process.platform === 'win32' ? name.toUpperCase() === key.toUpperCase() : name === key)));
          const receive = event => {
            if (event.type === 'activity' || ['tool_started', 'tool_completed', 'command_started', 'approval_required', 'request'].includes(event.type)) {
              record.activity = { type: event.type, time: new Date().toISOString(),
                ...Object.fromEntries(['activity', 'description', 'status', 'tool', 'command', 'model'].filter(key => typeof event[key] === 'string')
                  .map(key => [key, event[key].slice(0, key === 'command' ? 4096 : 512)])),
                ...(event.type === 'approval_required' ? { status: 'waiting_for_approval' } : {}) };
            }
            if (event.type === 'assistant_message' && typeof event.text === 'string') {
              outputTails.set(agent.id, Buffer.from(event.text).subarray(-65_536));
              tail = api.outputTail(agent.id);
            }
            if (event.type === 'assistant_delta' && typeof event.text === 'string') {
              const previous = outputTails.get(agent.id);
              outputTails.set(agent.id, Buffer.concat([previous, Buffer.from(event.text)]).subarray(-65_536));
              tail = api.outputTail(agent.id);
            }
            if (event.type === 'session_started' && typeof event.sessionId === 'string') {
              if (resume && event.sessionId !== resume.continuation.expectedSessionId) fail('project_native_session_changed');
              if (agent.nativeKind === 'local') record.localSessionId = event.sessionId;
              else record.nativeSessionId = event.sessionId;
              persist(state);
            }
            if (event.type === 'started') record.pid = event.pid;
            if (event.type === 'output') {
              const previous = outputTails.get(agent.id);
              outputTails.set(agent.id, Buffer.concat([previous, Buffer.from(event.text)]).subarray(-65_536));
              tail = api.outputTail(agent.id);
              const observer = nativeObservers.get(agent.id);
              if (observer) {
                const before = record.nativeState;
                observer.feed(event.stream, event.text);
                record.nativeState = observer.state();
                if (record.nativeState.sessionId !== before?.sessionId || record.nativeState.status !== before?.status) {
                  persist(state);
                  emit({ type: 'native_status', agentId: agent.id, nativeSessionId: record.nativeState.sessionId,
                    nativeStatus: record.nativeState.status });
                }
              }
            }
            if (event.type === 'pty_ready') {
              record.pid = event.pid;
              record.terminalSessionId = event.sessionId;
              persist(state);
            }
            emit({ ...event, agentId: agent.id, ...(event.type === 'pty_ready' ? { terminalSessionId: event.sessionId } : {}),
              ...(event.type === 'session_started'
                ? agent.nativeKind === 'local' ? { localSessionId: event.sessionId } : { nativeSessionId: event.sessionId }
                : {}) });
          };
          let handle;
          if (agent.nativeKind) {
            const native = createCodingAgentSession({ id: agent.id, kind: agent.nativeKind, command: agent.command,
              endpoint: agent.localEndpoint, model: agent.model, effort: agent.effort, account: agent.account,
              unsetEnv: agent.unsetEnv, cwd: record.workspace.path, mode: 'coding', timeoutMs: agent.timeoutMs,
              onEvent: receive, onApproval,
              ...(resume ? { sessionId: resume.continuation.sessionId, resumeState: resume.continuation.resumeState } : {}) });
            const completion = native.send(prompt, { signal: commandSignal }).then(result => {
              const { continuation: localContinuation, continuationUnavailableReason, ...rawOutcome } = result;
              // Full messages remain in private events/native history. Keep
              // retained state bounded independently of a verbose final reply.
              const outcome = { ...rawOutcome, ...(typeof rawOutcome.text === 'string'
                ? { text: Buffer.from(rawOutcome.text).subarray(-8192).toString('utf8'),
                  ...(Buffer.byteLength(rawOutcome.text) > 8192 ? { textTruncated: true } : {}) } : {}) };
              if (resume && result.sessionId !== undefined && result.sessionId !== resume.continuation.expectedSessionId) {
                if (agent.nativeKind === 'local') record.localContinuationUnavailableReason = 'project_native_session_changed';
                return { ...outcome, status: 'failed', exitCode: result.exitCode ?? null,
                  error: result.error === 'cleanup_unconfirmed' ? result.error : 'project_native_session_changed' };
              }
              if (typeof result.text === 'string') {
                outputTails.set(agent.id, Buffer.from(result.text).subarray(-65_536));
                tail = api.outputTail(agent.id);
              }
              if (result.sessionId) {
                if (agent.nativeKind === 'local') record.localSessionId = result.sessionId;
                else record.nativeSessionId = result.sessionId;
              }
              if (agent.nativeKind === 'local') {
                if (localContinuation) {
                  record.localContinuation = structuredClone(localContinuation);
                  delete record.localContinuationUnavailableReason;
                } else {
                  // Retain the previous frame as history, but never resume it
                  // after a turn whose current state could not be captured.
                  record.localContinuationUnavailableReason = continuationUnavailableReason ?? 'local_agent_continuation_unavailable';
                }
              }
              return { ...outcome, exitCode: result.exitCode ?? null };
            });
            handle = { completion, stop: () => native.stop(), send: () => false, endInput: () => true,
              get pid() { return native.pid; } };
          } else {
            const useHelper = agent.transport === 'pty' || process.platform === 'win32';
            const start = useHelper ? startTerminalCommand : startCommand;
            handle = start({ id: agent.id, command: agent.command, args, cwd: record.workspace.path, env: environment,
              ...(useHelper ? { helperPath: ptyHelper, transport: agent.transport,
                columns: record.terminal?.columns ?? 80, rows: record.terminal?.rows ?? 24 } : {}),
              timeoutMs: agent.timeoutMs, signal: commandSignal, onEvent: receive });
          }
          handles.set(agent.id, handle);
          if (input !== undefined && !handle.send(input)) { handle.stop(); fail('project_initial_input_rejected'); }
          if (agent.inputMode === 'closed') handle.endInput();
          const result = applyOutcome(record, await handle.completion);
          persist(state);
          emit({ type: 'agent_status', agentId: agent.id, ...result });
          if (result.status !== 'succeeded') throw new Error('project_command_did_not_succeed');
          return { output: JSON.stringify({ agentId: agent.id, workspace: record.workspace.path,
            status: result.status, outputTail: Buffer.from(tail).subarray(-8192).toString('utf8') }) };
        } catch (error) {
          if (record.status === 'running') {
            handles.get(agent.id)?.stop();
            record.status = 'failed';
            record.result = { status: 'failed', exitCode: null, error: ['project_expanded_input_too_large', 'project_initial_input_rejected'].includes(error.message) ? error.message : 'project_command_start_failed' };
            record.setupError = record.result.error;
            record.finishedAt = new Date().toISOString();
            if (!handles.has(agent.id)) applyOutcome(record, record.result);
            persist(state);
            emit({ type: 'agent_status', agentId: agent.id, ...record.result });
          }
          throw error;
        }
      }]));
      try {
        const report = await runWorkflow({ schemaVersion: 1, goal: plan.goal, agents,
          tasks: plan.agents.map(agent => ({ id: agent.id, agent: agent.id, prompt: agent.task, dependsOn: agent.dependsOn })),
          maxConcurrency: plan.maxConcurrency, timeoutMs: plan.timeoutMs },
        { adapters, signal: controller.signal, onEvent: emit });
        // The general core's JS-adapter cancellation grace can end before OS cleanup.
        // A project session retains ownership and waits for every command's bounded cleanup.
        await settleCommands();
        for (const record of state.agents) if (record.status === 'pending') {
          const scheduled = report.tasks.find(task => task.id === record.id);
          record.status = scheduled?.status === 'blocked' ? 'blocked' : 'cancelled';
          record.result = { status: record.status, exitCode: null,
            ...(record.status === 'blocked' ? { error: 'project_dependency_failed' } : {}) };
          record.finishedAt = new Date().toISOString();
          emit({ type: 'agent_status', agentId: record.id, status: record.status });
        }
        state.report = { status: storageFailure ? 'failed' : report.status, ...(storageFailure ? { error: 'project_storage_failed' } : {}) };
      } finally {
        stopAll();
        await settleCommands();
        state.active = false;
        state.finishedAt = new Date().toISOString();
        for (const agent of plan.agents) {
          const record = agentRecord(state, agent.id);
          record.attempts ??= [];
          record.attempts.push({ number: record.attempts.length + 1, kind: resume ? 'resume' : 'initial',
            startedAt: record.startedAt, finishedAt: record.finishedAt, result: record.result,
            nativeState: record.nativeState });
        }
        signal?.removeEventListener('abort', stopAll);
        emit({ type: 'session_finished', status: state.report?.status ?? 'failed' });
        persist(state);
      }
      return { ...state.report, sessionRoot: state.sessionRoot, integration: state.integration,
        agents: structuredClone(state.agents) };
      } finally { signal?.removeEventListener('abort', stopAll); release(); }
    },
  };
  return api;
}
