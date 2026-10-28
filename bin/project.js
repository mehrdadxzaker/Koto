import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename } from 'node:path';
import { createProjectSession, resumeProjectSession, readProjectSession, validateProjectPlan, preflightProjectPlan,
  inspectProjectSession, integrateProjectSession, finalizeProjectSessionIntegration,
  inspectProjectContributionAttempt, reconcileProjectContributionAttempt } from '../src/index.js';
import { attachNativeTerminal } from './attach-terminal.js';
import { createActivityView } from './activity-view.js';
import { createTuiReadline } from './tui-readline.js';
import { createTuiSuggestions, discoverTuiCatalog } from '../src/tui-catalog.js';
import { diffItems, taskItems, formatCompletion, formatError, renderMarkdown } from './tui-views.js';
import { clipText } from './tui-text.js';

const help = `Project collaboration (native terminal or structured pipe sessions)

  koto project start <plan.json> [--start] [--headless]
  koto project inspect <session-directory> <agent>
  koto project integrate <session-directory> <agent> --approve <review-token>
  koto project status <session-directory>
  koto project resolve <session-directory> <agent> --approve <resolution-commit>
  koto project pending <session-directory>
  koto project reconcile <session-directory> --resolution record-result|not-applied --approve <attempt-review-token>
  koto project resume <session-directory> <agent> --prompt TEXT [--start] [--headless]

start requires explicit launch approval; --start supplies it for a prepared plan.
Each configured command runs once in its own Git worktree with native permissions.
Integration writes only the session integration branch; it never updates main.
Build native terminal support explicitly with koto terminal build before
using transport: "pty". Native completion is not inferred from terminal output.
`;

function visible(value) { return String(value).replace(/\r/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''); }

async function readPlan(filename) {
  const file = await open(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK));
  try {
    if (!(await file.stat()).isFile()) throw new Error('project_plan_not_regular_file');
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > 1024 * 1024) throw new Error('project_plan_too_large');
    return validateProjectPlan(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total))));
  } finally { await file.close(); }
}

function showReview(review, write) {
  write(`\n[${review.agentId}] ${review.agentStatus}\n${visible(review.integrationDiff ?? review.diff)}\n`);
  if (review.contributionBaseCommit !== review.baseCommit) write(`Showing changes since the last integrated snapshot ${review.contributionBaseCommit}.\n`);
  if (review.untracked?.length) write(`Untracked: ${JSON.stringify(review.untracked)}\n`);
  if (review.outsideOwnership.length) write(`Outside declared ownership: ${JSON.stringify(review.outsideOwnership)}\n`);
  write(`Review token: ${review.reviewToken}\n`);
}

function showContributionAttempt(attempt, write) {
  if (!attempt) { write('No unresolved integration attempt.\n'); return; }
  write(`${JSON.stringify(attempt, null, 2)}\n`);
  if (attempt.ownerLive) write('The attempt owner is still active; reconciliation is unavailable.\n');
  else if (!attempt.possibleResolutions.length) write('The current Git state needs explicit inspection before this attempt can be reconciled.\n');
  else write(`Review these refs and the retained outcome before approving a resolution: ${attempt.possibleResolutions.join(', ')}.\n`);
}

