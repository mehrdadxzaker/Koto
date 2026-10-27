import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { createCodingAgentSession, createCoordinator,
  prepareProject, loadPreferences, savePreferences, defaultStateDirectory,
  resolveAgentExecutable, discoverLocalModels, checkLocalEndpoint, pullOllamaModel,
  startLlamaServer, downloadGguf, buildLlamaRuntime } from '../src/index.js';
import { createActivityView } from './activity-view.js';
import { runProjectPlan } from './project.js';

const visible = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const absolute = value => path.resolve(value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);
const cancelError = () => Object.assign(new Error('Conversation closed.'), { code: 'chat_cancelled' });
function words(value) {
  const result = [];
  let token = '', quote, escaped = false, present = false;
  for (const character of value) {
    if (escaped) { token += character; escaped = false; present = true; }
    else if (character === '\\' && quote !== "'") escaped = true;
    else if (quote) { if (character === quote) quote = undefined; else token += character; present = true; }
    else if (["'", '"'].includes(character)) { quote = character; present = true; }
    else if (/\s/.test(character)) { if (present) result.push(token); token = ''; present = false; }
    else { token += character; present = true; }
  }
  if (quote || escaped) throw new Error('Close the quote or escape in this command.');
  if (present) result.push(token);
  return result;
}

function terminalInput({ write, signal, onInterrupt, onBusyLine }) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false, pending;
  const close = () => terminal.close();
  const interrupted = () => { onInterrupt(); close(); };
  terminal.on('SIGINT', interrupted);
  terminal.on('close', () => { closed = true; pending?.reject(cancelError()); pending = undefined; });
  terminal.on('line', line => { if (!pending) onBusyLine?.(line); });
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) close();
  return {
    get closed() { return closed; },
    ask(label, { signal: questionSignal } = {}) {
      if (closed) return Promise.reject(cancelError());
      if (questionSignal?.aborted) return Promise.reject(cancelError());
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          pending = undefined;
          questionSignal?.removeEventListener('abort', abort);
          if (error) { controller.abort(); reject(error); } else resolve(value.trim());
        };
        const abort = () => finish(cancelError());
        pending = { reject: error => finish(error) };
        questionSignal?.addEventListener('abort', abort, { once: true });
        terminal.question(label, { signal: controller.signal }, value => finish(undefined, value));
        if (questionSignal?.aborted) abort();
      });
    },
    close() { signal?.removeEventListener('abort', close); terminal.close(); },
  };
}

const help = `Talk to Koto normally. Coding requests become a reviewed multi-agent plan.

  /project PATH                  Select an existing Git project
  /new PATH                      Create an empty project after confirmation
  /agent KIND [EXECUTABLE]       Choose codex, claude or local; optional native CLI path
  /model MODEL                   Choose its model and start a new conversation
  /agents                        Show configured coding agents
  /add KIND [MODEL] [EXECUTABLE]  Add a coding agent using an existing installation
  /remove AGENT                  Remove a configured coding agent
  /build GOAL                    Plan and build with the configured agents
  /models                        List actual local runtimes/models
  /models pull MODEL             Install an Ollama model with the existing runtime
  /models start GGUF             Start the configured llama-server on loopback
  /models get URL FILE SHA256     Download GGUF weights with an exact digest
  /runtime build COMMIT           Build llama.cpp from an exact official source commit
  /stop                          Stop the active coordinator turn
  /setup                         Open advanced manual session setup
  /quit                          Stop owned work and exit
`;

