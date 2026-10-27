import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface } from 'node:readline';
import { createProjectSession, validateProjectPlan, inspectProjectSession, integrateProjectSession } from '../src/index.js';

const help = `Project collaboration (ordinary pipes; no PTY or native completion verification)

  koto project start <plan.json> [--start] [--headless]
  koto project inspect <session-directory> <agent>
  koto project integrate <session-directory> <agent> --approve <review-token>

start requires explicit launch approval; --start supplies it for a prepared plan.
Each configured command runs once in its own Git worktree, with its own native permissions.
Integration writes only the separate session integration branch; it never updates main.
`;

// Prevent child output from issuing terminal controls (OSC, cursor movement, etc.).
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

/** Thin terminal consumer; orchestration, workspaces and integration live in the core. */
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
  const interactive = !headless && process.stdin.isTTY && process.stdout.isTTY;
  if ((!interactive || headless) && !approved) throw new Error('project_explicit_start_required');
  write(`Project: ${visible(plan.project)}\nGoal: ${visible(plan.goal)}\nConcurrency: ${plan.maxConcurrency}\n`);
  for (const agent of plan.agents) write(`[${agent.id}] ${visible(agent.command)} ${visible(JSON.stringify(agent.args))}\n  Task: ${visible(agent.task)}\n  Owns: ${visible(agent.owns.join(', '))}\n  Stdin: ${agent.inputMode}; unset environment: ${agent.unsetEnv.join(', ') || 'none'}\n`);
  write('Commands retain your OS permissions; worktrees are not a security sandbox. No automatic retry.\n');
  let terminal;
  if (interactive) terminal = createInterface({ input: process.stdin, output: process.stdout });
  if (!approved) {
    const stopApproval = () => terminal.close();
    signal?.addEventListener('abort', stopApproval, { once: true });
    if (signal?.aborted) terminal.close();
    const answer = await new Promise(resolve => {
      if (terminal.closed) { resolve(''); return; }
      terminal.question('Type start to launch these commands: ', resolve);
      terminal.once('close', () => resolve(''));
    });
    signal?.removeEventListener('abort', stopApproval);
    if (answer.trim() !== 'start' || signal?.aborted) { terminal.close(); return 130; }
  }
  let session;
  let closed = false;
  let commandQueue = Promise.resolve();
  let pendingControls = 0;
  let resolveClosed;
  const terminalClosed = new Promise(resolve => { resolveClosed = resolve; });
  const close = () => { if (closed) return; closed = true; session?.stop(); terminal?.close(); resolveClosed(); };
  const onAbort = () => close();
  signal?.addEventListener('abort', onAbort, { once: true });
  terminal?.on('close', close);
  terminal?.on('SIGINT', close);
  if (signal?.aborted || terminal?.closed) close();
  try {
    session = await createProjectSession(plan, { signal, onEvent(event) {
      if (event.type === 'output') write(`[${event.agentId}:${event.stream}] ${visible(event.text)}`);
      else if (event.type === 'agent_status' || event.type === 'started') {
        write(`\n[${event.agentId}] ${event.status ?? `started pid=${event.pid}`} ${event.error ?? ''}\n`);
      }
    } });
    if (closed || signal?.aborted) return 130;
    write(`Session: ${session.sessionRoot}\nIntegration workspace: ${session.status().integration.path}\n`);
    if (terminal) {
      write('Controls: :status | :send AGENT TEXT | :eof AGENT | :stop AGENT/all | :inspect AGENT | :integrate AGENT TOKEN | :quit\n');
      terminal.on('line', line => {
        if (line.length > 65_536 || pendingControls >= 32) { write('Control input exceeds the bounded queue.\n'); return; }
        pendingControls += 1;
        commandQueue = commandQueue.then(async () => {
          if (closed) return;
          const [command, id, ...rest] = line.trim().split(/\s+/);
          if (command === ':status') write(`${JSON.stringify(session.status().agents.map(agent => ({ id: agent.id, status: agent.status, pid: agent.pid, workspace: agent.workspace.path })), null, 2)}\n`);
          else if (command === ':send' && id) {
            const text = line.replace(/^\s*:send\s+\S+\s?/, '');
            write(`Input ${session.send(id, `${text}\n`) ? 'sent' : 'unavailable'} for ${id}\n`);
          } else if (command === ':eof' && id) write(`EOF ${session.endInput(id) ? 'sent' : 'unavailable'} for ${id}\n`);
          else if (command === ':stop' && id) session.stop(id);
          else if (command === ':inspect' && id) showReview(await session.inspect(id), write);
          else if (command === ':integrate' && id && rest.length === 1) write(`${JSON.stringify(await session.integrate(id, { approve: rest[0] }), null, 2)}\n`);
          else if (command === ':quit') close();
          else write('Use a listed :control command. Native input must name its agent with :send.\n');
        }).catch(error => write(`Control failed: ${visible(error.message)}\n`)).finally(() => { pendingControls -= 1; });
      });
    }
    const report = await session.run();
    write(`\nProcess result: ${report.status}. This is not a correctness verdict.\n`);
    write(`${JSON.stringify({ sessionRoot: report.sessionRoot, integration: report.integration,
      agents: report.agents.map(agent => ({ id: agent.id, status: agent.status, result: agent.result })) }, null, 2)}\n`);
    if (terminal && !closed) {
      write('Agents ended. Inspect and explicitly integrate contributions, or :quit to retain all worktrees.\n');
      await terminalClosed;
    }
    await commandQueue;
    return report.status === 'succeeded' ? 0 : 1;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    session?.stop();
    terminal?.close();
  }
}