/** Terminal rendering is a thin consumer of core session operations/events. */
export async function runProjectCli(args, { write, signal } = {}) {
  if (!args.length || args[0] === '--help') { write(help); return 0; }
  if (args[0] === 'status' && args.length === 2) {
    const state = readProjectSession(args[1]);
    write(`${JSON.stringify({ sessionRoot: state.sessionRoot, active: state.active,
      agents: state.agents.map(agent => ({ id: agent.id, status: agent.status, result: agent.result,
        native: agent.nativeState, attempts: agent.attempts, integration: agent.integration?.status })) }, null, 2)}\n`);
    return 0;
  }
  if (args[0] === 'pending' && args.length === 2) {
    showContributionAttempt(await inspectProjectContributionAttempt(args[1]), write);
    return 0;
  }
  if (args[0] === 'reconcile' && args.length === 6 && args[2] === '--resolution'
      && ['record-result', 'not-applied'].includes(args[3]) && args[4] === '--approve') {
    const result = await reconcileProjectContributionAttempt(args[1], { resolution: args[3], approve: args[5] });
    write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (args[0] === 'resume' && args.length >= 5 && args[3] === '--prompt'
      && args.slice(5).every(arg => ['--start', '--headless'].includes(arg))) {
    return runProjectResume(args[1], args[2], { prompt: args[4], write, signal,
      approved: args.includes('--start'), headless: args.includes('--headless') });
  }
  if (args[0] === 'inspect' && args.length === 3) {
    showReview(await inspectProjectSession(args[1], args[2]), write);
    return 0;
  }
  if (args[0] === 'integrate' && args.length === 5 && args[3] === '--approve') {
    const result = await integrateProjectSession(args[1], args[2], { approve: args[4] });
    write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'conflicts' ? 1 : 0;
  }
  if (args[0] === 'resolve' && args.length === 5 && args[3] === '--approve') {
    const result = await finalizeProjectSessionIntegration(args[1], args[2], { approveIntegrationCommit: args[4] });
    write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (args[0] !== 'start' || args.length < 2 || args.slice(2).some(arg => !['--start', '--headless'].includes(arg))) {
    write(help); return 2;
  }
  const plan = await readPlan(args[1]);
  const headless = args.includes('--headless');
  const approved = args.includes('--start');
  return runProjectPlan(plan, { write, signal, headless, approved });
}

/** Launchers and plan files use the same terminal/session implementation. */
export async function runProjectPlan(source, { write, signal, headless = false, approved = false,
  expectedBaseCommit, onEvent, onSession, compact = false, conversation } = {}) {
  return runSessionTerminal(source, { write, signal, headless, approved, expectedBaseCommit, onEvent, onSession, compact, conversation });
}

/** An explicit resume shares every terminal control with an initial launch. */
export async function runProjectResume(sessionRoot, agentId, { prompt, write, signal, headless = false,
  approved = false, onEvent } = {}) {
  let observe;
  let approve;
  const prepared = await resumeProjectSession(sessionRoot, agentId, { prompt, signal,
    onEvent: event => observe?.(event), onApproval: request => approve?.(request) ?? false });
  try {
    return await runSessionTerminal(prepared.launchPlan, { write, signal, headless, approved,
      prepared, onEvent, observe: callback => { observe = callback; },
      bindApproval: callback => { approve = callback; } });
  } finally { prepared.stop(); }
}

async function runSessionTerminal(source, { write, signal, headless, approved, prepared, observe,
  bindApproval, expectedBaseCommit, onEvent, onSession, compact = false, conversation } = {}) {
  const plan = validateProjectPlan(source);
  if (expectedBaseCommit !== undefined && (typeof expectedBaseCommit !== 'string'
    || !/^[a-f0-9]{40,64}$/.test(expectedBaseCommit))) throw new TypeError('Use the exact reviewed project base commit.');
  if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function.');
  if (conversation !== undefined && (!conversation || typeof conversation.send !== 'function'
    || typeof conversation.stop !== 'function' || typeof conversation.bind !== 'function')) {
    throw new TypeError('A conversation requires send, stop and bind functions.');
  }
  const interactive = !headless && process.stdin.isTTY && process.stdout.isTTY;
  const initialRaw = process.stdin.isRaw === true;
  if (!interactive && !approved) throw new Error('project_explicit_start_required');
  write(`Project: ${visible(plan.project)}\nGoal: ${visible(plan.goal)}\nConcurrency: ${plan.maxConcurrency}\n`);
  for (const agent of plan.agents) write(compact
    ? `[${agent.id}] ${visible(agent.nativeKind ?? 'agent')} / ${visible(agent.model ?? 'native default model')}\n  Task: ${visible(agent.task)}\n  Files: ${visible(agent.owns.join(', '))}\n`
    : `[${agent.id}] ${visible(agent.command)} ${visible(JSON.stringify(agent.args))}\n  Task: ${visible(agent.task)}\n  Owns: ${visible(agent.owns.join(', '))}\n  Transport: ${agent.transport}; stdin: ${agent.inputMode}; unset environment: ${agent.unsetEnv.join(', ') || 'none'}\n`);
  if (!prepared) {
    const readiness = await preflightProjectPlan(plan);
    for (const check of readiness.checks) write(`[${check.status}] ${check.agentId ? `${check.agentId}: ` : ''}${visible(check.message)}\n`);
    if (!readiness.ok) return 2;
  } else write('Continuing the recorded native conversation in its original worktree. Prior partial edits and attempt records are retained.\n');
  write('Commands retain your OS permissions; worktrees are not a security sandbox. No automatic retry.\n');
  let terminal;
  let session;
  let closed = false;
  let attachment;
  let switchingTerminal = false;
  let view;
  let promptVisible = false;
  let controlTyping = false;
  let approvalActive = false;
  let acceptingApprovals = false;
  let reporting = false;
  let cancelApproval;
  let inputIdle = Promise.resolve();
  let resolveInputIdle;
  let approvalQueue = Promise.resolve();
  let commandQueue = Promise.resolve();
  let pendingControls = 0;
  let conversationQueue = Promise.resolve();
  let pendingMessages = 0;
  const heldMessages = [];
  let conversationEpoch = 0;
  let conversationFailure;
  let conversationTurn;
  let conversationBound = false;
  const conversationController = new AbortController();
  const fatalConversation = error => typeof error?.code === 'string'
    && /(?:cleanup_unconfirmed|socket_exhausted)$/.test(error.code);
  const fatalOperation = error => fatalConversation(error)
    || /(?:cleanup_(?:unconfirmed|not_confirmed)|EADDRNOTAVAIL|EMFILE|ENFILE)/.test(`${error?.code ?? ''} ${error?.message ?? ''}`);
  const retainConversationFailure = error => {
    if (!conversationFailure || /cleanup_unconfirmed$/.test(error?.code ?? '')) conversationFailure = error;
  };
  const stopConversation = () => {
    conversationEpoch += 1;
    heldMessages.length = 0;
    conversationTurn?.abort();
    try { conversation?.stop(); }
    catch (error) { retainConversationFailure(error); }
  };
  const reviewedTokens = new Map();
  const partialReviews = new Set();
  let resolveClosed;
  const terminalClosed = new Promise(resolve => { resolveClosed = resolve; });
  const records = new Map(plan.agents.map(agent => [agent.id, agent]));
  const seenMessages = new Map();
  const activityRecords = [];
  let activityBytes = 0, inputHistory = [], catalogPromise;
  let conversationId = 'kotoCoordinator';
  while (records.has(conversationId)) conversationId += '_';
  const metadata = agent => ({ agentId: agent.id, name: agent.nativeKind ?? agent.native?.kind ?? basename(agent.command),
    provider: agent.nativeKind ?? agent.native?.kind, transport: agent.transport,
    model: agent.model ?? (() => { const index = agent.args.findIndex(arg => ['--model', '-m'].includes(arg)); return index < 0 ? undefined : agent.args[index + 1]; })(),
    task: agent.task });
  const clearPrompt = () => {
    if (!interactive || !terminal || !promptVisible) return;
    terminal.clear();
  };
  const finishInput = () => {
    if (controlTyping || pendingControls) return;
    resolveInputIdle?.();
    resolveInputIdle = undefined;
    inputIdle = Promise.resolve();
  };
  const hidePrompt = () => {
    clearPrompt();
    terminal?.pausePrompt();
    promptVisible = false;
  };
  const showPrompt = () => {
    if (!interactive || !terminal || terminal.closed || closed || attachment || approvalActive
      || reporting || controlTyping || pendingControls) return;
    view?.resume();
    promptVisible = true;
    terminal.prompt();
  };
  // Stop redraw before readline handles the first key. It can then own even a
  // wrapped input line until submission; no private readline internals needed.
  const beginTyping = () => {
    if (!terminal || terminal.closed || closed || attachment || approvalActive || !promptVisible) return;
    view?.pause();
    promptVisible = false;
    controlTyping = true;
    if (!resolveInputIdle) inputIdle = new Promise(resolve => { resolveInputIdle = resolve; });
  };
  const restoreRaw = () => {
    if (!interactive) return;
    // A constructor can fail before returning a readline owner to close.
    // Stop its inherited flowing input as well as restoring the terminal mode.
    try { process.stdin.pause(); } catch { /* The outer terminal may have disappeared. */ }
    if (typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(initialRaw); } catch { /* The outer terminal may have disappeared. */ }
    }
  };
  const close = () => {
    if (closed || switchingTerminal) return;
    closed = true;
    conversationController.abort();
    stopConversation();
    acceptingApprovals = false;
    resolveInputIdle?.();
    resolveInputIdle = undefined;
    for (const cleanup of [() => view?.pause(), hidePrompt, () => cancelApproval?.(),
      () => attachment?.detach('session closing'), () => session?.stop(), () => terminal?.close()]) {
      try { cleanup(); } catch (error) { retainConversationFailure(error); }
    }
    attachment = undefined;
    restoreRaw();
    resolveClosed();
  };
  const onAbort = () => close();
  signal?.addEventListener('abort', onAbort, { once: true });
  const controlCommands = [
    ['tasks', '', 'Browse actual task ownership, dependencies and state'],
    ['activity', '', 'Expand observed agent activity'], ['tools', '', 'Expand bounded command and tool output'],
    ['diff', 'AGENT', 'Browse a contribution diff'], ['review', 'AGENT', 'Review current changes and retain its exact review token'],
    ['integrate', 'AGENT', 'Explicitly integrate a freshly reviewed contribution'],
    ['status', '', 'Show actual native and process state'],
    ['attach', 'AGENT', 'Open a native terminal; Ctrl-] returns to Koto'],
    ['stop', 'AGENT|all', 'Stop owned worker work'], ['resize', 'AGENT COLS ROWS', 'Resize a native terminal'],
    ['send', 'AGENT TEXT', 'Send explicit input to one pipe agent'], ['eof', 'AGENT', 'Close one pipe input'],
    ['pending', '', 'Inspect an unresolved integration attempt'],
    ['resolve', 'AGENT COMMIT', 'Record reviewed conflict resolution'],
    ['reconcile', 'RESOLUTION TOKEN', 'Resolve an explicitly reviewed integration attempt'],
    ...(conversation ? [['chat', 'TEXT', 'Ask the coordinator without leaving this session'],
      ['queue', '[edit|remove|send] NUMBER', 'Review held coordinator messages before sending'],
      ['chat-stop', '', 'Stop the coordinator turn and queued messages']] : []),
    ['help', '', 'Show current session controls'], ['quit', '', 'Stop owned work and retain worktrees'],
  ].map(([name, args, description]) => ({ name, args, description }));
  const catalog = async () => {
    catalogPromise ??= discoverTuiCatalog({ project: plan.project, signal,
      preferences: { workers: plan.agents,
        ...(conversation?.provider ? { coordinator: { kind: conversation.provider, model: conversation.model } } : {}) },
    }).catch(error => {
      if (signal?.aborted || fatalOperation(error)) {
        retainConversationFailure(error);
        close();
        throw error;
      }
      return { agents: [], models: [], files: [], skills: [], connections: [], warnings: [visible(error.message)] };
    });
    const found = await catalogPromise;
    const state = session?.status();
    return { ...found, agents: found.agents.map(agent => ({ ...agent,
      status: state?.agents.find(item => item.id === agent.id)?.status ?? agent.status })) };
  };
  const suggestions = createTuiSuggestions({ getCatalog: catalog, getCommands: () => controlCommands,
    getSessions: () => session ? [session.status()] : [], getQueue: () => heldMessages });
  const makeTerminal = () => {
    const next = createTuiReadline({ write, signal, suggest: suggestions, plain: conversation?.plain,
      getStatus: () => {
        const state = session?.status();
        const running = state?.agents.filter(agent => agent.status === 'running').length ?? 0;
        const pending = state?.agents.filter(agent => agent.status === 'pending').length ?? 0;
        return `${basename(plan.project)} · Build · ${running} running · ${pending} pending${conversation ? ` · ${conversation.provider ?? 'coordinator'} / ${conversation.model ?? 'native default'}${heldMessages.length ? ` · ${heldMessages.length} queued` : ''}` : ''}`;
      } });
    next.getInput().setHistory(inputHistory);
    next.on('inputError', error => { write(`${formatError(error)}\n`); close(); });
    return next;
  };
  terminal = interactive ? makeTerminal() : undefined;
  terminal?.on('close', close);
  terminal?.on('SIGINT', close);
  const rememberActivity = event => {
    if (!interactive || !event || !['activity', 'native_status', 'tool_started', 'tool_completed',
      'command_started', 'command_output', 'output', 'approval_request'].includes(event.type)) return false;
    const last = activityRecords.at(-1);
    if (['command_output', 'output'].includes(event.type) && last?.type === event.type
      && last.agentId === event.agentId && last.stream === event.stream) {
      const before = Buffer.byteLength(JSON.stringify(last));
      const combined = (last.text ?? '') + visible(event.text ?? '');
      last.text = combined.slice(-16_384);
      last.truncated ||= combined.length > 16_384;
      activityBytes += Buffer.byteLength(JSON.stringify(last)) - before;
      return false;
    }
    const record = { at: new Date().toISOString(), type: event.type, agentId: event.agentId,
      status: event.status ?? event.nativeStatus, stream: event.stream,
      description: visible(event.description ?? event.activity ?? '').slice(0, 2048),
      command: visible(event.command ?? '').slice(0, 4096), tool: visible(event.tool ?? '').slice(0, 256),
      text: visible(event.text ?? '').slice(-16_384), truncated: String(event.text ?? '').length > 16_384
        || String(event.command ?? '').length > 4096 || String(event.description ?? event.activity ?? '').length > 2048
        || String(event.tool ?? '').length > 256 };
    activityRecords.push(record); activityBytes += Buffer.byteLength(JSON.stringify(record));
    while (activityRecords.length > 128 || activityBytes > 512 * 1024) {
      activityBytes -= Buffer.byteLength(JSON.stringify(activityRecords.shift()));
    }
    return true;
  };
  const approveCommand = request => {
    const operation = approvalQueue.then(async () => {
      await commandQueue;
      if (!interactive || closed || signal?.aborted || !acceptingApprovals || attachment
        || !terminal || terminal.closed || !request || typeof request !== 'object'
        || Array.isArray(request)) return false;
      const requestSignal = request.signal;
      if (requestSignal !== undefined && !(requestSignal instanceof AbortSignal)
        || requestSignal?.aborted) return false;
      const hasText = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
      const localCommand = !request.method && [undefined, 'local'].includes(request.kind)
        && request.tool === 'run_command' && hasText(request.command) && hasText(request.cwd)
        && Array.isArray(request.args) && request.args.every(arg => typeof arg === 'string' && !arg.includes('\0'));
      const codexCommand = request.method === 'item/commandExecution/requestApproval' && hasText(request.command);
      const codexChanges = request.method === 'item/fileChange/requestApproval'
        && Array.isArray(request.changes) && request.changes.length > 0;
      const codexRequest = (codexCommand || codexChanges) && request.requestId !== undefined
        && hasText(request.threadId) && hasText(request.turnId) && hasText(request.itemId)
        && (!Array.isArray(request.availableDecisions) || request.availableDecisions.includes('accept'));
      const claudeRequest = request.kind === 'claude' && request.requestId !== undefined
        && hasText(request.tool) && request.input !== null && typeof request.input === 'object'
        && !Array.isArray(request.input);
      if (!localCommand && !codexRequest && !claudeRequest) return false;
      // Show all serializable fields supplied by the native request, including
      // argv, file changes, tool input and permission context. The AbortSignal
      // is a live cancellation channel, not an action the operator can approve.
      let detail;
      try {
        detail = JSON.stringify(Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'signal')), null, 2);
      } catch { return false; }
      if (!detail || Buffer.byteLength(detail) > 65_536) return false;
      detail = detail.replace(/[\u202a-\u202e\u2066-\u2069]/g,
        character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
      rememberActivity({ type: 'approval_request', agentId: request.agentId, tool: request.tool,
        command: request.command, status: 'waiting', text: detail });
      view?.pause();
      hidePrompt();
      // The input owner preserves a partial draft separately from approval
      // answers, so an unfinished message cannot accidentally grant permission.
      controlTyping = false;
      finishInput();
      approvalActive = true;
      write(`\n[${visible(request.agentId ?? request.kind ?? (codexRequest ? 'codex' : 'local'))}] requests permission\n${detail}\n`);
      try {
        return await new Promise(resolve => {
          const questionController = new AbortController();
          let settled = false;
          const denyCancelledRequest = () => finish(false);
          const finish = answer => {
            if (settled) return;
            settled = true;
            cancelApproval = undefined;
            requestSignal?.removeEventListener('abort', denyCancelledRequest);
            questionController.abort();
            resolve(answer === true);
          };
          cancelApproval = () => finish(false);
          requestSignal?.addEventListener('abort', denyCancelledRequest, { once: true });
          const combined = AbortSignal.any([questionController.signal, ...(requestSignal ? [requestSignal] : []), ...(signal ? [signal] : [])]);
          terminal.choose({ title: 'Permission for this exact displayed action', initial: 'deny', signal: combined,
            items: [{ value: 'deny', label: 'Deny', description: 'Do not permit this requested action' },
              { value: 'approve', label: 'Approve once', description: 'Permit only this displayed native request' },
              { value: 'stop', label: 'Stop this work', description: 'Deny the request and stop its owned agent or coordinator turn' }],
          }).then(answer => {
            if (answer === 'stop') {
              if (request.agentId === conversationId) stopConversation();
              else if (records.has(request.agentId)) session?.stop(request.agentId);
              else session?.stop();
            }
            finish(answer === 'approve');
          }).catch(error => {
            if (fatalOperation(error)) { retainConversationFailure(error); close(); }
            finish(false);
          });
          if (closed || signal?.aborted || requestSignal?.aborted || !acceptingApprovals) finish(false);
        });
      } finally {
        approvalActive = false;
        showPrompt();
      }
    });
    approvalQueue = operation.then(() => undefined, () => undefined);
    return operation.catch(() => false);
  };
  // Conversation work is independent of commandQueue: an in-flight native
  // turn may ask for approval, whose prompt itself waits for controls to settle.
  const queueMessage = text => {
    if (!conversation || !interactive || !text.trim() || text.includes('\0') || Buffer.byteLength(text) > 32_768) {
      write('Enter a coordinator message of at most 32 KiB.\n'); return;
    }
    if (pendingMessages) {
      if (heldMessages.length >= 8) { write('The eight-message coordinator queue is full; use /queue to edit or remove a held message.\n'); return; }
      heldMessages.push(text);
      write(`Follow-up ${heldMessages.length} held in /queue. It will not send automatically; review, edit or send it explicitly.\n`);
      return;
    }
    const epoch = conversationEpoch;
    pendingMessages += 1;
    write('Sending coordinator message. /chat-stop cancels its turn; follow-ups are held for explicit review.\n');
    conversationQueue = conversationQueue.then(async () => {
      if (closed || conversationController.signal.aborted || epoch !== conversationEpoch) return;
      view?.update({ type: 'agent_status', agentId: conversationId, status: 'running' });
      conversationTurn = new AbortController();
      const reply = await conversation.send(text, { state: session.status(),
        signal: AbortSignal.any([conversationController.signal, conversationTurn.signal]) });
      if (!closed && epoch === conversationEpoch && typeof reply === 'string') view?.message(conversationId, renderMarkdown(reply));
      view?.update({ type: 'agent_status', agentId: conversationId, status: 'idle' });
    }).catch(error => {
      if (fatalConversation(error)) { retainConversationFailure(error); close(); }
      else if (!closed) view?.message(conversationId, `Conversation failed: ${visible(error.message)}`);
      view?.update({ type: 'agent_status', agentId: conversationId, status: 'failed' });
    }).finally(() => { conversationTurn = undefined; pendingMessages -= 1; });
  };
  try {
    if (signal?.aborted) close();
    if (!approved && !closed) {
      const answer = await new Promise(resolve => {
        if (terminal.closed) { resolve(''); return; }
        terminal.question('Type start to launch these commands: ', resolve);
        terminal.once('close', () => resolve(''));
      });
      if (answer.trim() !== 'start') close();
    }
    if (closed || signal?.aborted) return 130;
    const receiveEvent = event => {
      const agent = records.get(event.agentId ?? event.agent);
      const details = agent ? metadata(agent) : undefined;
      const newActivity = rememberActivity(event);
      view?.update(event, details);
      attachment?.output(event);
      if (event.type === 'assistant_message' && typeof event.text === 'string') {
        // Deltas are not printed by this terminal, so display the full native
        // message once even when that provider marks it as already streamed.
        const seen = seenMessages.get(event.agentId) ?? new Set();
        if (!event.messageId || !seen.has(event.messageId)) {
          if (event.messageId) { seen.add(event.messageId); if (seen.size > 128) seen.delete(seen.values().next().value); }
          seenMessages.set(event.agentId, seen);
          view?.message(event.agentId, renderMarkdown(event.text));
        }
      } else if (event.type === 'response' && agent?.nativeKind === 'local' && event.text) {
        view?.message(event.agentId, renderMarkdown(event.text));
      } else if (event.type === 'command_output' && event.text) {
        if (!interactive) view?.message(`${event.agentId}:${event.stream ?? 'tool'}`, event.text);
        else if (newActivity) view?.message(`${event.agentId}:${event.stream ?? 'tool'}`,
          `${visible(event.text).split('\n')[0].slice(0, 160)}\nTool output retained in /tools (bounded; Right expands details).`);
      } else if (event.type === 'output' && agent?.transport !== 'pty') {
        if (!interactive) view?.message(`${event.agentId}:${event.stream}`, event.text);
        else if (newActivity) view?.message(`${event.agentId}:${event.stream}`,
          `${visible(event.text).split('\n')[0].slice(0, 160)}\nOutput retained in /tools (bounded; Right expands details).`);
      } else if (event.type === 'pty_ready') {
        view?.message(event.agentId, `PTY ready; :attach ${event.agentId} to view and interact.`);
      } else if (event.type === 'native_status') {
        view?.message(event.agentId, `Native: ${visible(event.nativeStatus)}${event.nativeSessionId ? `; session ${visible(event.nativeSessionId)}` : ''}`);
      } else if (event.type === 'terminal_cleanup' && event.cleanup === 'unconfirmed') {
        const diagnostic = event.cleanupDiagnostic;
        const operation = diagnostic?.structuralOperation !== 'none' ? diagnostic?.structuralOperation : diagnostic?.observationOperation;
        const code = diagnostic?.structuralOperation !== 'none' ? diagnostic?.structuralErrno : diagnostic?.observationErrno;
        view?.message(event.agentId, `Owned process cleanup is unconfirmed${operation && operation !== 'none' ? ` (${operation}, errno ${code})` : ''}. Inspect the owned process state; this retained session remains blocked from integration and resume.`);
      }
      return onEvent?.(event);
    };
    bindApproval?.(approveCommand);
    if (prepared) { observe(receiveEvent); session = prepared; }
    else session = await createProjectSession(plan, { signal, onApproval: approveCommand, onEvent: receiveEvent });
    await onSession?.(session.status());
    if (closed || signal?.aborted) return 130;
    if (expectedBaseCommit !== undefined && session.status().baseCommit !== expectedBaseCommit) {
      throw Object.assign(new Error(`The project HEAD changed after planning. No agent was launched. Prepared worktrees are retained at ${session.sessionRoot}. Review a new plan from the current commit.`), { code: 'project_base_changed' });
    }
    write(`Session: ${session.sessionRoot}\nIntegration workspace: ${session.status().integration.path}\n`);
    const controls = () => { write('Controls: / opens the command menu; @ selects project or agent context. /tasks | /activity | /tools | /diff AGENT | /status | /review AGENT | /integrate AGENT | /stop AGENT/all | /attach AGENT (Ctrl-] detaches) | /help | /quit\nLegacy : controls remain available, including :resolve AGENT COMMIT, :pending, :reconcile RESOLUTION TOKEN, :resize AGENT COLS ROWS, :send AGENT TEXT and :eof AGENT.\n');
      if (conversation) write('Message the coordinator here, or use :chat TEXT. :chat-stop stops its turn; workers keep running. Follow-up builds still require plan review.\n');
    };
    const showStatus = () => {
      write('\nAGENT             STATE        TRANSPORT PID       WORKSPACE\n');
      for (const agent of session.status().agents) {
        write(`${agent.id.padEnd(18)}${agent.status.padEnd(13)}${agent.transport.padEnd(10)}${String(agent.pid ?? '-').padEnd(10)}${visible(agent.workspace.path)}\n`);
        if (agent.nativeState) write(`  Native ${visible(agent.nativeState.status)}; session ${visible(agent.nativeState.sessionId ?? 'not exposed')}; resume ${agent.nativeState.resumable ? 'available' : 'unavailable'}\n`);
      }
    };
    const bindTerminal = () => {
      terminal.setPrompt('Agents> ');
      terminal.removeListener('close', close);
      terminal.removeListener('SIGINT', close);
      terminal.on('close', close);
      terminal.on('SIGINT', close);
      terminal.on('line', line => {
        if (approvalActive) return;
        controlTyping = false;
        if (line.length > 65_536 || pendingControls >= 32) {
          write('Control input exceeds the bounded queue.\n');
          finishInput(); showPrompt(); return;
        }
        pendingControls += 1;
        commandQueue = commandQueue.then(async () => {
          if (closed || attachment) return;
          view?.pause();
          hidePrompt();
          const [enteredCommand, id, ...rest] = line.trim().split(/\s+/);
          const command = enteredCommand.startsWith('/') ? `:${enteredCommand.slice(1)}` : enteredCommand;
          if (conversation && command === ':chat-stop') {
            stopConversation();
            if (conversationFailure) { close(); throw conversationFailure; }
          } else if (conversation && command === ':chat') queueMessage(line.replace(/^\s*[:/]chat\s*/, ''));
          else if (conversation && command && !command.startsWith(':')) queueMessage(line.trim());
          else if (conversation && command === ':queue') {
            if (!heldMessages.length) { write('No held coordinator messages.\n'); return; }
            let action = id;
            let number = Number(rest[0]);
            if (!action) {
              const selected = await terminal.choose({ title: 'Held coordinator messages · nothing sends automatically', signal,
                items: heldMessages.map((text, index) => ({ value: index + 1, label: `${index + 1}. ${visible(text).split('\n')[0].slice(0, 160)}`, description: 'Held until you explicitly choose Send', detail: text })) });
              if (selected === null) return;
              number = selected;
              action = await terminal.choose({ title: `Message ${number}`, initial: 'edit', signal,
                items: [{ value: 'edit', label: 'Edit in composer', description: 'Remove from queue and restore as an unsent draft' },
                  { value: 'remove', label: 'Remove', description: 'Discard this held follow-up' },
                  { value: 'send', label: 'Send now', description: pendingMessages ? 'Wait for or stop the current coordinator turn first' : 'Send this message to the coordinator', disabled: pendingMessages > 0 }] });
              if (action === null) return;
            }
            if (!['edit', 'remove', 'send'].includes(action) || !Number.isInteger(number) || number < 1 || number > heldMessages.length) {
              throw new Error('Use /queue, or /queue edit|remove|send NUMBER from the displayed held messages.');
            }
            if (action === 'send' && pendingMessages) throw new Error('The coordinator is still working. Wait for it to finish, or use /chat-stop.');
            if (action === 'edit' && terminal.getInput().getDraft().trim()) {
              throw new Error('The composer already contains an unsent draft. Send or clear it before restoring a queued message.');
            }
            const [text] = heldMessages.splice(number - 1, 1);
            if (action === 'edit') terminal.getInput().setDraft(text);
            else if (action === 'send') queueMessage(text);
            write(action === 'edit' ? 'Restored as an unsent composer draft.\n' : action === 'remove' ? 'Held message removed.\n' : 'Selected held message sent.\n');
          }
          else if (command === ':tasks') {
            await terminal.browse({ title: 'Project tasks · actual recorded state', items: taskItems(session.status()), signal });
          }
          else if (command === ':activity' || command === ':tools') {
            const selected = command === ':tools' ? activityRecords.filter(item => /tool|command|output|approval/.test(item.type)
              || item.command || item.tool) : activityRecords;
            const items = selected.slice().reverse().map((item, index) => ({ value: String(index),
              label: `${item.at.slice(11, 19)} · ${item.agentId ?? 'agent'} · ${item.type}${item.status ? ` · ${item.status}` : ''}`,
              description: item.command || item.tool || item.description || item.text.split('\n')[0],
              detail: `${JSON.stringify(item, null, 2)}${item.truncated ? '\n[Only the bounded output tail is retained.]' : ''}` }));
            if (!items.length) write('No matching activity has been observed in this terminal yet.\n');
            else await terminal.browse({ title: command === ':tools' ? 'Observed tool and command output · Right expands' : 'Observed agent activity · Right expands', items, signal });
          }
          else if (command === ':status') showStatus();
          else if (command === ':help') controls();
          else if (command === ':send' && id) {
            const text = line.replace(/^\s*[:/]send\s+\S+\s?/, '');
            write(`Input ${session.send(id, `${text}\n`) ? 'sent' : 'unavailable'} for ${id}\n`);
          } else if (command === ':eof' && id) write(`EOF ${session.endInput(id) ? 'sent' : 'unavailable'} for ${id}\n`);
          else if (command === ':resize' && id && rest.length === 2) write(`Resize ${session.resize(id, Number(rest[0]), Number(rest[1])) ? 'sent' : 'unavailable'} for ${id}\n`);
          else if (command === ':attach' && id && !rest.length) {
            switchingTerminal = true;
            inputHistory = terminal.getInput().history;
            const handoffDraft = terminal.getInput().getDraft();
            terminal.close();
            terminal = undefined;
            switchingTerminal = false;
            const reopen = reason => {
              attachment = undefined;
              if (reason === 'terminal input closed') { close(); return false; }
              if (closed || signal?.aborted) return false;
              write(`\n[${id}] ${visible(reason)}. Returned to Koto controls.\n`);
              if (closed || signal?.aborted) return false;
              try {
                terminal = makeTerminal();
                // Input entered while the attach command waited belongs to
                // Koto's composer, not to the native terminal. Preserve it as
                // an unsent draft and never replace newer restored input.
                if (handoffDraft && !terminal.getInput().getDraft()) terminal.getInput().setDraft(handoffDraft);
                bindTerminal();
                controls();
                showPrompt();
                return !closed && !signal?.aborted && !terminal.closed;
              } catch (error) {
                const failedTerminal = terminal;
                terminal = undefined;
                try { failedTerminal?.close(); }
                catch { /* Preserve the handoff error; close still stops the session. */ }
                finally { close(); }
                throw error;
              }
            };
            try { attachment = attachNativeTerminal({ session, agentId: id, write, onDetach: reopen }); }
            catch (error) { if (!terminal) reopen('attachment unavailable'); throw error; }
          } else if (command === ':stop' && id) session.stop(id);
          else if ([':review', ':inspect', ':diff'].includes(command)) {
            let selectedId = id;
            if (!selectedId) selectedId = await terminal.choose({ title: 'Choose a contribution to review', items: taskItems(session.status()), signal });
            if (!selectedId) return;
            const review = await session.inspect(selectedId);
            const preview = diffItems(review);
            await terminal.browse({ title: `Changes from ${selectedId} · Right expands each file`, items: preview, signal });
            if (preview[0]?.truncated) {
              reviewedTokens.delete(selectedId);
              partialReviews.add(selectedId);
              write(`This is a partial diff preview; integration is blocked in this TUI. Read the full retained contribution with koto project inspect ${session.sessionRoot} ${selectedId} before approving it through the core CLI.\n`);
              return;
            }
            showReview(review, write);
            // Remember only a review actually displayed to this operator. The
            // core checks the token against the current tree again on apply.
            reviewedTokens.set(selectedId, review.reviewToken);
            partialReviews.delete(selectedId);
            write(`After reviewing this diff, type /integrate ${selectedId} to apply this contribution.\n`);
          } else if (command === ':integrate' && id && rest.length <= 1) {
            if (partialReviews.has(id)) throw new Error(`The preview for ${id} was partial. Integration through this TUI requires a complete fresh review; use the core CLI for a separately reviewed exact token.`);
            const token = rest[0] ?? reviewedTokens.get(id);
            if (!token || token !== reviewedTokens.get(id)) throw new Error(`Review ${id} first with /review ${id} in this terminal. External tokens belong to the explicit core CLI integration command.`);
            const confirmation = await terminal.choose({ title: `Integrate the exact reviewed contribution from ${id}?`, initial: 'cancel', signal,
              items: [{ value: 'cancel', label: 'Cancel', description: 'Keep the worktree and return to controls' },
                { value: 'integrate', label: 'Integrate reviewed changes once', description: `Core revalidates review token ${token} before applying` }] });
            if (confirmation !== 'integrate') return;
            const result = await session.integrate(id, { approve: token });
            reviewedTokens.delete(id);
            partialReviews.delete(id);
            write(`${id}: ${result.status}. Integration workspace: ${session.status().integration.path}\n`);
            if (result.conflicts?.length) write(`Conflicts: ${result.conflicts.map(visible).join(', ')}\n`);
          }
          else if (command === ':resolve' && id && rest.length === 1) {
            const result = await session.resolveIntegration(id, rest[0]);
            reviewedTokens.delete(id);
            partialReviews.delete(id);
            write(`${id}: ${result.status}. Reviewed conflict resolution recorded.\n`);
          }
          else if (command === ':pending' && !id) {
            showContributionAttempt(await session.inspectContributionAttempt(), write);
          }
          else if (command === ':reconcile' && ['record-result', 'not-applied'].includes(id) && rest.length === 1) {
            const result = await session.reconcileContributionAttempt({ resolution: id, approve: rest[0] });
            reviewedTokens.clear();
            partialReviews.clear();
            write(`Integration attempt ${result.attemptId}: ${result.status} (${result.resolution}).\n`);
          }
          else if (command === ':quit') close();
          else write('Use / to choose a control. Native pipe input must name its agent with /send.\n');
        }).catch(error => {
          if (fatalOperation(error)) { retainConversationFailure(error); close(); }
          write(`${formatError(error)}\n`);
        }).finally(() => {
          pendingControls -= 1;
          finishInput();
          showPrompt();
        });
      });
    };
    if (terminal) controls();
    view = createActivityView({ write, enabled: interactive,
      beforeRender: () => { if (promptVisible && !controlTyping && !approvalActive && !attachment) clearPrompt(); },
      afterRender: () => { if (promptVisible && terminal && !terminal.closed && !controlTyping && !approvalActive && !attachment) terminal.redraw(); },
      onError: close });
    for (const agent of plan.agents) view.register({ id: agent.id, ...metadata(agent) });
    if (conversation) {
      view.register({ id: conversationId, name: conversation.name ?? 'Koto', provider: conversation.provider, model: conversation.model,
        task: 'Conversation and follow-up planning', status: 'idle' });
      conversationBound = true;
      conversation.bind({
        onEvent: event => view?.update(event, { agentId: conversationId }),
        onApproval: request => approveCommand({ ...request, agentId: conversationId }),
      });
    }
    if (terminal) {
      bindTerminal();
      process.stdin.prependListener('keypress', beginTyping);
      showPrompt();
    }
    acceptingApprovals = true;
    const report = await session.run();
    acceptingApprovals = false;
    reporting = true;
    cancelApproval?.();
    // Cursor ownership is explicit now: preserve a partial compose draft while
    // reporting the settled run rather than waiting indefinitely for Enter.
    controlTyping = false;
    finishInput();
    await commandQueue;
    await approvalQueue;
    view.pause();
    hidePrompt();
    attachment?.detach('agent processes ended');
    write(`\nProcess result: ${report.status}. This is not a correctness verdict.\n`);
    const changedFiles = new Set(), outsideOwnership = new Set(), fileWarnings = [];
    let omittedPaths = 0;
    const resourceFailure = report.agents.some(agent => /(?:socket_exhausted|cleanup_unconfirmed)$/.test(agent.result?.error ?? ''));
    if (!resourceFailure) for (const agent of report.agents) {
      try {
        // This automatic inspection collects metadata only. It deliberately
        // cannot grant a displayed-review token or authorize integration.
        const review = await session.inspect(agent.id);
        const paths = new Set([...(review.changedPaths ?? []), ...(review.integrationChangedPaths ?? []),
          ...(review.untracked ?? []).map(item => typeof item === 'string' ? item : item.path)]);
        for (const filename of paths) {
          if (typeof filename !== 'string') continue;
          const entry = `${agent.id}: ${filename}`;
          if (changedFiles.size < 4096) changedFiles.add(entry); else omittedPaths += 1;
        }
        for (const filename of review.outsideOwnership ?? []) outsideOwnership.add(`${agent.id}: ${filename}`);
      } catch (error) {
        if (fatalOperation(error)) {
          retainConversationFailure(error); close(); throw error;
        }
        fileWarnings.push(`${agent.id}: ${visible(error.message)}`);
      }
    }
    else fileWarnings.push('Changed-file inspection was skipped because owned cleanup/resources remain unresolved.');
    if (fileWarnings.length) write(`Changed-file list is incomplete; unavailable inspection:\n${fileWarnings.map(item => `  ${item}`).join('\n')}\n`);
    if (omittedPaths) write(`Changed-file collection retained the first 4096 paths; ${omittedPaths} additional observed paths were omitted.\n`);
    write(`${formatCompletion({ ...report, goal: plan.goal, changedFiles: [...changedFiles], outsideOwnership: [...outsideOwnership] })}\n`);
    const latestCommands = new Map();
    for (const item of activityRecords) {
      if (!item.command) continue;
      const key = `${item.agentId ?? 'agent'}\0${item.command}`;
      latestCommands.delete(key);
      latestCommands.set(key, item);
    }
    const allCommands = [...latestCommands.values()];
    const commands = allCommands.slice(-6);
    if (commands.length) {
      write('Observed native command receipts (latest recorded status; not independent acceptance):\n');
      const lineWidth = Math.max(20, Math.min(120, (process.stdout.columns ?? 80) - 1));
      for (const item of commands) write(`${clipText(`  ${clipText(item.agentId ?? 'agent', 18)} · ${visible(item.status ?? 'outcome unreported')} · ${visible(item.command).replace(/\s+/g, ' ')}`, lineWidth)}\n`);
      if (allCommands.length > commands.length) write(`  ${allCommands.length - commands.length} more retained commands in /tools.\n`);
    }
    showStatus();
    for (const agent of report.agents) if (agent.result?.error) write(`${agent.id}: ${visible(agent.result.errorMessage ?? agent.result.error)}\n`);
    write(`Session: ${report.sessionRoot}\nIntegration workspace: ${report.integration.path}\n`);
    if (report.agents.some(agent => /(?:socket_exhausted|cleanup_unconfirmed)$/.test(agent.result?.error ?? ''))) {
      // session.run has settled every owned command before returning its report.
      // Keep that report and close the caller instead of offering another run.
      const cleanupUnconfirmed = report.agents.some(agent => /cleanup_unconfirmed$/.test(agent.result?.error ?? ''));
      throw Object.assign(new Error(cleanupUnconfirmed
        ? 'Owned project cleanup could not be confirmed after resource exhaustion. Inspect the retained session before continuing.'
        : 'Socket or file-descriptor capacity is unavailable. The owned project was stopped and retained; inspect system resources before retrying.'),
      { code: cleanupUnconfirmed ? 'cleanup_unconfirmed' : 'local_socket_exhausted' });
    }
    if (terminal && !closed) {
      write('Agents ended. Inspect and explicitly integrate contributions, or :quit to retain all worktrees.\n');
      acceptingApprovals = Boolean(conversation);
      reporting = false;
      showPrompt();
      await terminalClosed;
    }
    await commandQueue;
    if (conversationFailure) throw conversationFailure;
    return report.status === 'succeeded' ? 0 : 1;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    acceptingApprovals = false;
    reporting = true;
    cancelApproval?.();
    resolveInputIdle?.();
    process.stdin.removeListener('keypress', beginTyping);
    view?.pause();
    hidePrompt();
    closed = true;
    conversationController.abort();
    stopConversation();
    attachment?.detach('session ended');
    session?.stop();
    terminal?.close();
    view?.dispose({ clear: true });
    restoreRaw();
    // Keep approval routing bound until the last owned coordinator turn settles.
    // No queued message can launch after close, and the caller can safely reopen
    // its own readline only after this await completes.
    await conversationQueue;
    await approvalQueue;
    if (conversationBound) conversation.bind(undefined);
    if (conversationFailure) throw conversationFailure;
  }
}
