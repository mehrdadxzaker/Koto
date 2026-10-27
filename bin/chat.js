import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { createCodingAgentSession, createCoordinator,
  prepareProject, loadPreferences, savePreferences, defaultStateDirectory,
  discoverLocalModels, checkLocalEndpoint, pullOllamaModel,
  startLlamaServer, downloadGguf, buildLlamaRuntime, discoverAgentAccounts,
  resolveNativeAgentExecutable, readProjectSession, inspectProjectContributionAttempt } from '../src/index.js';
import { createActivityView } from './activity-view.js';
import { runProjectPlan, runProjectResume } from './project.js';
import { editBuildProposal } from './plan-editor.js';
import { chooseNativeAccount, showAccounts, chooseLocalModel } from './onboarding.js';
import { reviewSavedSession, selectResumeRequest } from './saved-session.js';
import { runNativeLogin } from './native-login.js';

const visible = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const boundedContext = value => Buffer.byteLength(value) <= 8_000 ? value
  : `${Buffer.from(value).subarray(0, 7_960).toString('utf8')}\n[Context truncated]`;
const absolute = value => path.resolve(value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);
const cancelError = () => Object.assign(new Error('Conversation closed.'), { code: 'chat_cancelled' });
const cleanupUnconfirmed = outcome => typeof outcome?.error === 'string' && /(?:^|_)cleanup_unconfirmed$/.test(outcome.error);
function requireConfirmedCleanup(outcome, resource) {
  if (cleanupUnconfirmed(outcome)) {
    throw Object.assign(new Error(`${resource} cleanup could not be confirmed. Inspect the owned process before continuing.`),
      { code: 'cleanup_unconfirmed' });
  }
}
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

  /connect                       Discover accounts or open native subscription sign-in
  /local                         Guided optional local-model setup
  /team                          Choose coding agents and models interactively
  /projects                      Choose a remembered or new project
  /review                        Review the last build and integrate approved changes
  /resume                        Continue a saved agent in its original workspace
  /forget-session                Forget the last-session shortcut; retain its files
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
  let input, coordinator, nativeSession, ownedServer, primaryFailure, quitting = false, busy = false;
  let projectControls;
  let coordinatorCleanupOutcome;
  let approvalQueue = Promise.resolve();
  const queued = [];
  const pendingBuildGoals = [];
  const persist = () => savePreferences(preferences);
  const print = text => { view.pause(); write(`${visible(text)}\n`); };
  const stop = () => { coordinator?.stop(); nativeSession?.stop(); };
  const closeCoordinator = async () => {
    const outcome = await nativeSession?.close?.();
    requireConfirmedCleanup(coordinatorCleanupOutcome ?? outcome, 'Coordinator');
  };
  const stopServer = async () => {
    const server = ownedServer;
    requireConfirmedCleanup(await server?.stop(), 'Local server');
    if (ownedServer === server) ownedServer = undefined;
  };
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
  const event = item => projectControls
    ? projectControls.onEvent(item)
    : view.update(item, { agentId: item.agentId ?? 'coordinator' });
  const selectedKind = () => preferences.coordinator?.kind ?? 'codex';
  const approve = request => {
    if (projectControls) return projectControls.onApproval(request);
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
    return resolveNativeAgentExecutable(kind, explicit ? absolute(explicit) : undefined);
  }

  async function selectCoordinator(kind, reset = false, executable, modelOverride) {
    if (!['codex', 'claude', 'local'].includes(kind)) throw new Error('Choose codex, claude or local.');
    const previous = preferences.coordinator ?? {};
    const choice = previous.kind === kind ? { ...previous } : { kind };
    let replacement, local = preferences.local;
    if (kind === 'local') {
      if (executable) throw new Error('Local agents use a loopback model; select its weights/runtime with /models.');
      if (modelOverride) {
        const found = await discoverLocalModels({ signal, llamaCommand: preferences.llamaCommand ?? 'llama-server' });
        const runtime = Object.values(found).find(item => item.reachable && item.models.some(model => model.id === modelOverride));
        if (!runtime) throw new Error('That local model is not ready. Use /models to inspect the available models.');
        local = { kind: runtime.kind, model: modelOverride, endpoint: runtime.apiBaseUrl };
      }
      if (!local?.model) throw new Error('Select an installed local model first: /models, then /add local MODEL.');
      Object.assign(choice, { model: local.model, endpoint: local.endpoint });
      const saved = preferences.localConversation;
      replacement = createCodingAgentSession({ kind, id: 'coordinator', endpoint: choice.endpoint,
        model: choice.model, cwd: process.cwd(), mode: 'conversation', onEvent: event, onApproval: approve,
        ...(!reset && saved?.model === choice.model && saved.cwd === process.cwd() ? { resumeState: saved } : {}) });
    } else {
      choice.command = await nativeExecutable(kind, executable ?? choice.command);
      choice.account = kind === 'codex' ? 'chatgpt' : 'subscription';
      if (modelOverride) choice.model = modelOverride;
      choice.model ??= kind === 'codex' ? 'gpt-6.1-sol' : 'sonnet';
      if (kind === 'codex') choice.effort ??= 'medium';
      const saved = preferences.conversation;
      replacement = createCodingAgentSession({ id: 'coordinator', kind, command: choice.command,
        model: choice.model, effort: choice.effort, account: choice.account, cwd: process.cwd(),
        mode: 'conversation', timeoutMs: 300_000, onEvent: event, onApproval: approve,
        ...(!reset && saved?.kind === kind && saved.command === choice.command && saved.model === choice.model
          && saved.cwd === process.cwd() && saved.sessionId ? { sessionId: saved.sessionId } : {}) });
    }
    // Invalid or unavailable selections leave the existing conversation usable.
    stop();
    await closeCoordinator();
    nativeSession = replacement;
    if (kind === 'local') preferences.local = local;
    if (reset) { delete preferences.conversation; delete preferences.localConversation; }
    preferences.coordinator = choice;
    const selectedSession = nativeSession;
    coordinator = createCoordinator({ session: {
      get sessionId() { return selectedSession.sessionId; },
      stop() { selectedSession.stop(); },
      async send(...args) {
        const outcome = await selectedSession.send(...args);
        // Some adapters have no close result. Retain cleanup uncertainty from
        // their turn result before the coordinator turns it into a user error.
        if (cleanupUnconfirmed(outcome)) coordinatorCleanupOutcome ??= { error: outcome.error };
        return outcome;
      },
    } });
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
      preferences.local = { kind: runtime.kind, endpoint: runtime.apiBaseUrl, model };
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

  async function saveConversation() {
    if (!nativeSession?.sessionId) return;
    if (selectedKind() === 'local') preferences.localConversation = nativeSession.snapshot();
    else preferences.conversation = { kind: selectedKind(), command: preferences.coordinator.command,
      model: preferences.coordinator.model, cwd: process.cwd(), sessionId: nativeSession.sessionId };
    await persist();
  }

  async function connectAccount() {
    const selected = await chooseNativeAccount({ preferences, ask, write: printLine, signal,
      async signIn(account) {
        view.pause(); input.close();
        try { await runNativeLogin({ account, write, signal }); }
        finally { if (!quitting && !signal?.aborted) input = makeInput(); }
      } });
    if (selected) await selectCoordinator(selected.kind, true, selected.command);
  }

  function printLine(text) { view.pause(); write(visible(text)); }

  async function localSetup() {
    let installed, suspendedLocal = false;
    try { installed = await chooseLocalModel({ preferences, ask, write: printLine, signal,
      beforeStart: async () => {
        if (selectedKind() === 'local') {
          stop(); await closeCoordinator(); coordinator = undefined; nativeSession = undefined;
          suspendedLocal = true;
        }
        await stopServer();
      },
      onProgress: item => {
        if (item.type === 'output') write(visible(item.text));
        else if (item.type === 'download') write(`\rDownloaded ${(item.bytes / 1024 ** 2).toFixed(0)} MiB`);
      } }); }
    catch (error) {
      if (suspendedLocal) print('The previous local conversation was disconnected for this model change. Retained assets are unchanged; /local can restart a model, or /connect selects a subscription. No message was replayed.');
      throw error;
    }
    if (!installed) return;
    if (installed.server) ownedServer = installed.server;
    if (installed.route === 'llama' && installed.command) preferences.llamaCommand = installed.command;
    preferences.local = { kind: installed.route, endpoint: installed.endpoint, model: installed.model };
    delete preferences.localConversation;
    await persist();
    print(`Local model selected: ${installed.model}. Download/startup does not establish coding quality.`);
    if (!coordinator || selectedKind() === 'local'
      || await ask('Use this model for the Koto conversation too? [y/N]> ') === 'y') {
      await selectCoordinator('local', true);
    }
    if (await ask('Add it as a coding worker? [Y/n]> ') !== 'n') await configureWorker('local', installed.model);
  }

  async function configureTeam() {
    while (!signal?.aborted) {
      print(`\nCoding team (${preferences.workers.length}/8):`);
      for (const worker of preferences.workers) print(`  ${worker.id}: ${worker.nativeKind} / ${worker.model}`);
      const action = await ask('Add codex, claude or local; remove ID; Enter keeps the team> ');
      if (!action || action === 'cancel') return;
      if (action.startsWith('remove ')) {
        preferences.workers = preferences.workers.filter(worker => worker.id !== action.slice(7).trim());
        await persist(); continue;
      }
      if (!['codex', 'claude', 'local'].includes(action)) { print('Choose codex, claude or local, or remove an existing agent.'); continue; }
      if (action !== 'local') {
        const accounts = await discoverAgentAccounts({ signal });
        const account = accounts.find(item => item.kind === action);
        if (account.status !== 'ready') { print(`${action} needs setup (${account.reason}). Use /connect first.`); continue; }
        const model = await ask(`Model [${action === 'codex' ? 'gpt-6.1-sol' : 'sonnet'}]> `);
        await configureWorker(action, model || undefined, account.command);
      } else {
        const found = await discoverLocalModels({ signal, llamaCommand: preferences.llamaCommand ?? 'llama-server' });
        const models = Object.values(found).flatMap(runtime => runtime.reachable ? runtime.models : []);
        if (!models.length) { await localSetup(); continue; }
        models.forEach((model, index) => print(`${index + 1}. ${model.id}`));
        const selection = await ask('Local model [number; Enter returns]> ');
        if (!selection) continue;
        if (!/^[1-9][0-9]*$/.test(selection) || !models[Number(selection) - 1]) { print('Choose a displayed model number.'); continue; }
        await configureWorker('local', models[Number(selection) - 1].id);
      }
    }
  }

  function projectTerminalOptions(onSession) {
    return { write, signal, approved: true,
      coordinatorMetadata: { id: 'coordinator', name: `Koto / ${selectedKind()}`,
        model: preferences.coordinator?.model, task: 'Coordinating the active build' },
      onSession: async session => {
        onSession(session); preferences.lastSession = session.sessionRoot;
        preferences.lastSessionProject = session.status().projectRoot; await persist();
      },
      onControls: controls => { projectControls = controls; },
      onConversationStop: () => coordinator?.stop(),
      onMessage: async (text, { session }) => {
        if (!coordinator) return { message: 'The saved agents remain controllable. Reconnect the Koto conversation with /connect after leaving this session.' };
        const state = session.status();
        const response = await coordinator.routeMessage(text, { signal,
          context: boundedContext(`An approved build is active or retained. Integration workspace: ${state.integration.path}. A new coding request must wait for the current build's review/integration; never claim unobserved completion. Actual agent states: ${JSON.stringify(state.agents.map(agent => ({
            id: agent.id, status: agent.status, model: agent.model ?? agent.native?.model, task: agent.task,
            activity: agent.activity, workspace: agent.workspace.path, result: agent.result?.error ?? agent.result?.status })))}`) });
        await saveConversation();
        if (response.action === 'build') {
          if (pendingBuildGoals.length >= 8) return { message: `${response.message}\nThe coding queue is full. Finish the current review before adding another request.` };
          pendingBuildGoals.push(response.goal);
          return { message: `${response.message}\nCoding request queued. Finish the current review and use :quit to continue with its plan.` };
        }
        return { message: response.message };
      } };
  }

  async function retainProject(sessionRoot) {
    const retained = readProjectSession(sessionRoot);
    preferences.lastSession = retained.sessionRoot;
    preferences.lastSessionProject = retained.projectRoot;
    const pending = await inspectProjectContributionAttempt(sessionRoot);
    const cleanupUnknown = retained.agents.some(agent => [agent.result, agent.commandOutcome,
      ...(agent.attempts ?? []).flatMap(attempt => [attempt.result, attempt.commandOutcome])].some(cleanupUnconfirmed));
    if (pending) print('The last integration attempt needs review. Use /review before continuing this project.');
    if (cleanupUnknown) print('A previous agent cleanup is unconfirmed. Retained work is available for inspection; do not replay it automatically.');
    if (!pending && !cleanupUnknown && !retained.active
      && retained.agents.some(agent => agent.integration?.status === 'integrated')
      && !retained.agents.some(agent => agent.integration?.status === 'conflicts')) {
      const integrated = await prepareProject({ directory: retained.integration.path });
      preferences.project = integrated.projectRoot;
      print(`Further coding continues from the reviewed integration workspace: ${integrated.projectRoot}`);
    }
    await persist();
  }

  async function resumeSaved() {
    const request = await selectResumeRequest({ sessionRoot: preferences.lastSession, ask, write: printLine, signal });
    if (!request) return;
    view.pause(); input.close();
    try {
      await runProjectResume(request.sessionRoot, request.agentId, {
        ...projectTerminalOptions(() => {}), prompt: request.prompt });
    } finally {
      projectControls = undefined;
      if (!quitting && !signal?.aborted) input = makeInput();
      await retainProject(request.sessionRoot);
    }
  }

  async function chooseProject(requested, create = false) {
    if (!requested) {
      const projects = [...new Set([preferences.project, ...(preferences.projects ?? [])].filter(Boolean))];
      projects.forEach((project, index) => print(`${index + 1}. ${project}`));
      print('Choose a Git project for this build, or enter new PATH to create an empty project. Enter cancel to keep chatting.');
      requested = await ask(`Project${preferences.project ? ` [${visible(preferences.project)}]` : ''}> `);
      requested ||= preferences.project;
      if (!requested || requested === 'cancel') return undefined;
      if (/^[1-9][0-9]*$/.test(requested) && projects[Number(requested) - 1]) requested = projects[Number(requested) - 1];
      if (requested.startsWith('new ')) { create = true; requested = words(requested.slice(4)).join(' '); }
    }
    if (create) {
      const answer = await ask(`Create an empty Git project at ${visible(absolute(requested))}? Type create: `);
      if (answer !== 'create') { print('Project creation cancelled.'); return undefined; }
    }
    const selected = await prepareProject({ directory: requested, create, approveCreate: create });
    preferences.project = selected.projectRoot;
    preferences.projects = [...new Set([selected.projectRoot, ...(preferences.projects ?? [])])].slice(0, 12);
    await persist();
    print(`Project: ${selected.projectRoot}`);
    return selected;
  }

  async function build(goal) {
    if (!coordinator) throw new Error('Choose a configured coordinator with /agent codex, /agent claude or /agent local.');
    let project;
    try { if (preferences.project) project = await prepareProject({ directory: preferences.project }); }
    catch (error) { print(error.message); }
    if (!preferences.project) {
      try {
        project = await prepareProject({ directory: process.cwd() });
        preferences.project = project.projectRoot; await persist();
        print(`Using the current Git project: ${project.projectRoot}`);
      } catch { /* A project is selected or created only for actual coding. */ }
    }
    while (!project) {
      try { project = await chooseProject(); if (!project) return; }
      catch (error) { print(error.message); }
    }
    if (preferences.lastSession) {
      let previous;
      try { previous = readProjectSession(preferences.lastSession); }
      catch (error) {
        print(`The last-session shortcut is unavailable: ${error.message}. Restore its directory or use /forget-session; that command retains all files.`);
        if (!preferences.lastSessionProject || preferences.lastSessionProject === project.projectRoot) {
          throw new Error('Resolve the unavailable saved-session shortcut before a new build here. No old request was replayed.');
        }
        print('The selected project differs from the recorded project. Continuing with a new reviewed plan.');
      }
      if (previous && [previous.projectRoot, previous.integration.path].includes(project.projectRoot)) {
        if (await inspectProjectContributionAttempt(preferences.lastSession)) throw new Error('The previous integration needs reconciliation. Use /review before starting another build in this project.');
        if (previous.active || previous.agents.some(agent => ['pending', 'running'].includes(agent.status))) throw new Error('The previous session has not settled. Return to its owning process; no work was replayed.');
        if (previous.agents.some(agent => [agent.result, agent.commandOutcome,
          ...(agent.attempts ?? []).flatMap(attempt => [attempt.result, attempt.commandOutcome])].some(cleanupUnconfirmed))) throw new Error('The previous agent cleanup is unconfirmed. Inspect retained work before launching another build in this project.');
      }
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
      await saveConversation();
    } finally { busy = false; view.pause(); }
    proposal = await editBuildProposal({ proposal, revise: (source, changes) => coordinator.revise(source, changes),
      ask, write: printLine });
    if (!proposal) { print('Build cancelled; no worker was started.'); return; }
    if (await ask('Type build to launch these real agents: ') !== 'build') { print('Build cancelled; the conversation is retained.'); return; }
    view.pause(); input.close();
    let runningSession;
    try {
      await runProjectPlan(proposal.plan, { ...projectTerminalOptions(session => { runningSession = session; }),
        expectedBaseCommit: proposal.project.baseCommit });
    } finally {
      projectControls = undefined;
      if (!quitting && !signal?.aborted) input = makeInput();
      if (runningSession) await retainProject(runningSession.sessionRoot);
    }
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
      preferences.local = { kind: 'ollama', endpoint: installed.apiBaseUrl, model: installed.id };
      delete preferences.localConversation;
      await persist();
      if (selectedKind() === 'local') await selectCoordinator('local', true);
      print(`Installed ${installed.id}. Use /add local ${installed.id}.`);
    } else if (action === 'start' && values.length === 1) {
      await stopServer();
      const modelPath = absolute(values[0]);
      const modelId = `local-${path.basename(modelPath).replace(/\.gguf$/i, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160)}`;
      ownedServer = await startLlamaServer({ modelPath, command: preferences.llamaCommand ?? 'llama-server',
        modelId, signal, onEvent: item => { if (item.type === 'output') write(visible(item.text)); } });
      await ownedServer.ready;
      preferences.local = { kind: 'llama', endpoint: ownedServer.apiBaseUrl, model: ownedServer.modelId };
      delete preferences.localConversation;
      await persist();
      if (selectedKind() === 'local') await selectCoordinator('local', true);
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
      const commands = ['codex', 'claude'].includes(preferences.coordinator?.kind)
        ? { [preferences.coordinator.kind]: preferences.coordinator.command } : {};
      const accounts = await discoverAgentAccounts({ signal, commands });
      showAccounts(accounts, printLine);
      let kind = selectedKind(), selected;
      if (kind === 'local') {
        try {
          const endpoint = preferences.local?.endpoint;
          const localKind = preferences.local?.kind ?? (endpoint && new URL(endpoint).port === '18089' ? 'llama' : 'ollama');
          const local = await checkLocalEndpoint({ kind: localKind, endpoint, signal });
          if (!local.models.some(model => model.id === preferences.local?.model)) throw new Error('The saved local model is not listed.');
        } catch {
          print('The saved local model is not running. /local reuses retained assets or selects another model.');
          kind = accounts.find(account => account.status === 'ready')?.kind;
        }
      }
      if (kind !== 'local') {
        selected = accounts.find(account => account.kind === kind && account.status === 'ready')
          ?? accounts.find(account => account.status === 'ready');
        kind = selected?.kind;
      }
      if (kind) await selectCoordinator(kind, false, selected?.command);
      else print('Use /connect to set up your existing subscription, or /local for optional open-source models.');
      if (preferences.project) print(`Remembered project: ${preferences.project}. /projects changes it.`);
      if (preferences.lastSession) print('Your last build is retained. /review inspects its changes; /resume continues a recorded agent.');
      print('Optional: /local adds a local model; /team chooses agents before your next build.');
    } catch (error) { print(`Coordinator unavailable: ${error.message}\n/connect checks native accounts; /local guides local setup. Your projects and retained work are unchanged.`); }
    while (!quitting && !signal?.aborted && !input.closed) {
      if (pendingBuildGoals.length) {
        try { await build(pendingBuildGoals.shift()); }
        catch (error) { print(`Koto: ${error.message}`); }
        continue;
      }
      const message = queued.shift() ?? await ask('You> ');
      if (!message) continue;
      try {
        if (message.startsWith('/')) {
          if (message.startsWith('/build ')) { await build(message.slice(7).trim()); continue; }
          const [command, ...args] = words(message);
          if (command === '/quit' || command === '/exit') break;
          if (command === '/help') print(help);
          else if (command === '/stop') stop();
          else if (command === '/connect' && !args.length) await connectAccount();
          else if (command === '/local' && !args.length) await localSetup();
          else if (command === '/team' && !args.length) await configureTeam();
          else if (command === '/projects' && !args.length) await chooseProject();
          else if (command === '/review' && !args.length) {
            const result = await reviewSavedSession({ sessionRoot: preferences.lastSession, ask, write: printLine, signal });
            if (result) await retainProject(result.sessionRoot);
          }
          else if (command === '/resume' && !args.length) await resumeSaved();
          else if (command === '/forget-session' && !args.length) {
            if (await ask('Forget only the saved shortcut? All session files and edits stay on disk. Type forget> ') === 'forget') {
              delete preferences.lastSession; delete preferences.lastSessionProject;
              await persist(); print('Last-session shortcut forgotten.');
            }
          }
          else if (command === '/agent' && args.length >= 1 && args.length <= 2) await selectCoordinator(args[0], true, args[1]);
          else if (command === '/model' && args.length === 1) {
            await selectCoordinator(selectedKind(), true, undefined, args[0]);
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
        if (!coordinator) throw new Error('No coordinator is connected yet. /connect discovers native subscription accounts; /local guides optional local-model setup.');
        busy = true; view.resume();
        let result;
        try {
          result = await coordinator.routeMessage(message, { signal,
            context: `Current project: ${preferences.project ?? 'none selected; project selection is only needed for coding'}. Configured coding agents: ${preferences.workers.map(worker => `${worker.id} (${worker.nativeKind}/${worker.model})`).join(', ') || 'none; can default to two instances of the coordinator'}.` });
        } finally { busy = false; view.pause(); }
        print(`\nKoto> ${result.message}\n`);
        await saveConversation();
        if (result.action === 'build') await build(result.goal);
      } catch (error) { view.pause(); print(`Koto: ${error.message}`); }
    }
    return signal?.aborted || quitting ? 130 : 0;
  } catch (error) {
    if (error.code === 'chat_cancelled' || signal?.aborted) return 130;
    primaryFailure = error;
    throw error;
  } finally {
    let cleanupFailure;
    for (const cleanup of [stop, () => input.close(), () => view.dispose(), closeCoordinator, stopServer]) {
      try { await cleanup(); }
      catch (error) { cleanupFailure ??= error; }
    }
    if (cleanupFailure) {
      if (!primaryFailure) throw cleanupFailure;
      // Preserve the original failure while still making failed cleanup visible.
      try { write(`Koto: ${visible(cleanupFailure.message)}\n`); } catch { /* Keep the original failure. */ }
    }
  }
}
