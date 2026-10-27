import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { createCodingAgentSession, createCoordinator,
  prepareProject, loadPreferences, savePreferences, archivePreferences, defaultStateDirectory,
  resolveAgentExecutable, discoverLocalModels, checkLocalEndpoint, pullOllamaModel,
  startLlamaServer, downloadGguf, buildLlamaRuntime,
  resolveTerminalHelper, buildTerminalHelper,
  discoverAgentAccounts, resolveNativeClientExecutable, getNativeLoginCommand,
  installNativeClient,
  readProjectSession, inspectProjectSession, integrateProjectSession,
  reviseBuildProposal } from '../src/index.js';
import { createActivityView } from './activity-view.js';
import { runProjectPlan, runProjectResume } from './project.js';
import { configureAccounts, configureLocalModels } from './onboarding.js';
import { startSetupCommand } from '../src/setup-command.js';
import { throwOnResourceExhaustion } from '../src/bounded-fetch.js';

const visible = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const absolute = value => path.resolve(value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);
const cancelError = () => Object.assign(new Error('Conversation closed.'), { code: 'chat_cancelled' });
const cleanupUnconfirmed = outcome => typeof outcome?.error === 'string' && /(?:^|_)cleanup_unconfirmed$/.test(outcome.error);
const blocksFurtherWork = error => /(?:cleanup_unconfirmed|socket_exhausted)$/.test(error.code ?? '');
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

  /project PATH                  Select an existing Git project
  /new PATH                      Create an empty project after confirmation
  /agent KIND [EXECUTABLE]       Choose codex, claude or local; optional native CLI path
  /model MODEL                   Choose its model and start a new conversation
  /agents                        Show configured coding agents
  /accounts                      Find subscription logins or sign in
  /add KIND [MODEL] [EXECUTABLE]  Add a coding agent using an existing installation
  /remove AGENT                  Remove a configured coding agent
  /build GOAL                    Plan and build with the configured agents
  /models                        List actual local runtimes/models
  /models add                    Choose and install an optional local model
  /models pull MODEL             Install an Ollama model with the existing runtime
  /models start GGUF             Start the configured llama-server on loopback
  /models get URL FILE SHA256     Download GGUF weights with an exact digest
  /runtime build COMMIT           Build llama.cpp from an exact official source commit
  /stop                          Stop the active coordinator turn
  /sessions                      Show this project's saved work
  /review [AGENT]                Review a saved contribution
  /integrate [AGENT]             Integrate a freshly reviewed contribution
  /resume [AGENT]                Continue a saved agent in its original workspace
  /setup                         Open advanced manual session setup
  /quit                          Stop owned work and exit
