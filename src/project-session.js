import { appendFileSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { runWorkflow } from './core.js';
import { startCommand } from './command-session.js';
import { startDarwinPtyCommand } from './darwin-pty-session.js';
import { resolveDarwinPtyHelper } from './native-helper.js';
import { createNativeAgentSession } from './native-agent.js';
import { createProjectWorkspaces, inspectWorkspace, integrateWorkspace } from './project-workspaces.js';

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
    return { id: agent.id, command: agent.command, args: [...agent.args], task: agent.task,
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
  if (Buffer.byteLength(JSON.stringify(plan)) > 512 * 1024) fail('project_plan_too_large');
  return plan;
}

function persist(state) {
  const temporary = path.join(state.sessionRoot, `.project-${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
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

async function inspect(state, id) {
  const record = agentRecord(state, id);
  const review = await inspectWorkspace({ workspace: record.workspace });
  const outsideOwnership = review.changedPaths.filter(filename => !owned(record, filename));
  return { ...review, agentId: id, agentStatus: record.status, owns: record.owns, outsideOwnership };
}

async function integrate(state, id, approve) {
  const record = agentRecord(state, id);
  if (state.active || ['pending', 'running'].includes(record.status)) fail('project_session_must_finish_before_integration');
  if (!['succeeded', 'failed', 'cancelled'].includes(record.status)) fail('project_agent_not_reviewable');
  if (record.result?.error === 'cleanup_unconfirmed') fail('project_agent_cleanup_not_confirmed');
  if (!string(approve, 256)) fail('project_review_token_required');
  const review = await inspect(state, id);
  if (review.outsideOwnership.length) fail('project_changes_outside_declared_ownership');
  if (approve !== review.reviewToken) fail('project_review_changed');
  if (record.integration?.status === 'integrated' && record.integration.reviewTree === review.tree) fail('project_contribution_already_integrated');
  const result = await integrateWorkspace({ workspace: record.workspace, integration: state.integration,
    baseCommit: state.baseCommit, expectedReviewToken: approve });
  record.integration = result;
  persist(state);
  return result;
}

/** Inspect retained changes after exit; no command or model is launched. */
export async function inspectProjectSession(sessionRoot, agentId) {
  return inspect(readState(sessionRoot), agentId);
}

/** Explicitly integrate an inspected contribution into the session branch, never main. */
export async function integrateProjectSession(sessionRoot, agentId, { approve } = {}) {
  const initial = readState(sessionRoot);
  // A per-session lease also covers separate CLI invocations.
  const lock = path.join(initial.sessionRoot, 'integration.lock');
  let fd;
  const { openSync, closeSync, unlinkSync } = await import('node:fs');
  try { fd = openSync(lock, 'wx', 0o600); }
  catch { fail('project_integration_busy_or_interrupted'); }
  try { return await integrate(readState(sessionRoot), agentId, approve); }
  finally { closeSync(fd); unlinkSync(lock); }
}

function expand(template, values) {
  return template.replace(/\{(prompt|workspace|project|goal|agent)\}/g, (_, key) => values[key]);
}

/** Prepare one owned branch/worktree per task. run() starts the already approved executables once. */
export async function createProjectSession(source, { onEvent, signal, onApproval } = {}) {
  const plan = validateProjectPlan(source);
  if ((onEvent !== undefined && typeof onEvent !== 'function') || (signal !== undefined && !(signal instanceof AbortSignal))) fail('project_invalid_observer_or_signal');
  if (signal?.aborted) fail('project_cancelled');
  // Resolving verifies an explicitly built local artifact. Session launch never
  // invokes a compiler, installs a runtime or starts a model during preflight.
  const ptyHelper = plan.agents.some(agent => agent.transport === 'pty')
    ? await resolveDarwinPtyHelper({ directory: plan.nativeHelperDirectory }) : undefined;
  const sessionId = `s-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const workspaces = await createProjectWorkspaces({ projectRoot: plan.project, sessionId, agents: plan.agents,
    controlRoot: plan.controlRoot ?? path.join(homedir(), '.koto', 'sessions') });
  const state = { schemaVersion: 1, kind: 'koto-project-session', sessionId, createdAt: new Date().toISOString(),
    sessionRoot: workspaces.sessionRoot, projectRoot: workspaces.projectRoot, baseCommit: workspaces.baseCommit,
    goal: plan.goal, ownerPid: process.pid, active: false, started: false, integration: workspaces.integration,
    agents: plan.agents.map(agent => ({ ...agent, workspace: workspaces.agents[agent.id], status: 'pending' })) };
  const controller = new AbortController();
  const handles = new Map();
  const outputTails = new Map(plan.agents.map(agent => [agent.id, Buffer.alloc(0)]));
  const localStops = new Map(plan.agents.map(agent => [agent.id, new AbortController()]));
  let eventBytes = 0;
  let sequence = 0;
  let storageFailure = false;
  let integrationBusy = false;
  let pendingObservers = 0;
  const emit = event => {
    const message = { ...event, sessionId, sequence: ++sequence, time: new Date().toISOString() };
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
  const stopAll = () => { controller.abort(); for (const handle of handles.values()) handle.stop(); };
  const settleCommands = async () => {
    await Promise.all([...handles.entries()].map(async ([id, handle]) => {
      const outcome = await handle.completion;
      const record = agentRecord(state, id);
      const setupError = record.setupError ?? (record.result?.error?.startsWith('project_') ? record.result.error : undefined);
      if (setupError) record.setupError = setupError;
      record.commandOutcome = outcome;
      record.result = outcome.error === 'cleanup_unconfirmed' || !setupError
        ? outcome : { ...outcome, status: 'failed', error: setupError };
      record.status = record.result.status;
      record.finishedAt ??= new Date().toISOString();
    }));
  };
  signal?.addEventListener('abort', stopAll, { once: true });
  if (signal?.aborted) stopAll();
  persist(state);

  const api = {
    sessionRoot: state.sessionRoot,
    status: () => structuredClone(!state.active && state.started ? readState(state.sessionRoot) : state),
    stop(id) {
      if (id === undefined || id === 'all') stopAll();
      else { agentRecord(state, id); localStops.get(id).abort(); handles.get(id)?.stop(); }
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
      const bytes = outputTails.get(id);
      // A retained tail may begin in the middle of one UTF-8 codepoint.
      let offset = 0;
      while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset += 1;
      return bytes.subarray(offset).toString('utf8');
    },
    inspect: id => inspect(state, id),
    async integrate(id, { approve } = {}) {
      if (integrationBusy) fail('project_integration_busy_or_interrupted');
      integrationBusy = true;
      try {
        // Use the same on-disk lease as a second terminal.
        const result = await integrateProjectSession(state.sessionRoot, id, { approve });
        agentRecord(state, id).integration = result;
        emit({ type: 'integration', agentId: id, status: result.status });
        return result;
      } finally { integrationBusy = false; }
    },
    async run() {
      if (state.started) fail('project_session_already_started');
      state.started = true;
      state.active = true;
      persist(state);
      emit({ type: 'session_started', status: 'running' });
      const agents = Object.fromEntries(plan.agents.map(agent => [agent.id,
        { command: agent.command, args: agent.args, timeoutMs: agent.timeoutMs }]));
      const adapters = Object.fromEntries(plan.agents.map(agent => [agent.id, async (_, context) => {
        const record = agentRecord(state, agent.id);
        const commandSignal = AbortSignal.any([context.signal, localStops.get(agent.id).signal]);
        if (commandSignal.aborted) { record.status = 'cancelled'; throw new Error('project_cancelled'); }
        const prompt = `${plan.goal}\n\nYour task: ${agent.task}\nDeclared file ownership: ${agent.owns.join(', ')}\nWork in this task's Git worktree. Do not integrate another task or change the original checkout. Do not add or run automated test suites. Report your changes and limitations.${agent.dependsOn.length ? `\n\nSuccessful direct dependency results (reference their worktrees read-only; integration remains operator-controlled):\n${JSON.stringify(context.inputs).slice(0, 24_000)}` : ''}`;
        const values = { prompt, workspace: record.workspace.path, project: state.projectRoot, goal: plan.goal, agent: agent.id };
        const args = agent.args.map(arg => expand(arg, values));
        let tail = '';
        record.status = 'running';
        record.startedAt = new Date().toISOString();
        persist(state);
        emit({ type: 'agent_status', agentId: agent.id, status: 'running', workspace: record.workspace.path });
        try {
          const input = agent.input === undefined ? undefined : expand(agent.input, values);
          if (args.some(arg => Buffer.byteLength(arg) > 16_384) || (input !== undefined && Buffer.byteLength(input) > 65_536)) fail('project_expanded_input_too_large');
          const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key) && !agent.unsetEnv.includes(key)));
          const receive = event => {
            if (event.type === 'assistant_message' && typeof event.text === 'string') {
              outputTails.set(agent.id, Buffer.from(event.text).subarray(-65_536));
              tail = api.outputTail(agent.id);
            }
            if (event.type === 'session_started' && typeof event.sessionId === 'string') record.nativeSessionId = event.sessionId;
            if (event.type === 'started') record.pid = event.pid;
            if (event.type === 'output') {
              const previous = outputTails.get(agent.id);
              outputTails.set(agent.id, Buffer.concat([previous, Buffer.from(event.text)]).subarray(-65_536));
              tail = api.outputTail(agent.id);
            }
            if (event.type === 'pty_ready') {
              record.pid = event.pid;
              record.terminalSessionId = event.sessionId;
              persist(state);
            }
            emit({ ...event, agentId: agent.id, ...(event.type === 'pty_ready' ? { terminalSessionId: event.sessionId } : {}),
              ...(event.type === 'session_started' ? { nativeSessionId: event.sessionId } : {}) });
          };
          let handle;
          if (agent.nativeKind) {
            const native = agent.nativeKind === 'local'
              ? (await import('./local-agent.js')).createLocalAgentSession({ id: agent.id, endpoint: agent.localEndpoint,
                model: agent.model, cwd: record.workspace.path, mode: 'coding', timeoutMs: agent.timeoutMs,
                onEvent: receive, onApproval })
              : createNativeAgentSession({ id: agent.id, kind: agent.nativeKind, command: agent.command,
                model: agent.model, effort: agent.effort, account: agent.account,
                cwd: record.workspace.path, mode: 'coding', timeoutMs: agent.timeoutMs, onEvent: receive });
            const completion = native.send(prompt, { signal: commandSignal }).then(result => {
              if (typeof result.text === 'string') tail = result.text.slice(-65_536);
              if (result.sessionId) record.nativeSessionId = result.sessionId;
              return { ...result, exitCode: result.exitCode ?? null };
            });
            handle = { completion, stop: () => native.stop(), send: () => false, endInput: () => true,
              get pid() { return native.pid; } };
          } else {
            const start = agent.transport === 'pty' ? startDarwinPtyCommand : startCommand;
            handle = start({ id: agent.id, command: agent.command, args, cwd: record.workspace.path, env: environment,
            ...(agent.transport === 'pty' ? { helperPath: ptyHelper, columns: record.terminal.columns, rows: record.terminal.rows } : {}),
            timeoutMs: agent.timeoutMs, signal: commandSignal, onEvent: receive });
          }
          handles.set(agent.id, handle);
          if (input !== undefined && !handle.send(input)) { handle.stop(); fail('project_initial_input_rejected'); }
          if (agent.inputMode === 'closed') handle.endInput();
          const result = await handle.completion;
          record.status = result.status;
          record.result = result;
          record.finishedAt = new Date().toISOString();
          persist(state);
          emit({ type: 'agent_status', agentId: agent.id, ...result });
          if (result.status !== 'succeeded') throw new Error('project_command_did_not_succeed');
          return { output: JSON.stringify({ agentId: agent.id, workspace: record.workspace.path, ...result, outputTail: tail }) };
        } catch (error) {
          if (record.status === 'running') {
            handles.get(agent.id)?.stop();
            record.status = 'failed';
            record.result = { status: 'failed', exitCode: null, error: ['project_expanded_input_too_large', 'project_initial_input_rejected'].includes(error.message) ? error.message : 'project_command_start_failed' };
            record.finishedAt = new Date().toISOString();
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
          emit({ type: 'agent_status', agentId: record.id, status: record.status });
        }
        state.report = { status: storageFailure ? 'failed' : report.status, ...(storageFailure ? { error: 'project_storage_failed' } : {}) };
        return { ...state.report, sessionRoot: state.sessionRoot, integration: state.integration,
          agents: structuredClone(state.agents) };
      } finally {
        stopAll();
        await settleCommands();
        state.active = false;
        state.finishedAt = new Date().toISOString();
        signal?.removeEventListener('abort', stopAll);
        persist(state);
        emit({ type: 'session_finished', status: state.report?.status ?? 'failed' });
      }
    },
  };
  return api;
}
