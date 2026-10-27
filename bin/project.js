import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface } from 'node:readline';
import { createProjectSession, resumeProjectSession, readProjectSession, validateProjectPlan, preflightProjectPlan,
  inspectProjectSession, integrateProjectSession, finalizeProjectSessionIntegration } from '../src/index.js';
import { attachNativeTerminal } from './attach-terminal.js';

const help = `Project collaboration (native terminal or structured pipe sessions)

  koto project start <plan.json> [--start] [--headless]
  koto project inspect <session-directory> <agent>
  koto project integrate <session-directory> <agent> --approve <review-token>
  koto project status <session-directory>
  koto project resolve <session-directory> <agent> --approve <resolution-commit>
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
export async function runProjectPlan(source, { write, signal, headless = false, approved = false } = {}) {
  return runSessionTerminal(source, { write, signal, headless, approved });
}

/** An explicit resume shares every terminal control with an initial launch. */
export async function runProjectResume(sessionRoot, agentId, { prompt, write, signal, headless = false, approved = false } = {}) {
  let observe;
  const prepared = await resumeProjectSession(sessionRoot, agentId, { prompt, signal,
    onEvent: event => observe?.(event) });
  try {
    return await runSessionTerminal(prepared.launchPlan, { write, signal, headless, approved,
      prepared, observe: callback => { observe = callback; } });
  } finally { prepared.stop(); }
}

async function runSessionTerminal(source, { write, signal, headless, approved, prepared, observe } = {}) {
  const plan = validateProjectPlan(source);
  const interactive = !headless && process.stdin.isTTY && process.stdout.isTTY;
  const initialRaw = process.stdin.isRaw === true;
  if (!interactive && !approved) throw new Error('project_explicit_start_required');
  write(`Project: ${visible(plan.project)}\nGoal: ${visible(plan.goal)}\nConcurrency: ${plan.maxConcurrency}\n`);
  for (const agent of plan.agents) write(`[${agent.id}] ${visible(agent.command)} ${visible(JSON.stringify(agent.args))}\n  Task: ${visible(agent.task)}\n  Owns: ${visible(agent.owns.join(', '))}\n  Transport: ${agent.transport}; stdin: ${agent.inputMode}; unset environment: ${agent.unsetEnv.join(', ') || 'none'}\n`);
  if (!prepared) {
    const readiness = await preflightProjectPlan(plan);
    for (const check of readiness.checks) write(`[${check.status}] ${check.agentId ? `${check.agentId}: ` : ''}${visible(check.message)}\n`);
    if (!readiness.ok) return 2;
  } else write('Continuing the recorded native conversation in its original worktree. Prior partial edits and attempt records are retained.\n');
  write('Commands retain your OS permissions; worktrees are not a security sandbox. No automatic retry.\n');
  let terminal = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  let session;
  let closed = false;
  let attachment;
  let switchingTerminal = false;
  let commandQueue = Promise.resolve();
  let pendingControls = 0;
  const reviewedTokens = new Map();
  let resolveClosed;
  const terminalClosed = new Promise(resolve => { resolveClosed = resolve; });
  const restoreRaw = () => {
    if (interactive && typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(initialRaw); } catch { /* The outer terminal may have disappeared. */ }
    }
  };
  const close = () => {
    if (closed || switchingTerminal) return;
    closed = true;
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
    const onEvent = event => {
      if (attachment) { attachment.output(event); return; }
      if (event.type === 'output') {
        const agent = plan.agents.find(record => record.id === event.agentId);
        // Full-screen PTY output belongs to the explicitly attached terminal.
        if (agent?.transport !== 'pty') write(`[${event.agentId}:${event.stream}] ${visible(event.text)}`);
      } else if (event.type === 'agent_status' || event.type === 'started') {
        write(`\n[${event.agentId}] ${event.status ?? `started pid=${event.pid}`} ${event.error ?? ''}\n`);
      } else if (event.type === 'pty_ready') {
        write(`[${event.agentId}] PTY ready; :attach ${event.agentId} to view and interact.\n`);
      } else if (event.type === 'native_status') {
        write(`[${event.agentId}] Native: ${visible(event.nativeStatus)}${event.nativeSessionId ? `; session ${visible(event.nativeSessionId)}` : ''}\n`);
      }
    };
    if (prepared) { observe(onEvent); session = prepared; }
    else session = await createProjectSession(plan, { signal, onEvent });
    if (closed || signal?.aborted) return 130;
    write(`Session: ${session.sessionRoot}\nIntegration workspace: ${session.status().integration.path}\n`);
    const controls = () => write('Controls: :status | :review AGENT | :integrate AGENT | :resolve AGENT COMMIT | :stop AGENT/all | :attach AGENT (Ctrl-] detaches) | :resize AGENT COLS ROWS | :send AGENT TEXT | :eof AGENT | :help | :quit\n');
    const showStatus = () => {
      write('\nAGENT             STATE        TRANSPORT PID       WORKSPACE\n');
      for (const agent of session.status().agents) {
        write(`${agent.id.padEnd(18)}${agent.status.padEnd(13)}${agent.transport.padEnd(10)}${String(agent.pid ?? '-').padEnd(10)}${visible(agent.workspace.path)}\n`);
        if (agent.nativeState) write(`  Native ${visible(agent.nativeState.status)}; session ${visible(agent.nativeState.sessionId ?? 'not exposed')}; resume ${agent.nativeState.resumable ? 'available' : 'unavailable'}\n`);
      }
    };
    const bindTerminal = () => {
      terminal.removeListener('close', close);
      terminal.removeListener('SIGINT', close);
      terminal.on('close', close);
      terminal.on('SIGINT', close);
      terminal.on('line', line => {
        if (line.length > 65_536 || pendingControls >= 32) { write('Control input exceeds the bounded queue.\n'); return; }
        pendingControls += 1;
        commandQueue = commandQueue.then(async () => {
          if (closed || attachment) return;
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
          else if (command === ':resolve' && id && rest.length === 1) {
            const result = await session.resolveIntegration(id, rest[0]);
            reviewedTokens.delete(id);
            write(`${id}: ${result.status}. Reviewed conflict resolution recorded.\n`);
          }
          else if (command === ':quit') close();
          else write('Use a listed :control command. Native pipe input must name its agent with :send.\n');
        }).catch(error => write(`Control failed: ${visible(error.message)}\n`)).finally(() => { pendingControls -= 1; });
      });
    };
    if (terminal) { controls(); bindTerminal(); }
    const report = await session.run();
    attachment?.detach('agent processes ended');
    write(`\nProcess result: ${report.status}. This is not a correctness verdict.\n`);
    showStatus();
    for (const agent of report.agents) if (agent.result?.error) write(`${agent.id}: ${visible(agent.result.error)}\n`);
    write(`Session: ${report.sessionRoot}\nIntegration workspace: ${report.integration.path}\n`);
    if (terminal && !closed) {
      write('Agents ended. Inspect and explicitly integrate contributions, or :quit to retain all worktrees.\n');
      await terminalClosed;
    }
    await commandQueue;
    return report.status === 'succeeded' ? 0 : 1;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    closed = true;
    attachment?.detach('session ended');
    session?.stop();
    terminal?.close();
    restoreRaw();
  }
}