`;

/** Conversation, project selection and rendering consume the same core APIs. */
export async function runChat({ write, signal: parentSignal, version } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    write('Open Koto in an interactive terminal, or use koto project start PLAN --start --headless.\n');
    return 2;
  }
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  let preferences, preferencesError;
  try { preferences = await loadPreferences(); }
  catch (error) {
    preferencesError = error;
    preferences = { schemaVersion: 1, workers: [] };
  }
  preferences.workers ??= [];
  const view = createActivityView({ write });
  let input, coordinator, nativeSession, ownedServer, primaryFailure, quitting = false, normalQuit = false, busy = false;
  let serverFailure;
  let coordinatorCleanupOutcome;
  let approvalQueue = Promise.resolve();
  const queued = [];
  const persist = async () => {
    // Preferences cache discovery/continuation shortcuts, not the canonical
    // project-session records. Evict old shortcuts before hitting the file cap.
    if (preferences.localConversations?.length) delete preferences.localConversation;
    for (const field of ['localConversations', 'conversations', 'recentSessions']) {
      while (preferences[field]?.length > 0 && Buffer.byteLength(JSON.stringify({ ...preferences, schemaVersion: 1 }, null, 2) + '\n') > 112 * 1024) {
        preferences[field].pop();
      }
    }
    await savePreferences(preferences);
  };
  const print = text => { view.pause(); write(`${visible(text)}\n`); };
  const stop = () => { coordinator?.stop(); nativeSession?.stop(); };
  const closeCoordinator = async () => {
    const outcome = await nativeSession?.close?.();
    requireConfirmedCleanup(coordinatorCleanupOutcome ?? outcome, 'Coordinator');
  };
  const stopServer = async () => requireConfirmedCleanup(await ownedServer?.stop(), 'Local server');
  const observeOwnedServer = server => {
    const retainFatal = error => {
      if (ownedServer !== server || !blocksFurtherWork(error)) return;
      if (!serverFailure) serverFailure = error;
      else if (cleanupUnconfirmed({ error: error.code }) && !cleanupUnconfirmed({ error: serverFailure.code })) {
        error.cause ??= serverFailure;
        serverFailure = error;
      }
      quitting = true;
      for (const halt of [() => controller.abort(), stop, () => input?.close()]) {
        try { halt(); }
        catch (haltError) {
          if (cleanupUnconfirmed({ error: haltError.code }) && !cleanupUnconfirmed({ error: serverFailure.code })) {
            haltError.cause ??= serverFailure;
            serverFailure = haltError;
          } else if (haltError !== serverFailure) serverFailure.cause ??= haltError;
        }
      }
    };
    // Completion belongs to the captured server. A replaced server cannot
    // invalidate its successor, and ordinary exits keep their existing behavior.
    void server.completion.then(outcome => {
      if (ownedServer !== server) return;
      try {
        requireConfirmedCleanup(outcome, 'Local server');
        throwOnResourceExhaustion({ code: outcome?.error }, 'local_socket_exhausted');
      } catch (error) { retainFatal(error); }
    }, error => {
      if (ownedServer !== server) return;
      try { throwOnResourceExhaustion(error); }
      catch (fatal) { retainFatal(fatal); }
    }).catch(error => { retainFatal(error); });
  };
  const makeInput = () => terminalInput({ write, signal, onInterrupt() { quitting = true; controller.abort(); stop(); },
    onBusyLine(line) {
      if (!busy) return;
      if (line.trim() === '/stop') stop();
      else if (line.trim() === '/quit') { normalQuit = true; quitting = true; controller.abort(); stop(); }
      else if (line.trim() && queued.length < 8 && Buffer.byteLength(line) <= 65_536) {
        queued.push(line.trim()); write(`\nQueued message ${queued.length}; /stop stops the current turn.\n`);
      }
    } });
  input = makeInput();
  const ask = async (text, options) => {
    view.pause();
    const answer = await input.ask(text, options);
    if (['/quit', '/exit'].includes(answer)) {
      normalQuit = true; quitting = true; controller.abort(); stop();
      throw Object.assign(new Error('Koto closed.'), { code: 'chat_quit' });
    }
    return answer;
  };
  const event = item => view.update(item, { agentId: item.agentId ?? 'coordinator' });
  const selectedKind = () => preferences.coordinator?.kind ?? 'codex';
  const conversationDirectory = () => preferences.project ?? process.cwd();
  const rememberConversation = async (session, choice, cwd) => {
    if (choice.kind === 'local' && session.snapshot) {
      const snapshot = session.snapshot();
      preferences.localConversations = [snapshot,
        ...(preferences.localConversations ?? []).filter(item => item.cwd !== cwd || item.model !== choice.model)].slice(0, 12);
    } else if (session.sessionId) {
      const saved = { kind: choice.kind, command: choice.command, model: choice.model,
        cwd, sessionId: session.sessionId };
      preferences.conversation = saved;
      preferences.conversations = [saved, ...(preferences.conversations ?? []).filter(item =>
        item.cwd !== cwd || item.kind !== choice.kind)].slice(0, 12);
    }
    await persist();
  };
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
    return resolveNativeClientExecutable(kind, explicit ? absolute(explicit) : undefined);
  }

  async function selectCoordinator(kind, reset = false, executable, modelOverride) {
    if (!['codex', 'claude', 'local'].includes(kind)) throw new Error('Choose codex, claude or local.');
    const previous = preferences.coordinator ?? {};
    const choice = previous.kind === kind ? { ...previous } : { kind };
    const cwd = conversationDirectory();
    let replacement, local = preferences.local;
    if (kind === 'local') {
      if (executable) throw new Error('Local agents use a loopback model; select its weights/runtime with /models.');
      if (modelOverride) {
        const found = await discoverLocalModels({ signal, llamaCommand: preferences.llamaCommand ?? 'llama-server' });
        const runtime = Object.values(found).find(item => item.reachable && item.models.some(model => model.id === modelOverride));
        if (!runtime) throw new Error('That local model is not ready. Use /models to inspect the available models.');
        local = { model: modelOverride, endpoint: runtime.apiBaseUrl };
      }
      if (!local?.model) throw new Error('Select an installed local model first: /models, then /add local MODEL.');
      Object.assign(choice, { model: local.model, endpoint: local.endpoint });
      const saved = (preferences.localConversations ?? []).find(item => item.cwd === cwd && item.model === choice.model)
        ?? preferences.localConversation;
      replacement = createCodingAgentSession({ kind, id: 'coordinator', endpoint: choice.endpoint,
        model: choice.model, cwd, mode: 'conversation', onEvent: event, onApproval: approve,
        ...(!reset && saved?.model === choice.model && saved.cwd === cwd ? { resumeState: saved } : {}) });
    } else {
      choice.command = await nativeExecutable(kind, executable ?? choice.command);
      choice.account = kind === 'codex' ? 'chatgpt' : 'subscription';
      if (modelOverride) choice.model = modelOverride;
      if (kind === 'codex') choice.effort ??= 'medium';
      const saved = (preferences.conversations ?? []).find(item => item.cwd === cwd && item.kind === kind)
        ?? preferences.conversation;
      replacement = createCodingAgentSession({ id: 'coordinator', kind, command: choice.command,
        model: choice.model, effort: choice.effort, account: choice.account, cwd,
        mode: 'conversation', timeoutMs: 300_000, onEvent: event, onApproval: approve,
        ...(!reset && saved?.kind === kind && saved.command === choice.command && saved.model === choice.model
          && saved.cwd === cwd && saved.sessionId ? { sessionId: saved.sessionId } : {}) });
    }
    // Invalid or unavailable selections leave the existing conversation usable.
    stop();
    await closeCoordinator();
    nativeSession = replacement;
    if (kind === 'local') preferences.local = local;
    if (reset) {
      delete preferences.conversation; delete preferences.localConversation;
      preferences.conversations = (preferences.conversations ?? []).filter(item => item.cwd !== cwd || item.kind !== kind);
      preferences.localConversations = (preferences.localConversations ?? []).filter(item => item.cwd !== cwd || item.model !== choice.model);
    }
    preferences.coordinator = choice;
    if (kind !== 'local') preferences.nativeCommands = { ...preferences.nativeCommands, [kind]: choice.command };
    const selectedSession = nativeSession;
    coordinator = createCoordinator({ session: {
      get sessionId() { return selectedSession.sessionId; },
      stop() { selectedSession.stop(); },
      async send(...args) {
        const outcome = await selectedSession.send(...args);
        // Some adapters have no close result. Retain cleanup uncertainty from
        // their turn result before the coordinator turns it into a user error.
        if (cleanupUnconfirmed(outcome)) coordinatorCleanupOutcome ??= { error: outcome.error };
        await rememberConversation(selectedSession, choice, cwd);
        return outcome;
      },
    } });
    view.register({ id: 'coordinator', name: `Koto / ${kind}`, model: choice.model, task: 'Conversation and planning' });
    await persist();
    print(`Coordinator: ${kind} / ${choice.model ?? 'native default model'}. Uses ${kind === 'local' ? 'your loopback model' : kind === 'codex' ? 'your ChatGPT login through Codex' : 'your Claude login through Claude Code'}.`);
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
      model ??= preferences.coordinator?.kind === kind ? preferences.coordinator.model : undefined;
      worker = { id, command, args: [], nativeKind: kind, model,
        account: kind === 'codex' ? 'chatgpt' : 'subscription', ...(kind === 'codex' ? { effort: 'medium' } : {}),
        inputMode: 'closed', label: kind };
    }
    // An id is never reused while another configured worker has it.
    while (preferences.workers.some(existing => existing.id === worker.id)) worker.id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
    preferences.workers.push(worker);
    await persist();
    print(`Added ${worker.id}: ${kind} / ${model ?? 'native default model'}.`);
  }

  let lastProgressAt = 0;
  const progress = item => {
    if (item.type === 'download' || item.bytes !== undefined) {
      if (Date.now() - lastProgressAt < 250 && item.bytes !== item.totalBytes) return;
      lastProgressAt = Date.now();
      const percent = item.totalBytes ? ` / ${(item.totalBytes / 1024 ** 2).toFixed(0)} MiB` : '';
      write(`\rDownloading ${(item.bytes / 1024 ** 2).toFixed(0)} MiB${percent}   `);
    } else if (item.type === 'output') write(visible(item.text));
  };

  async function openNativeLogin(account) {
    const descriptor = await getNativeLoginCommand(account);
    print(`Opening ${account.label}'s native sign-in. Follow its browser or terminal instructions.`);
    input.close();
    let handle;
    const forward = chunk => {
      if (!handle?.send(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))) handle?.stop();
    };
    const ended = () => handle?.endInput();
    try {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)
        && !descriptor.unsetEnv.some(name => name.toUpperCase() === key.toUpperCase())));
      Object.assign(env, { DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' });
      handle = await startSetupCommand({ id: 'nativeLogin', command: descriptor.command,
        args: descriptor.args, cwd: homedir(), env, timeoutMs: descriptor.timeoutMs, signal,
        onEvent: item => { if (item.type === 'output') write(item.text); } });
      process.stdin.on('data', forward);
      process.stdin.once('end', ended);
      process.stdin.resume();
      const outcome = await handle.completion;
      requireConfirmedCleanup(outcome, 'Native sign-in');
      throwOnResourceExhaustion({ code: outcome.error }, 'native_login_socket_exhausted');
      if (outcome.status !== 'succeeded') print('Sign-in did not finish. Use /accounts to try the native sign-in again.');
    } finally {
      process.stdin.removeListener('data', forward);
      process.stdin.removeListener('end', ended);
      if (handle) { handle.stop(); requireConfirmedCleanup(await handle.completion, 'Native sign-in'); }
      if (!quitting && !signal?.aborted) input = makeInput();
    }
  }

  async function accountSetup() {
    const account = await configureAccounts({ ask, print, preferences, signal, login: openNativeLogin,
      async installClient(kind) {
        const installed = await installNativeClient({ kind, directory: path.join(defaultStateDirectory, 'clients'), signal, onProgress: progress });
        preferences.nativeCommands = { ...preferences.nativeCommands, [kind]: installed.command };
        await persist();
      } });
    if (account) {
      preferences.nativeCommands = { ...preferences.nativeCommands, [account.kind]: account.command };
      await selectCoordinator(account.kind, false, account.command);
    }
    return account;
  }

  async function startSavedLocal() {
    const saved = preferences.localInstall;
    if (!saved) return;
    const adopt = async endpoint => {
      preferences.local = { endpoint, model: saved.id };
      for (const worker of preferences.workers) if (worker.nativeKind === 'local') {
        worker.model = saved.id;
        worker.localEndpoint = endpoint;
      }
      await persist();
    };
    // A running endpoint is reused only when it advertises the selected alias.
    try {
      const ready = await checkLocalEndpoint({ kind: 'llama', endpoint: preferences.local?.endpoint, signal });
      if (ready.models.some(item => item.id === saved.id)) { await adopt(ready.apiBaseUrl); return; }
    } catch (error) {
      if (blocksFurtherWork(error) || signal.aborted) throw error;
      // Start only our selected runtime/model, never stop another listener.
    }
    await stopServer();
    print(`Starting local model ${saved.label ?? saved.id}…`);
    let startupTail = '', collectingStartup = true;
    try {
      ownedServer = await startLlamaServer({ modelPath: saved.modelPath, command: saved.command,
        modelId: saved.id, port: 18089, contextSize: saved.contextSize ?? 8192, signal,
        onEvent: item => {
          if (collectingStartup && item.type === 'output') startupTail = Buffer.from(startupTail + item.text).subarray(-8192).toString('utf8');
        } });
      await ownedServer.ready;
      observeOwnedServer(ownedServer);
    } catch (error) {
      let startupFailure = error;
      try { await stopServer(); }
      catch (cleanupError) { cleanupError.cause ??= error; startupFailure = cleanupError; }
      if (startupTail) {
        const directory = path.join(defaultStateDirectory, 'logs');
        const filename = path.join(directory, `local-startup-${randomUUID()}.log`);
        try {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const info = await lstat(directory);
          if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory
            || process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || process.getuid && info.uid !== process.getuid())) {
            throw new Error('Native startup logs need a protected Koto directory.');
          }
          await writeFile(filename, startupTail, { mode: 0o600, flag: 'wx' });
          startupFailure.message += ` Native startup details were preserved at ${filename}.`;
        } catch { /* Preserve the original failure and cleanup outcome. */ }
      }
      throw startupFailure;
    } finally { collectingStartup = false; }
    startupTail = '';
    await adopt(ownedServer.apiBaseUrl);
    if (serverFailure) throw serverFailure;
    print(`Local model loaded: ${saved.label ?? saved.id}.`);
  }

  async function localSetup() {
    const installed = await configureLocalModels({ ask, print, signal, onProgress: progress });
    if (!installed) return false;
    const selected = { id: installed.id, label: installed.model?.label,
      contextSize: installed.model?.contextSize,
      modelPath: installed.modelPath ?? installed.path, command: installed.command };
    preferences.localInstalls = [selected, ...(preferences.localInstalls ?? []).filter(item => item.id !== selected.id)];
    await persist();
    if (preferences.localInstall && preferences.localInstall.id !== selected.id
      && ['n', 'no'].includes((await ask('Use this model for new local work? [Y/n]: ')).toLowerCase())) {
      print('Model downloaded and retained. /models use MODEL_ID selects it later.'); return true;
    }
    await useLocalModel(selected);
    return true;
  }

  async function useLocalModel(selected) {
    preferences.localInstall = selected;
    const installed = selected;
    preferences.llamaCommand = installed.command;
    await persist();
    await startSavedLocal();
    // One managed server is active at a time. Retain downloaded choices while
    // rebinding local workers to the explicitly selected active model.
    for (const worker of preferences.workers) if (worker.nativeKind === 'local') {
      worker.model = selected.id; worker.localEndpoint = preferences.local.endpoint;
    }
    if (!preferences.workers.some(worker => worker.nativeKind === 'local' && worker.model === installed.id)) {
      await configureWorker('local', installed.id);
    }
    if (!coordinator) await selectCoordinator('local');
    else if (selectedKind() === 'local') await selectCoordinator('local', true);
    await persist();
  }

  const rememberProjectSession = async state => {
    const entry = { directory: state.sessionRoot, project: state.projectRoot,
      goal: String(state.goal ?? '').slice(0, 256), savedAt: new Date().toISOString() };
    preferences.recentSessions = [entry, ...(preferences.recentSessions ?? []).filter(item => item.directory !== entry.directory)].slice(0, 20);
    preferences.selectedSession = entry.directory;
    await persist();
  };

  async function savedWork(action, requestedId) {
    const candidates = (preferences.recentSessions ?? []).filter(item => !preferences.project || item.project === preferences.project);
    if (!candidates.length) { print('No saved build for this project yet. Describe what you want to build.'); return; }
    let saved = candidates.find(item => item.directory === preferences.selectedSession) ?? candidates[0];
    if (action === 'sessions' && candidates.length > 1) {
      for (const [index, item] of candidates.entries()) print(`  ${index + 1}. ${item.goal ?? 'Saved build'} (${item.savedAt})`);
      const answer = requestedId ?? await ask('Choose saved build [1], or cancel: ');
      if (answer === 'cancel') return;
      saved = candidates[Number(answer || '1') - 1];
      if (!saved) throw new Error('Choose a listed saved build number.');
      preferences.selectedSession = saved.directory;
      await persist();
    }
    const state = readProjectSession(saved.directory);
    if (action === 'sessions') {
      print(`Saved project: ${state.projectRoot}\nGoal: ${state.goal}`);
      for (const agent of state.agents) print(`  ${agent.id}: ${agent.status}${agent.integration ? `; integration ${agent.integration.status}` : ''}`);
      print('Use /review, /integrate or /resume. Koto remembers the workspace.');
      return;
    }
    let id = requestedId;
    if (!id) {
      for (const [index, agent] of state.agents.entries()) print(`  ${index + 1}. ${agent.id} — ${agent.status}`);
      const answer = await ask(`Choose agent [1], or cancel: `);
      if (answer === 'cancel') return;
      id = state.agents[Number(answer || '1') - 1]?.id;
    }
    if (!state.agents.some(agent => agent.id === id)) throw new Error('Choose a listed saved agent.');
    if (action === 'resume') {
      const prompt = await ask(`What should ${id} do next? `);
      if (!prompt) return;
      input.close();
      try { await runProjectResume(saved.directory, id, { prompt, write, signal }); }
      finally { if (!quitting && !signal?.aborted) input = makeInput(); }
      return;
    }
    const review = await inspectProjectSession(saved.directory, id);
    print(`Changes from ${id}:\n${review.integrationDiff ?? review.diff}`);
    if (review.outsideOwnership.length) print(`Outside planned ownership: ${review.outsideOwnership.join(', ')}`);
    if (action !== 'integrate') { print(`Use /integrate ${id} to review and accept these changes.`); return; }
    if (await ask(`Type integrate to accept this displayed contribution from ${id}: `) !== 'integrate') return;
    const result = await integrateProjectSession(saved.directory, id, { approve: review.reviewToken });
    print(`${id}: ${result.status}. Reviewed result: ${result.integration.path}`);
  }

  async function chooseProject(requested, create = false) {
    if (!requested) {
      print('Choose a project folder, or enter new PATH to create one. Enter later to keep chatting.');
      const fallback = preferences.project ?? process.cwd();
      requested = await ask(`Project [${visible(fallback)}]> `);
      requested ||= fallback;
      if (!requested || ['cancel', 'later'].includes(requested)) return undefined;
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
    if (coordinator) await selectCoordinator(selectedKind());
    return selected;
  }

  async function build(goal) {
    if (!coordinator) throw new Error('Choose a configured coordinator with /agent codex, /agent claude or /agent local.');
    let project;
    try { if (preferences.project) project = await prepareProject({ directory: preferences.project }); }
    catch (error) { print(error.message); }
    while (!project) {
      try { project = await chooseProject(); if (!project) return; }
      catch (error) { if (['chat_quit', 'chat_cancelled'].includes(error.code) || signal?.aborted) throw error; print(error.message); }
    }
    if (preferences.localInstall && (selectedKind() === 'local'
      || preferences.workers.some(worker => worker.nativeKind === 'local'))) await startSavedLocal();
    if (!preferences.workers.some(worker => worker.nativeKind === selectedKind())) {
      await configureWorker(selectedKind(), preferences.coordinator.model);
    }
    if (preferences.workers.length === 1) {
      const kind = selectedKind();
      await configureWorker(kind, preferences.coordinator.model);
    }
    busy = true; view.resume();
    let proposal;
    try {
      proposal = await coordinator.plan(goal, { project: project.projectRoot, workers: preferences.workers,
        signal, timeoutMs: 300_000, maxConcurrency: Math.min(3, preferences.workers.length),
        controlRoot: path.join(defaultStateDirectory, 'sessions') });
    } finally { busy = false; view.pause(); }
    const planWorkers = preferences.workers.map(worker => ({ ...worker }));
    for (;;) {
      print(`\nBuild plan: ${proposal.summary}`);
      for (const [index, task] of proposal.tasks.entries()) print(`${index + 1}. ${task.id} — ${task.label}${task.model ? ` / ${task.model}` : ' / native default model'}\n  ${task.task}\n  Files: ${task.owns.join(', ')}${task.dependsOn.length ? `\n  After: ${task.dependsOn.join(', ')}` : ''}`);
      for (const warning of proposal.warnings) print(`Note: ${warning}`);
      const decision = await ask('Type build to launch, edit to change the plan, or Enter to cancel: ');
      if (decision === 'build') break;
      if (decision !== 'edit') { print('Build cancelled; the conversation is retained.'); return; }
      try {
        const tasks = proposal.tasks.map(task => ({ id: task.id, worker: task.worker,
          task: task.task, owns: [...task.owns], dependsOn: [...task.dependsOn] }));
        const selected = await ask('Task number to edit, or remove NUMBER: ');
        const removing = selected.startsWith('remove ');
        const number = Number(removing ? selected.slice(7) : selected);
        if (!Number.isInteger(number) || number < 1 || number > tasks.length) {
          print('Choose one of the displayed task numbers.'); continue;
        }
        if (removing) tasks.splice(number - 1, 1);
        else {
          const task = tasks[number - 1];
          for (const [index, worker] of planWorkers.entries()) print(`  ${index + 1}. ${worker.id} — ${worker.nativeKind} / ${worker.model ?? 'native default model'}`);
          const current = planWorkers.findIndex(worker => worker.id === task.worker);
          const selection = await ask(`Agent [${current + 1}]: `);
          const workerIndex = selection ? Number(selection) - 1 : current;
          const worker = planWorkers[workerIndex];
          if (!worker) throw new Error('Choose a displayed agent number.');
          const updatedWorker = { ...worker };
          if (worker.nativeKind !== 'local') {
            const model = await ask(`Model [${worker.model ?? 'native default'}]; Enter keeps it: `);
            if (model) updatedWorker.model = model;
          }
          task.worker = worker.id;
          task.task = await ask(`Assignment [${visible(task.task)}]: `) || task.task;
          const owns = await ask(`Files/directories [${task.owns.join(', ')}]: `);
          if (owns) task.owns = owns.split(',').map(item => item.trim());
          const after = await ask(`After task IDs [${task.dependsOn.join(', ') || 'none'}]; enter none to clear: `);
          if (after) task.dependsOn = after === 'none' ? [] : after.split(',').map(item => item.trim());
          const candidateWorkers = planWorkers.map((item, index) => index === workerIndex ? updatedWorker : item);
          const revised = reviseBuildProposal(proposal, { tasks, workers: candidateWorkers });
          planWorkers[workerIndex] = updatedWorker;
          proposal = revised;
          print('Edited plan validated. Review it before launching.');
          continue;
        }
        proposal = reviseBuildProposal(proposal, { tasks, workers: planWorkers });
        print('Edited plan validated. Review it before launching.');
      } catch (error) {
        if (['chat_quit', 'chat_cancelled'].includes(error.code) || signal?.aborted) throw error;
        print(`Plan unchanged: ${error.message}`);
      }
    }
    view.pause(); input.close();
    try {
      await runProjectPlan(proposal.plan, { write, signal, approved: true,
        expectedBaseCommit: proposal.project.baseCommit, onSession: rememberProjectSession, compact: true });
    } finally { if (!quitting && !signal?.aborted) input = makeInput(); }
  }

  async function modelCommand(args) {
    if (args.length === 1 && args[0] === 'add') { await localSetup(); return; }
    if (args.length === 2 && args[0] === 'use') {
      const selected = (preferences.localInstalls ?? []).find(item => item.id === args[1]);
      if (!selected) throw new Error('Choose a downloaded model ID from /models, or use /models add.');
      await useLocalModel(selected); return;
    }
    if (!args.length) {
      for (const item of preferences.localInstalls ?? []) print(`${item.id}: ${item.label ?? item.id}${item.id === preferences.localInstall?.id ? ' (selected)' : ' (downloaded; /models use selects it)'}`);
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
      await stopServer();
      ownedServer = await startLlamaServer({ modelPath: absolute(values[0]), command: preferences.llamaCommand ?? 'llama-server',
        modelId: 'koto-local', signal, onEvent: item => { if (item.type === 'output') write(visible(item.text)); } });
      await ownedServer.ready;
      observeOwnedServer(ownedServer);
      preferences.local = { endpoint: ownedServer.apiBaseUrl, model: ownedServer.modelId }; await persist();
      if (serverFailure) throw serverFailure;
      print(`Local model loaded at ${ownedServer.endpoint}. Use /add local ${ownedServer.modelId}.`);
    } else if (action === 'get' && values.length === 3) {
      const result = await downloadGguf({ url: values[0], destination: absolute(values[1]), sha256: values[2],
        maxBytes: 20 * 1024 ** 3, signal, onProgress: item => write(`\rDownloaded ${(item.bytes / 1024 ** 2).toFixed(0)} MiB`) });
      print(`\nVerified model weights: ${result.path}.`);
    } else throw new Error('Use /models, /models pull MODEL, /models start GGUF, or /models get URL FILE SHA256.');
  }

  try {
    print(`\nKOTO ${version}\nYour coding agents, working together.\n`);
    if (process.platform === 'win32') {
      const directory = path.join(defaultStateDirectory, 'native');
      try { await resolveTerminalHelper({ directory }); }
      catch {
        print('Preparing native Windows process support with installed developer tools…');
        await buildTerminalHelper({ directory });
      }
    }
    if (preferencesError) {
      print(`Saved setup needs recovery: ${preferencesError.message}\nKoto can preserve it as a backup and start fresh. Your saved sessions and native logins stay available.`);
      if (await ask('Type reset to preserve a backup and restart setup, or Enter to quit: ') !== 'reset') return 2;
      print(`Saved setup preserved at ${await archivePreferences()}.`);
    }
    if (!preferences.onboardingComplete) {
      print('Welcome. Bring your existing subscriptions, optionally add local models, then choose a project.');
      await accountSetup();
      if (['y', 'yes'].includes((await ask('Add an optional open-source model on this computer? [y/N]: ')).toLowerCase())) {
        try { await localSetup(); }
        catch (error) {
          if (['chat_quit', 'chat_cancelled'].includes(error.code) || signal?.aborted || blocksFurtherWork(error)) throw error;
          print(`Local setup did not finish: ${error.message}\nUse /models add to retry. Your subscription setup is retained.`);
        }
      }
      for (;;) {
        try { await chooseProject(); break; }
        catch (error) { if (['chat_quit', 'chat_cancelled'].includes(error.code) || signal?.aborted) throw error; print(error.message); }
      }
      preferences.onboardingComplete = true;
      await persist();
    } else {
      print(`Welcome back.${preferences.project ? ` Project: ${preferences.project}` : ''}`);
      if (preferences.localInstall && (selectedKind() === 'local' || preferences.workers.some(worker => worker.nativeKind === 'local'))) {
        try { await startSavedLocal(); }
        catch (error) {
          if (blocksFurtherWork(error)) throw error;
          print(`Local model needs attention: ${error.message}\n/models add or /models use reconnects local work. Your subscription is still available.`);
        }
      }
      try {
        if (selectedKind() === 'local') await selectCoordinator('local');
        else {
          const accounts = await discoverAgentAccounts({ signal, commands: preferences.nativeCommands });
          const selected = accounts.find(account => account.kind === selectedKind());
          if (selected?.status === 'ready') await selectCoordinator(selected.kind, false, selected.command);
          else print(`${selected?.message ?? 'Your selected native client is unavailable.'} Use /accounts to reconnect. Your project and saved work are retained.`);
        }
      } catch (error) {
        if (blocksFurtherWork(error)) throw error;
        print(`Setup needs attention: ${error.message}\nUse /accounts or /models add to reconnect. Your project and saved work are retained.`);
      }
    }
    print('Describe what you want to build. /accounts changes subscriptions; /models add adds a local model.\n/sessions returns to saved work. /help lists all controls.');
    while (!quitting && !signal?.aborted && !input.closed) {
      const message = queued.shift() ?? await ask('You> ');
      if (!message) continue;
      try {
        if (message.startsWith('/')) {
          const [command, ...args] = words(message);
          if (command === '/quit' || command === '/exit') break;
          if (command === '/help') print(help);
          else if (command === '/stop') stop();
          else if (command === '/accounts') await accountSetup();
          else if (command === '/agent' && args.length >= 1 && args.length <= 2) await selectCoordinator(args[0], true, args[1]);
          else if (command === '/model' && args.length === 1) {
            await selectCoordinator(selectedKind(), true, undefined, args[0]);
          } else if (command === '/agents') {
            print(`Coordinator: ${selectedKind()} / ${preferences.coordinator?.model ?? 'native default model'}`);
            if (!preferences.workers.length) print('Your first build will propose agents using the selected subscription. /add selects additional agents or models.');
            for (const worker of preferences.workers) print(`${worker.id}: ${worker.nativeKind} / ${worker.model ?? 'native default model'}`);
          } else if (command === '/add' && args.length >= 1 && args.length <= 3) await configureWorker(args[0], args[1], args[2]);
          else if (command === '/remove' && args.length === 1) {
            preferences.workers = preferences.workers.filter(worker => worker.id !== args[0]); await persist();
          } else if (command === '/project') await chooseProject(args.join(' '));
          else if (command === '/new' && args.length) await chooseProject(args.join(' '), true);
          else if (command === '/models') await modelCommand(args);
          else if (['/sessions', '/review', '/integrate', '/resume'].includes(command) && args.length <= 1) await savedWork(command.slice(1), args[0]);
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
        if (result.action === 'build') await build(result.goal);
      } catch (error) {
        if (['chat_quit', 'chat_cancelled'].includes(error.code) || signal?.aborted || blocksFurtherWork(error)) throw error;
        view.pause(); print(`Koto: ${error.message}`);
      }
    }
    if (serverFailure) throw serverFailure;
    return normalQuit ? 0 : signal?.aborted || quitting ? 130 : 0;
  } catch (error) {
    const fatal = cleanupUnconfirmed({ error: error.code }) ? error
      : serverFailure ?? (blocksFurtherWork(error) ? error : undefined);
    if (fatal) {
      if (serverFailure && fatal !== serverFailure) fatal.cause ??= serverFailure;
      primaryFailure = fatal;
      throw fatal;
    }
    if (error.code === 'chat_quit' || normalQuit) return 0;
    if (error.code === 'chat_cancelled' || signal?.aborted) return 130;
    primaryFailure = error;
    throw error;
  } finally {
    let cleanupFailure;
    for (const cleanup of [() => controller.abort(), stop, () => input.close(), () => view.dispose(), closeCoordinator, stopServer]) {
      try { await cleanup(); }
      catch (error) {
        if (!cleanupFailure || cleanupUnconfirmed({ error: error.code }) && !cleanupUnconfirmed({ error: cleanupFailure.code })) cleanupFailure = error;
      }
    }
    if (cleanupFailure && cleanupUnconfirmed({ error: cleanupFailure.code })) {
      const prior = serverFailure ?? primaryFailure;
      if (prior && prior !== cleanupFailure) cleanupFailure.cause ??= prior;
      throw cleanupFailure;
    }
    if (serverFailure && serverFailure !== primaryFailure && !cleanupUnconfirmed({ error: primaryFailure?.code })) {
      if (primaryFailure) serverFailure.cause ??= primaryFailure;
      throw serverFailure;
    }
    if (cleanupFailure) {
      if (!primaryFailure) throw cleanupFailure;
      // Preserve the original failure while still making failed cleanup visible.
      try { write(`Koto: ${visible(cleanupFailure.message)}\n`); } catch { /* Keep the original failure. */ }
    }
  }
}