/** Conversation, project selection and rendering consume the same core APIs. */
export async function runChat({ write, signal, version } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    write('Open Koto in an interactive terminal, or use koto project start PLAN --start --headless.\n');
    return 2;
  }
  const preferences = await loadPreferences();
  preferences.workers ??= [];
  const view = createActivityView({ write });
  let input, coordinator, nativeSession, ownedServer, quitting = false, busy = false;
  let approvalQueue = Promise.resolve();
  const queued = [];
  const persist = () => savePreferences(preferences);
  const print = text => { view.pause(); write(`${visible(text)}\n`); };
  const stop = () => { coordinator?.stop(); nativeSession?.stop(); };
  const makeInput = () => terminalInput({ write, signal, onInterrupt() { quitting = true; stop(); },
    onBusyLine(line) {
      if (!busy) return;
      if (line.trim() === '/stop') stop();
      else if (line.trim() === '/quit') { quitting = true; stop(); }
      else if (line.trim() && queued.length < 8 && Buffer.byteLength(line) <= 65_536) {
        queued.push(line.trim()); write(`\nQueued message ${queued.length}; /stop stops the current turn.\n`);
      }
    } });
  input = makeInput();
  const ask = async (text, options) => { view.pause(); return input.ask(text, options); };
  const event = item => view.update(item, { agentId: item.agentId ?? 'coordinator' });
  const selectedKind = () => preferences.coordinator?.kind ?? 'codex';
  const approve = request => {
    const operation = approvalQueue.then(async () => {
      if (quitting || signal?.aborted || request.signal?.aborted || input.closed) return false;
      const details = Object.fromEntries(Object.entries(request).filter(([key, value]) => key !== 'signal' && typeof value !== 'function'));
      const encoded = JSON.stringify(details, null, 2);
      if (Buffer.byteLength(encoded) > 65_536) return false;
      print(`\nAgent permission request:\n${encoded}`);
      try {
        const answer = await ask('Type approve for this action; Enter denies; /stop cancels the turn: ', { signal: request.signal });
        if (answer === '/stop') stop();
        if (answer === '/quit') { quitting = true; stop(); }
        return answer === 'approve' && !request.signal?.aborted && !signal?.aborted;
      } catch { return false; }
      finally { if (busy && !quitting && !signal?.aborted) view.resume(); }
    });
    approvalQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  async function nativeExecutable(kind, explicit) {
    if (explicit) return resolveAgentExecutable(absolute(explicit));
    try { return await resolveAgentExecutable(kind); }
    catch (original) {
      const candidates = [path.join(homedir(), '.local', 'bin', kind), '/usr/local/bin/' + kind,
        ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/' + kind,
          ...(kind === 'codex' ? ['/Applications/Codex.app/Contents/Resources/codex',
            path.join(homedir(), 'Applications/Codex.app/Contents/Resources/codex')] : [])] : [])];
      for (const candidate of candidates) { try { return await resolveAgentExecutable(candidate); } catch { /* Check known installation locations only. */ } }
      throw original;
    }
  }

  async function selectCoordinator(kind, reset = false, executable) {
    if (!['codex', 'claude', 'local'].includes(kind)) throw new Error('Choose codex, claude or local.');
    stop();
    await nativeSession?.close?.();
    const previous = preferences.coordinator ?? {};
    const choice = previous.kind === kind ? { ...previous } : { kind };
    if (kind === 'local') {
      if (!preferences.local?.model) throw new Error('Select an installed local model first: /models, then /add local MODEL.');
      Object.assign(choice, { model: preferences.local.model, endpoint: preferences.local.endpoint });
      const saved = preferences.localConversation;
      nativeSession = createCodingAgentSession({ kind, id: 'coordinator', endpoint: choice.endpoint,
        model: choice.model, cwd: process.cwd(), mode: 'conversation', onEvent: event, onApproval: approve,
        ...(!reset && saved?.model === choice.model && saved.cwd === process.cwd() ? { resumeState: saved } : {}) });
    } else {
      choice.command = await nativeExecutable(kind, executable ?? choice.command);
      choice.account = kind === 'codex' ? 'chatgpt' : 'subscription';
      choice.model ??= kind === 'codex' ? 'gpt-6.1-sol' : 'sonnet';
      if (kind === 'codex') choice.effort ??= 'medium';
      const saved = preferences.conversation;
      nativeSession = createCodingAgentSession({ id: 'coordinator', kind, command: choice.command,
        model: choice.model, effort: choice.effort, account: choice.account, cwd: process.cwd(),
        mode: 'conversation', timeoutMs: 300_000, onEvent: event, onApproval: approve,
        ...(!reset && saved?.kind === kind && saved.command === choice.command && saved.model === choice.model
          && saved.cwd === process.cwd() && saved.sessionId ? { sessionId: saved.sessionId } : {}) });
    }
    preferences.coordinator = choice;
    coordinator = createCoordinator({ session: nativeSession });
    view.register({ id: 'coordinator', name: `Koto / ${kind}`, model: choice.model, task: 'Conversation and planning' });
    await persist();
    print(`Coordinator: ${kind} / ${choice.model}. Uses ${kind === 'local' ? 'your loopback model' : 'the native subscription login'}.`);
  }

  async function configureWorker(kind, model, executable) {
    if (!['codex', 'claude', 'local'].includes(kind)) throw new Error('Choose codex, claude or local.');
    const number = preferences.workers.filter(worker => worker.nativeKind === kind).length + 1;
    const id = `${kind}-${number}`;
    if (preferences.workers.length >= 8) throw new Error('At most eight coding agents can be configured.');
    let worker;
    if (kind === 'local') {
      if (executable) throw new Error('Local agents use the selected loopback model; choose its runtime with /models instead of a native agent executable.');
      const discovery = await discoverLocalModels({ signal, llamaCommand: preferences.llamaCommand ?? 'llama-server' });
      const runtime = Object.values(discovery).find(runtime => runtime.reachable
        && runtime.models.some(item => !model || item.id === model));
      if (!runtime) throw new Error('No matching local model is ready. Use /models to inspect runtimes, then pull or start the selected model.');
      model ??= runtime.models[0].id;
      preferences.local = { endpoint: runtime.apiBaseUrl, model };
      worker = { id, command: process.execPath, args: [], nativeKind: 'local', model,
        localEndpoint: runtime.apiBaseUrl, label: `Local ${model}`, inputMode: 'closed' };
    } else {
      const command = await nativeExecutable(kind, executable ?? (preferences.coordinator?.kind === kind ? preferences.coordinator.command : undefined));
      model ??= kind === 'codex' ? 'gpt-6.1-sol' : 'sonnet';
      worker = { id, command, args: [], nativeKind: kind, model,
        account: kind === 'codex' ? 'chatgpt' : 'subscription', ...(kind === 'codex' ? { effort: 'medium' } : {}),
        inputMode: 'closed', label: kind };
    }
    // An id is never reused while another configured worker has it.
    while (preferences.workers.some(existing => existing.id === worker.id)) worker.id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
    preferences.workers.push(worker);
    await persist();
    print(`Added ${worker.id}: ${kind} / ${model}.`);
  }

  async function chooseProject(requested, create = false) {
    if (!requested) {
      print('Choose a Git project for this build, or enter new PATH to create an empty project. Enter cancel to keep chatting.');
      requested = await ask(`Project${preferences.project ? ` [${visible(preferences.project)}]` : ''}> `);
      requested ||= preferences.project;
      if (!requested || requested === 'cancel') return undefined;
      if (requested.startsWith('new ')) { create = true; requested = words(requested.slice(4)).join(' '); }
    }
    if (create) {
      const answer = await ask(`Create an empty Git project at ${visible(absolute(requested))}? Type create: `);
      if (answer !== 'create') { print('Project creation cancelled.'); return undefined; }
    }
    const selected = await prepareProject({ directory: requested, create, approveCreate: create });
    preferences.project = selected.projectRoot;
    await persist();
    print(`Project: ${selected.projectRoot}`);
    return selected;
  }

  async function build(goal) {
    if (!coordinator) throw new Error('Choose a configured coordinator with /agent codex, /agent claude or /agent local.');
    let project;
    try { if (preferences.project) project = await prepareProject({ directory: preferences.project }); }
    catch (error) { print(error.message); }
    while (!project) {
      try { project = await chooseProject(); if (!project) return; }
      catch (error) { print(error.message); }
    }
    if (!preferences.workers.length) {
      const kind = selectedKind();
      await configureWorker(kind, preferences.coordinator.model);
      await configureWorker(kind, preferences.coordinator.model);
    }
    busy = true; view.resume();
    let proposal;
    try {
      proposal = await coordinator.plan(goal, { project: project.projectRoot, workers: preferences.workers,
        signal, timeoutMs: 300_000, maxConcurrency: Math.min(3, preferences.workers.length),
        controlRoot: path.join(defaultStateDirectory, 'sessions') });
    } finally { busy = false; view.pause(); }
    print(`\nBuild plan: ${proposal.summary}`);
    for (const task of proposal.tasks) print(`${task.id} — ${task.label}${task.model ? ` / ${task.model}` : ''}\n  ${task.task}\n  Files: ${task.owns.join(', ')}${task.dependsOn.length ? `\n  After: ${task.dependsOn.join(', ')}` : ''}`);
    for (const warning of proposal.warnings) print(`Note: ${warning}`);
    if (await ask('Type build to launch these real agents: ') !== 'build') { print('Build cancelled; the conversation is retained.'); return; }
    view.pause(); input.close();
    try {
      await runProjectPlan(proposal.plan, { write, signal, approved: true,
        expectedBaseCommit: proposal.project.baseCommit });
    } finally { if (!quitting && !signal?.aborted) input = makeInput(); }
  }

  async function modelCommand(args) {
    if (!args.length) {
      const found = await discoverLocalModels({ signal, llamaCommand: preferences.llamaCommand ?? 'llama-server' });
      for (const runtime of Object.values(found)) {
        print(`${runtime.kind}: ${runtime.reachable ? 'ready' : runtime.message} (${runtime.endpoint})`);
        for (const model of runtime.models) print(`  ${model.id}${model.bytes ? ` (${(model.bytes / 1024 ** 3).toFixed(1)} GiB)` : ''}`);
      }
      return;
    }
    const [action, ...values] = args;
    if (action === 'pull' && values.length === 1) {
      print(`Installing local Ollama model ${values[0]} through its native cache.`);
      const installed = await pullOllamaModel({ model: values[0], signal,
        onProgress: event => { if (event.type === 'output') write(visible(event.text)); } });
      preferences.local = { endpoint: installed.apiBaseUrl, model: installed.id }; await persist();
      print(`Installed ${installed.id}. Use /add local ${installed.id}.`);
    } else if (action === 'start' && values.length === 1) {
      if (ownedServer) await ownedServer.stop();
      ownedServer = await startLlamaServer({ modelPath: absolute(values[0]), command: preferences.llamaCommand ?? 'llama-server',
        modelId: 'koto-local', signal, onEvent: item => { if (item.type === 'output') write(visible(item.text)); } });
      await ownedServer.ready;
      preferences.local = { endpoint: ownedServer.apiBaseUrl, model: ownedServer.modelId }; await persist();
      print(`Local model ready at ${ownedServer.endpoint}. Use /add local ${ownedServer.modelId}.`);
    } else if (action === 'get' && values.length === 3) {
      const result = await downloadGguf({ url: values[0], destination: absolute(values[1]), sha256: values[2],
        maxBytes: 20 * 1024 ** 3, signal, onProgress: item => write(`\rDownloaded ${(item.bytes / 1024 ** 2).toFixed(0)} MiB`) });
      print(`\nVerified model weights: ${result.path}.`);
    } else throw new Error('Use /models, /models pull MODEL, /models start GGUF, or /models get URL FILE SHA256.');
  }

  try {
    print(`\nKOTO ${version}\nYour coding agents, working together. Type a message or a coding goal.\n/help lists controls. /stop interrupts an active turn.\n`);
    try {
      let kind = selectedKind();
      if (!preferences.coordinator) {
        try { await nativeExecutable('codex'); kind = 'codex'; }
        catch { try { await nativeExecutable('claude'); kind = 'claude'; } catch { kind = 'codex'; } }
      }
      await selectCoordinator(kind);
    } catch (error) { print(`Coordinator unavailable: ${error.message}\nInstall/log in to the selected native CLI, then choose it with /agent. You can still configure projects and models.`); }
    while (!quitting && !signal?.aborted && !input.closed) {
      const message = queued.shift() ?? await ask('You> ');
      if (!message) continue;
      try {
        if (message.startsWith('/')) {
          const [command, ...args] = words(message);
          if (command === '/quit' || command === '/exit') break;
          if (command === '/help') print(help);
          else if (command === '/stop') stop();
          else if (command === '/agent' && args.length >= 1 && args.length <= 2) await selectCoordinator(args[0], true, args[1]);
          else if (command === '/model' && args.length === 1) {
            preferences.coordinator ??= { kind: 'codex' };
            preferences.coordinator.model = args[0]; delete preferences.conversation;
            await selectCoordinator(selectedKind(), true);
          } else if (command === '/agents') {
            print(`Coordinator: ${selectedKind()} / ${preferences.coordinator?.model ?? 'unavailable'}`);
            if (!preferences.workers.length) print('No coding workers selected yet. A build defaults to two instances of the coordinator; /add selects other agents/models.');
            for (const worker of preferences.workers) print(`${worker.id}: ${worker.nativeKind} / ${worker.model}`);
          } else if (command === '/add' && args.length >= 1 && args.length <= 3) await configureWorker(args[0], args[1], args[2]);
          else if (command === '/remove' && args.length === 1) {
            preferences.workers = preferences.workers.filter(worker => worker.id !== args[0]); await persist();
          } else if (command === '/project') await chooseProject(args.join(' '));
          else if (command === '/new' && args.length) await chooseProject(args.join(' '), true);
          else if (command === '/models') await modelCommand(args);
          else if (command === '/runtime' && args[0] === 'build' && args.length === 2) {
            const result = await buildLlamaRuntime({ commit: args[1], installDirectory: path.join(defaultStateDirectory, 'runtimes'), approveBuild: true,
              signal, onEvent: item => { if (item.type === 'output') write(visible(item.text)); } });
            preferences.llamaCommand = result.path; await persist(); print(`Built llama-server: ${result.path}`);
          } else if (command === '/build' && args.length) await build(args.join(' '));
          else if (command === '/setup') {
            input.close();
            try { await (await import('./launcher.js')).runLauncher({ write, signal, version }); }
            finally { input = makeInput(); }
          } else print('Unknown or incomplete command. /help lists controls. Ordinary messages do not need a slash.');
          continue;
        }
        if (!coordinator) throw new Error('Choose an installed, logged-in coordinator with /agent codex or /agent claude, or configure a local model.');
        busy = true; view.resume();
        let result;
        try {
          result = await coordinator.routeMessage(message, { signal,
            context: `Current project: ${preferences.project ?? 'none selected; project selection is only needed for coding'}. Configured coding agents: ${preferences.workers.map(worker => `${worker.id} (${worker.nativeKind}/${worker.model})`).join(', ') || 'none; can default to two instances of the coordinator'}.` });
        } finally { busy = false; view.pause(); }
        print(`\nKoto> ${result.message}\n`);
        if (nativeSession.sessionId && selectedKind() !== 'local') {
          preferences.conversation = { kind: selectedKind(), command: preferences.coordinator.command,
            model: preferences.coordinator.model, cwd: process.cwd(), sessionId: nativeSession.sessionId };
          await persist();
        }
        if (selectedKind() === 'local' && nativeSession.snapshot) {
          preferences.localConversation = nativeSession.snapshot();
          await persist();
        }
        if (result.action === 'build') await build(result.goal);
      } catch (error) { view.pause(); print(`Koto: ${error.message}`); }
    }
    return signal?.aborted || quitting ? 130 : 0;
  } catch (error) {
    if (error.code === 'chat_cancelled' || signal?.aborted) return 130;
    throw error;
  } finally {
    stop(); input.close(); view.dispose();
    await nativeSession?.close?.();
    if (ownedServer) await ownedServer.stop();
  }
}
