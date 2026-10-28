import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { createAgentProfile, AGENT_PROFILE_DEFAULTS, inspectLaunchProject,
  resolveAgentExecutable, inspectProjectSession, integrateProjectSession,
  buildTerminalHelper, resolveTerminalHelper, defaultStateDirectory } from '../src/index.js';
import { runProjectPlan, runProjectResume } from './project.js';

const visible = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const cancelled = () => Object.assign(new Error('Launcher closed.'), { code: 'launch_cancelled' });
const helperDirectory = () => path.join(defaultStateDirectory, 'native');

function prompts(write, signal) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  let pending;
  const abort = () => terminal.close();
  terminal.on('SIGINT', abort);
  terminal.on('close', () => { closed = true; pending?.reject(cancelled()); pending = undefined; });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const ask = async (label, fallback, required = false) => {
    for (;;) {
      if (closed) throw cancelled();
      const answer = await new Promise((resolve, reject) => {
        pending = { reject };
        terminal.question(`${label}${fallback === undefined ? '' : ` [${visible(fallback)}]`}: `, answer => {
          pending = undefined;
          resolve(answer.trim());
        });
      });
      if (Buffer.byteLength(answer) > 65_536 || answer.includes('\0')) {
        write('Input is too long or contains a null byte. Try again.\n');
        continue;
      }
      const value = answer || fallback || '';
      if (required && !value) { write('Enter a value to continue.\n'); continue; }
      return value;
    }
  };
  return { ask, close() { signal?.removeEventListener('abort', abort); terminal.close(); } };
}

async function choice(ui, write, label, entries, fallback = '1') {
  for (const [key, text] of entries) write(`  ${key}. ${text}\n`);
  for (;;) {
    const answer = await ui.ask(label, fallback);
    if (entries.some(([key]) => key === answer)) return answer;
    write('Choose one of the listed numbers.\n');
  }
}

async function integer(ui, write, label, fallback, minimum, maximum) {
  for (;;) {
    const answer = Number(await ui.ask(label, String(fallback)));
    if (Number.isInteger(answer) && answer >= minimum && answer <= maximum) return answer;
    write(`Enter a whole number from ${minimum} to ${maximum}.\n`);
  }
}

async function executable(ui, write, kind) {
  let suggestion = kind;
  try { suggestion = await resolveAgentExecutable(kind); } catch { /* Ask for the actual installation. */ }
  for (;;) {
    const command = await ui.ask(`${kind} executable`, suggestion, true);
    try { return await resolveAgentExecutable(command); }
    catch (error) { write(`${visible(error.message)}\n`); }
  }
}

async function terminalSetup(ui, write, { required = false } = {}) {
  const directory = await ui.ask('Terminal helper directory', helperDirectory(), true);
  try {
    const executable = await resolveTerminalHelper({ directory });
    write(`Terminal helper verified: ${visible(executable)}\n`);
    return directory;
  } catch (error) {
    write(`${visible(error.message)}\n`);
    write('Terminal setup builds the versioned helper with an already installed compiler. It does not download a toolchain or start an agent.\n');
    const answer = await choice(ui, write, 'Terminal setup', [
      ['1', 'Build the helper now using installed tools'],
      ['2', 'Return to the menu'],
    ]);
    if (answer === '2') {
      if (required) throw Object.assign(new Error('Terminal setup was left incomplete. No agent was started.'), { code: 'launch_terminal_setup_required' });
      return undefined;
    }
    const receipt = await buildTerminalHelper({ directory });
    write(`Terminal helper built: ${visible(receipt.path)}\n`);
    return directory;
  }
}

