import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface, clearLine, clearScreenDown, cursorTo, moveCursor } from 'node:readline';
import { basename } from 'node:path';
import { createProjectSession, validateProjectPlan, inspectProjectSession, integrateProjectSession } from '../src/index.js';
import { attachNativeTerminal } from './attach-terminal.js';
import { createActivityView } from './activity-view.js';

const help = `Project collaboration (pipes by default; experimental Mac PTY transport)

  koto project start <plan.json> [--start] [--headless]
  koto project inspect <session-directory> <agent>
  koto project integrate <session-directory> <agent> --approve <review-token>

start requires explicit launch approval; --start supplies it for a prepared plan.
Each configured command runs once in its own Git worktree with native permissions.
Integration writes only the session integration branch; it never updates main.
Build optional Mac terminal support explicitly with koto terminal build before
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
  write(`\n[${review.agentId}] ${review.agentStatus}\n${visible(review.diff)}\n`);
  if (review.untracked?.length) write(`Untracked: ${JSON.stringify(review.untracked)}\n`);
  if (review.outsideOwnership.length) write(`Outside declared ownership: ${JSON.stringify(review.outsideOwnership)}\n`);
  write(`Review token: ${review.reviewToken}\n`);
}

/** Terminal rendering is a thin consumer of core session operations/events. */
export async function runProjectCli(args, { write, signal } = {}) {
  if (!args.length || args[0] === '--help') { write(help); return 0; }
  if (args[0] === 'inspect' && args.length === 3) {
    showReview(await inspectProjectSession(args[1], args[2]), write);
    return 0;
  }
  if (args[0] === 'integrate' && args.length === 5 && args[3] === '--approve') {
    const result = await integrateProjectSession(args[1], args[2], { approve: args[4] });
    write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'conflicts' ? 1 : 0;
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
  expectedBaseCommit, onEvent } = {}) {
  const plan = validateProjectPlan(source);
  if (expectedBaseCommit !== undefined && (typeof expectedBaseCommit !== 'string'
    || !/^[a-f0-9]{40,64}$/.test(expectedBaseCommit))) throw new TypeError('Use the exact reviewed project base commit.');
  if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function.');
  const interactive = !headless && process.stdin.isTTY && process.stdout.isTTY;
  const initialRaw = process.stdin.isRaw === true;
  if (!interactive && !approved) throw new Error('project_explicit_start_required');
  write(`Project: ${visible(plan.project)}\nGoal: ${visible(plan.goal)}\nConcurrency: ${plan.maxConcurrency}\n`);
  for (const agent of plan.agents) write(`[${agent.id}] ${visible(agent.command)} ${visible(JSON.stringify(agent.args))}\n  Task: ${visible(agent.task)}\n  Owns: ${visible(agent.owns.join(', '))}\n  Transport: ${agent.transport}; stdin: ${agent.inputMode}; unset environment: ${agent.unsetEnv.join(', ') || 'none'}\n`);
  write('Commands retain your OS permissions; worktrees are not a security sandbox. No automatic retry.\n');
  let terminal = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
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
  const reviewedTokens = new Map();
  let resolveClosed;
  const terminalClosed = new Promise(resolve => { resolveClosed = resolve; });
  const records = new Map(plan.agents.map(agent => [agent.id, agent]));
  const seenMessages = new Map();
  const metadata = agent => ({ agentId: agent.id, name: agent.nativeKind ?? basename(agent.command),
    model: agent.model ?? (() => { const index = agent.args.findIndex(arg => ['--model', '-m'].includes(arg)); return index < 0 ? undefined : agent.args[index + 1]; })(),
    task: agent.task });
  const clearPrompt = () => {
    if (!interactive || !terminal || !promptVisible) return;
    const position = terminal.getCursorPos();
    if (position.rows) moveCursor(process.stdout, 0, -position.rows);
    cursorTo(process.stdout, 0);
    clearScreenDown(process.stdout);
  };
  const finishInput = () => {
    if (controlTyping || pendingControls) return;
    resolveInputIdle?.();
    resolveInputIdle = undefined;
    inputIdle = Promise.resolve();
  };
  const hidePrompt = () => {
    clearPrompt();
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
    if (interactive && typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(initialRaw); } catch { /* The outer terminal may have disappeared. */ }
    }
  };
  const close = () => {
    if (closed || switchingTerminal) return;
    view?.pause();
    hidePrompt();
    closed = true;
    acceptingApprovals = false;
    cancelApproval?.();
    resolveInputIdle?.();
    resolveInputIdle = undefined;
    attachment?.detach('session closing');
    attachment = undefined;
    session?.stop();
    terminal?.close();
    restoreRaw();
    resolveClosed();
  };
  const onAbort = () => close();
  signal?.addEventListener('abort', onAbort, { once: true });
  terminal?.on('close', close);
  terminal?.on('SIGINT', close);
  const approveCommand = request => {
    const operation = approvalQueue.then(async () => {
      await inputIdle;
      await commandQueue;
      if (!interactive || closed || signal?.aborted || !acceptingApprovals || attachment
        || !terminal || terminal.closed || request?.tool !== 'run_command'
        || typeof request.command !== 'string' || !Array.isArray(request.args)
        || request.args.some(arg => typeof arg !== 'string') || typeof request.cwd !== 'string') return false;
      // Display every argument before approval. Never approve an abbreviated
      // command that the operator could not inspect in full.
      const args = JSON.stringify(request.args);
      if (Buffer.byteLength(args) > 65_536) return false;
      view?.pause();
      hidePrompt();
      approvalActive = true;
      write(`\n[${visible(request.agentId ?? 'local')}] requests permission to run a command\nExecutable: ${visible(JSON.stringify(request.command))}\nArguments: ${visible(args)}\nDirectory: ${visible(JSON.stringify(request.cwd))}\nCommand limit: ${visible(request.timeoutMs)} ms\n`);
      try {
        return await new Promise(resolve => {
          const questionController = new AbortController();
          let settled = false;
          const finish = answer => {
            if (settled) return;
            settled = true;
            cancelApproval = undefined;
            questionController.abort();
            resolve(answer === true);
          };
          cancelApproval = () => finish(false);
          terminal.question('Type approve to run this exact command; Enter denies: ',
            { signal: questionController.signal }, answer => finish(answer.trim() === 'approve'));
          if (closed || signal?.aborted || !acceptingApprovals) finish(false);
        });
      } finally {
        approvalActive = false;
        showPrompt();
      }
    });
    approvalQueue = operation.then(() => undefined, () => undefined);
    return operation.catch(() => false);
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
    session = await createProjectSession(plan, { signal, onApproval: approveCommand, onEvent(event) {
      const agent = records.get(event.agentId ?? event.agent);
      const details = agent ? metadata(agent) : undefined;
      view?.update(event, details);
      if (event.type === 'request' && agent?.nativeKind === 'local') {
        view?.update({ type: 'activity', agentId: agent.id, status: 'started', description: 'Requesting local model response' }, details);
      } else if (['tool_started', 'tool_completed', 'command_started'].includes(event.type)) {
        const state = event.type === 'tool_completed' ? event.result?.status ?? (event.result?.error ? 'failed' : 'completed') : 'started';
        view?.update({ type: 'activity', agentId: event.agentId, status: state,
          description: event.command ? `Command: ${event.command}` : `Tool: ${event.tool ?? 'native tool'}${event.result?.error ? ` (${event.result.error})` : ''}` }, details);
      }
      attachment?.output(event);
      if (event.type === 'assistant_message' && typeof event.text === 'string') {
        // Deltas are not printed by this terminal, so display the full native
        // message once even when that provider marks it as already streamed.
        const seen = seenMessages.get(event.agentId) ?? new Set();
        if (!event.messageId || !seen.has(event.messageId)) {
          if (event.messageId) { seen.add(event.messageId); if (seen.size > 128) seen.delete(seen.values().next().value); }
          seenMessages.set(event.agentId, seen);
          view?.message(event.agentId, event.text);
        }
      } else if (event.type === 'response' && agent?.nativeKind === 'local' && event.text) {
        view?.message(event.agentId, event.text);
      } else if (event.type === 'command_output' && event.text) {
        view?.message(`${event.agentId}:${event.stream ?? 'tool'}`, event.text);
      } else if (event.type === 'output' && agent?.transport !== 'pty') {
        view?.message(`${event.agentId}:${event.stream}`, event.text);
      } else if (event.type === 'pty_ready') {
        view?.message(event.agentId, `PTY ready; :attach ${event.agentId} to view and interact.`);
      }
      return onEvent?.(event);
    } });
    if (closed || signal?.aborted) return 130;
    if (expectedBaseCommit !== undefined && session.status().baseCommit !== expectedBaseCommit) {
      throw Object.assign(new Error(`The project HEAD changed after planning. No agent was launched. Prepared worktrees are retained at ${session.sessionRoot}. Review a new plan from the current commit.`), { code: 'project_base_changed' });
    }
    write(`Session: ${session.sessionRoot}\nIntegration workspace: ${session.status().integration.path}\n`);
    const controls = () => write('Controls: :status | :review AGENT | :integrate AGENT | :stop AGENT/all | :attach AGENT (Ctrl-] detaches) | :resize AGENT COLS ROWS | :send AGENT TEXT | :eof AGENT | :help | :quit\n');
    const showStatus = () => {
      write('\nAGENT             STATE        TRANSPORT PID       WORKSPACE\n');
      for (const agent of session.status().agents) write(`${agent.id.padEnd(18)}${agent.status.padEnd(13)}${agent.transport.padEnd(10)}${String(agent.pid ?? '-').padEnd(10)}${visible(agent.workspace.path)}\n`);
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
          const [command, id, ...rest] = line.trim().split(/\s+/);
          if (command === ':status') showStatus();
          else if (command === ':help') controls();
          else if (command === ':send' && id) {
            const text = line.replace(/^\s*:send\s+\S+\s?/, '');
            write(`Input ${session.send(id, `${text}\n`) ? 'sent' : 'unavailable'} for ${id}\n`);
          } else if (command === ':eof' && id) write(`EOF ${session.endInput(id) ? 'sent' : 'unavailable'} for ${id}\n`);
          else if (command === ':resize' && id && rest.length === 2) write(`Resize ${session.resize(id, Number(rest[0]), Number(rest[1])) ? 'sent' : 'unavailable'} for ${id}\n`);
          else if (command === ':attach' && id && !rest.length) {
            switchingTerminal = true;
            terminal.close();
            terminal = undefined;
            switchingTerminal = false;
            const reopen = reason => {
              attachment = undefined;
              if (closed || signal?.aborted) return;
              write(`\n[${id}] ${visible(reason)}. Returned to Koto controls.\n`);
              terminal = createInterface({ input: process.stdin, output: process.stdout });
              bindTerminal();
              controls();
              showPrompt();
            };
            try { attachment = attachNativeTerminal({ session, agentId: id, write, onDetach: reopen }); }
            catch (error) { if (!terminal) reopen('attachment unavailable'); throw error; }
          } else if (command === ':stop' && id) session.stop(id);
          else if ([':review', ':inspect'].includes(command) && id) {
            const review = await session.inspect(id);
            showReview(review, write);
            // Remember only a review actually displayed to this operator. The
            // core checks the token against the current tree again on apply.
            reviewedTokens.set(id, review.reviewToken);
            write(`After reviewing this diff, type :integrate ${id} to apply this contribution.\n`);
          } else if (command === ':integrate' && id && rest.length <= 1) {
            const token = rest[0] ?? reviewedTokens.get(id);
            if (!token) throw new Error(`Review ${id} first with :review ${id}.`);
            const result = await session.integrate(id, { approve: token });
            reviewedTokens.delete(id);
            write(`${id}: ${result.status}. Integration workspace: ${session.status().integration.path}\n`);
            if (result.conflicts?.length) write(`Conflicts: ${result.conflicts.map(visible).join(', ')}\n`);
          }
          else if (command === ':quit') close();
          else write('Use a listed :control command. Native pipe input must name its agent with :send.\n');
        }).catch(error => write(`Control failed: ${visible(error.message)}\n`)).finally(() => {
          pendingControls -= 1;
          finishInput();
          showPrompt();
        });
      });
    };
    if (terminal) controls();
    view = createActivityView({ write, enabled: interactive,
      beforeRender: () => { if (promptVisible && !controlTyping && !approvalActive && !attachment) clearPrompt(); },
      afterRender: () => { if (promptVisible && terminal && !terminal.closed && !controlTyping && !approvalActive && !attachment) terminal.prompt(true); },
      onError: close });
    for (const agent of plan.agents) view.register({ id: agent.id, ...metadata(agent) });
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
    await inputIdle;
    await commandQueue;
    await approvalQueue;
    view.pause();
    hidePrompt();
    attachment?.detach('agent processes ended');
    write(`\nProcess result: ${report.status}. This is not a correctness verdict.\n`);
    showStatus();
    for (const agent of report.agents) if (agent.result?.error) write(`${agent.id}: ${visible(agent.result.error)}\n`);
    write(`Session: ${report.sessionRoot}\nIntegration workspace: ${report.integration.path}\n`);
    if (terminal && !closed) {
      write('Agents ended. Inspect and explicitly integrate contributions, or :quit to retain all worktrees.\n');
      reporting = false;
      showPrompt();
      await terminalClosed;
    }
    await commandQueue;
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
    attachment?.detach('session ended');
    session?.stop();
    terminal?.close();
    view?.dispose({ clear: true });
    restoreRaw();
  }
}
