import { stripVTControlCharacters } from 'node:util';
import { discoverAgentAccounts, inspectLocalModelSetup, setupLocalModel } from '../src/index.js';

const visible = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const gib = bytes => Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : 'unknown';

export function showAccounts(accounts, write) {
  for (const account of accounts) {
    const login = account.signedIn === true ? `${account.accountType ?? 'native'} login found`
      : account.signedIn === false ? 'not signed in' : 'login status unavailable';
    write(`${account.kind}: ${account.installed ? `${account.version ?? 'installed'}; ${login}` : 'not installed'}${account.status === 'ready' ? '; ready to connect' : `; ${account.reason}`}\n`);
  }
  write('Login discovery does not confirm model access; the native client checks access when you send a message.\n');
}

/** Metadata and native sign-in only. Sending a model request is a separate action. */
export async function chooseNativeAccount({ preferences, ask, write, signal, signIn }) {
  let accounts = await discoverAgentAccounts({ signal, commands: Object.fromEntries(
    [preferences.coordinator, ...preferences.workers].filter(item => ['codex', 'claude'].includes(item?.kind ?? item?.nativeKind))
      .map(item => [item.kind ?? item.nativeKind, item.command])) });
  while (!signal?.aborted) {
    showAccounts(accounts, write);
    write('1. Codex / ChatGPT subscription\n2. Claude subscription\nEnter keeps your current choice. Local models are available with /local.\n');
    const answer = await ask('Connect [1/2/Enter]> ');
    if (!answer || answer === 'cancel') return undefined;
    const kind = ({ 1: 'codex', 2: 'claude', codex: 'codex', claude: 'claude' })[answer];
    const account = accounts.find(item => item.kind === kind);
    if (!account) { write('Choose 1, 2, or Enter.\n'); continue; }
    if (!account.installed) {
      write(`Install the official ${kind} client: ${account.install?.url ?? ''}\n${account.install?.command ?? ''}\nThen use /connect again. Koto has not installed a second client.\n`);
      return undefined;
    }
    if (account.status === 'ready') return account;
    if (account.status === 'needs_sign_in') {
      write(`Continue through the installed ${kind} subscription sign-in. Native credentials stay with that client.\n`);
      if (await ask('Type sign in to open it; Enter cancels> ') !== 'sign in') return undefined;
      await signIn(account);
      accounts = await discoverAgentAccounts({ signal, commands: { [kind]: account.command } });
      continue;
    }
    write(`This client needs attention: ${account.reason}. ${account.nativeState?.writable === false
      ? 'Its native state directory must be writable in your account-owned terminal; Koto will not move credentials.'
      : 'Open the native client to resolve its setup, then use /connect again.'}\n`);
    return undefined;
  }
}

/** Display real installed assets and host estimates; acquisition stays in the core. */
export async function chooseLocalModel({ preferences, ask, write, signal, beforeStart, onProgress }) {
  const setup = await inspectLocalModelSetup({ signal, llamaCommand: preferences.llamaCommand ?? 'llama-server' });
  write(`Local models are optional. RAM: ${gib(setup.machine.memoryBytes)}; currently free: ${gib(setup.machine.freeMemoryBytes)}; storage available: ${gib(setup.machine.diskAvailableBytes)}.\n`);
  const ready = Object.values(setup.runtimes).flatMap(runtime => runtime.reachable
    ? runtime.models.map(model => ({ model: model.id, endpoint: runtime.apiBaseUrl, route: runtime.kind, reused: true })) : []);
  ready.forEach((model, index) => write(`${index + 1}. Use running ${visible(model.model)} (${model.route})\n`));
  setup.choices.forEach((choice, index) => write(`${ready.length + index + 1}. ${choice.name}: about ${gib(choice.downloadEstimateBytes)} download, ${gib(choice.estimatedWorkingBytes)} working memory; ${choice.suitability.replaceAll('_', ' ')}${choice.retained.length ? '; retained weights available' : ''}\n`));
  write(`${setup.estimates}\nEnter skips local setup.\n`);
  const answer = await ask('Local model [number/Enter]> ');
  if (!answer || answer === 'cancel' || answer === 'skip') return undefined;
  if (!/^[1-9][0-9]*$/.test(answer)) throw new Error('Choose a displayed model number, or Enter to skip.');
  const index = Number(answer) - 1;
  if (ready[index]) return ready[index];
  const choice = setup.choices[index - ready.length];
  if (!choice) throw new Error('Choose one of the displayed local models.');
  if (choice.suitability === 'insufficient_memory') throw new Error('This machine is below the displayed memory estimate. Select a smaller model.');
  const defaultRoute = setup.runtimes.ollama?.reachable ? 'ollama' : 'llama';
  write('Ollama reuses its running native app and cache. llama.cpp uses installed tools to build the pinned official source when needed, then manages one local server.\n');
  let route = await ask(`Runtime [${defaultRoute}; or ${defaultRoute === 'ollama' ? 'llama' : 'ollama'}; cancel]> `);
  route ||= defaultRoute;
  if (route === 'cancel') return undefined;
  if (!['ollama', 'llama'].includes(route)) throw new Error('Choose ollama or llama.');
  return setupLocalModel({ choiceId: choice.id, route, signal,
    llamaCommand: preferences.llamaCommand ?? 'llama-server', onProgress,
    async approve(action) {
      write(`${visible(action.message)}\n`);
      if (action.downloadBytes ?? action.downloadEstimateBytes) write(`Download: ${gib(action.downloadBytes ?? action.downloadEstimateBytes)}${action.downloadBytes ? '' : ' (estimate)'}.\n`);
      if (action.source) write(`Source: ${visible(action.source)}\n`);
      if (action.commit) write(`Source revision: ${action.commit}\n`);
      if (action.sha256) write(`SHA-256: ${action.sha256}\n`);
      if (action.destination) write(`Store: ${visible(action.destination)}\n`);
      if (await ask('Type continue to proceed; Enter skips> ') !== 'continue') return false;
      if (action.action === 'start-runtime') await beforeStart?.();
      return true;
    } });
}