async function configureSession(ui, write) {
  let nativeHelperDirectory;
  if (process.platform === 'win32') {
    write('Windows project sessions use the native helper for owned processes, including Git inspection and structured pipe agents. Set it up before selecting the project.\n');
    nativeHelperDirectory = await terminalSetup(ui, write, { required: true });
  }
  const project = await ui.ask('Project directory', process.cwd(), true);
  write('Checking the existing Git project; no agent is running.\n');
  const inspected = await inspectLaunchProject(project, { nativeHelperDirectory });
  write(`Project: ${visible(inspected.projectRoot)}\nBase: ${inspected.baseCommit.slice(0, 12)}${inspected.branch ? ` (${visible(inspected.branch)})` : ''}\n`);
  const goal = await ui.ask('What do you want to build?', undefined, true);
  const count = await integer(ui, write, 'Number of agents', 2, 1, 8);
  const minutes = await integer(ui, write, 'Session deadline in minutes', 5, 1, 60);
  const agents = [];
  const prerequisites = {};
  for (let index = 0; index < count; index += 1) {
    write(`\nAgent ${index + 1} of ${count}\n`);
    const selected = await choice(ui, write, 'Agent', [['1', 'Codex — existing account'], ['2', 'OpenCode — configured provider/model']], index === 0 ? '1' : '2');
    const kind = selected === '1' ? 'codex' : 'opencode';
    const id = `${kind}${index + 1}`;
    const command = await executable(ui, write, kind);
    const selectedTransport = await choice(ui, write, 'Interaction', [
      ['1', 'Interactive terminal — native prompts, screen and keyboard'],
      ['2', 'Structured pipe — native lifecycle and exact session resume'],
    ]);
    const transport = selectedTransport === '1' ? 'pty' : 'pipe';
    let account = 'host';
    let model;
    let effort;
    if (kind === 'codex') {
      const selectedAccount = await choice(ui, write, 'Codex account', [['1', 'Existing ChatGPT login — no API-key fallback'], ['2', 'Existing native host configuration']], '1');
      account = selectedAccount === '1' ? 'chatgpt' : 'host';
      model = await ui.ask('Codex model', AGENT_PROFILE_DEFAULTS.codex.recommendedModel, true);
      effort = await ui.ask('Reasoning effort', AGENT_PROFILE_DEFAULTS.codex.recommendedEffort, true);
    } else {
      write('Use an existing OpenCode provider/model. Local models need their configured server already running. Koto does not install models or add a fallback provider.\n');
      model = await ui.ask('OpenCode provider/model', undefined, true);
      const runtime = await choice(ui, write, 'OpenCode runtime', [
        ['1', 'Configured local model server'],
        ['2', 'Existing native provider configuration'],
      ]);
      if (runtime === '1') {
        write('Use the existing JSON file selected by OPENCODE_CONFIG. It must declare the chosen model and loopback provider URL; Koto checks it without changing it.\n');
        const configFile = await ui.ask('Existing local JSON configuration', process.env.OPENCODE_CONFIG || undefined, true);
        const localEndpoint = await ui.ask('Configured loopback provider URL', undefined, true);
        Object.defineProperty(prerequisites, id, { value: { configFile, localEndpoint, model }, enumerable: true });
      }
    }
    const task = await ui.ask(`Task for ${id}`, count === 1 ? goal : undefined, true);
    write('Ownership uses literal project-relative files/directories, separated by commas; no glob patterns.\n');
    const owns = (await ui.ask(`Files/directories ${id} may contribute`, undefined, true)).split(',').map(value => value.trim());
    agents.push(createAgentProfile({ kind, id, command, account, model, effort, task, owns, transport,
      timeoutMs: minutes * 60_000 }));
    write(`${id} configured: ${visible(model)} via ${account === 'chatgpt' ? 'ChatGPT login' : 'native host configuration'}; ${transport === 'pty' ? 'interactive terminal' : 'structured pipe'}.\n`);
  }
  if (!nativeHelperDirectory && agents.some(agent => agent.transport === 'pty')) {
    nativeHelperDirectory = await terminalSetup(ui, write, { required: true });
  }
  return { schemaVersion: 1, project: inspected.projectRoot, goal, maxConcurrency: count,
    timeoutMs: minutes * 60_000, agents,
    ...(nativeHelperDirectory ? { nativeHelperDirectory } : {}),
    ...(Object.keys(prerequisites).length ? { prerequisites } : {}) };
}

async function resumeSavedSession(ui, write, signal) {
  const directory = await ui.ask('Saved session directory', undefined, true);
  const id = await ui.ask('Agent id', undefined, true);
  write('Resume requires the exact native session ID retained from a structured pipe run. It keeps that agent\'s workspace, executable, model and account selection.\n');
  const prompt = await ui.ask('What should this agent do next?', undefined, true);
  ui.close();
  await runProjectResume(directory, id, { prompt, write, signal });
}

async function reviewSavedSession(ui, write) {
  const directory = await ui.ask('Saved session directory', undefined, true);
  const id = await ui.ask('Agent id', undefined, true);
  const review = await inspectProjectSession(directory, id);
  write(`\n${visible(review.integrationDiff ?? review.diff)}\n`);
  if (review.contributionBaseCommit !== review.baseCommit) {
    write(`Showing changes since the last integrated snapshot ${visible(review.contributionBaseCommit)}.\n`);
  }
  if (review.outsideOwnership.length) write(`Outside declared ownership: ${review.outsideOwnership.map(visible).join(', ')}\n`);
  const answer = await ui.ask(`Type integrate to apply this exact reviewed contribution from ${id}; Enter returns`);
  if (answer !== 'integrate') return;
  const result = await integrateProjectSession(directory, id, { approve: review.reviewToken });
  write(`${id}: ${result.status}. Integration workspace: ${visible(result.integration.path)}\n`);
  if (result.conflicts?.length) write(`Conflicts: ${result.conflicts.map(visible).join(', ')}\n`);
}

/** A thin interactive consumer; scheduling/workspace/integration stay in core. */
export async function runLauncher({ write, signal, version } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    write('Koto needs an interactive terminal for guided launch. Open your terminal and run koto.\nUse koto --help for commands, or koto project start PLAN --start --headless for an inspected plan.\n');
    return 2;
  }
  while (!signal?.aborted) {
    const ui = prompts(write, signal);
    try {
      write(`\nKOTO ${visible(version ?? '')}\nRun real coding agents together in isolated project workspaces.\n\n`);
      const selected = await choice(ui, write, 'Choose', [
        ['1', 'Start an agent session'], ['2', 'Review a saved session'], ['3', 'Exit'],
        ['4', 'Resume a native agent session'], ['5', 'Set up terminal support'],
      ]);
      if (selected === '3') return 0;
      if (selected === '2') { await reviewSavedSession(ui, write); continue; }
      if (selected === '4') { await resumeSavedSession(ui, write, signal); continue; }
      if (selected === '5') { await terminalSetup(ui, write); continue; }
      const plan = await configureSession(ui, write);
      ui.close();
      // The shared terminal prints exact executable/model/task/ownership data
      // and requires launch approval. Opening the launcher spends no calls.
      await runProjectPlan(plan, { write, signal });
    } catch (error) {
      if (error.code === 'launch_cancelled' || signal?.aborted) return 130;
      write(`\nCannot continue: ${visible(error.message)}\nNo automatic retry or project cleanup was performed.\n`);
    } finally { ui.close(); }
  }
  return 130;
}
