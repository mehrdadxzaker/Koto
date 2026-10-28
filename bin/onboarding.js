import { discoverAgentAccounts, listLocalModelChoices, installLocalModel,
  acquireLlamaRuntime, defaultStateDirectory, resolveNativeClientExecutable,
  resolveAgentExecutable } from '../src/index.js';
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { throwOnResourceExhaustion } from '../src/bounded-fetch.js';

const gib = bytes => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
const checkQuit = answer => {
  if (['/quit', '/exit'].includes(answer)) throw Object.assign(new Error('Koto closed.'), { code: 'chat_cancelled' });
  return answer;
};

async function confirm({ ask, choose, signal }, title) {
  if (!choose) return ['y', 'yes'].includes(checkQuit(await ask(`${title} [y/N]: `)).toLowerCase());
  return await choose({ title, items: [{ value: 'no', label: 'Cancel' }, { value: 'yes', label: 'Continue', description: title }], initial: 'no', signal }) === 'yes';
}

export async function configureAccounts({ ask, choose, print, preferences, signal, login, installClient }) {
  let automatic = false;
  for (;;) {
    print('Finding your Codex and Claude Code subscription logins…');
    const commands = { ...preferences.nativeCommands };
    if (['codex', 'claude'].includes(preferences.coordinator?.kind) && preferences.coordinator.command) {
      commands[preferences.coordinator.kind] ??= preferences.coordinator.command;
    }
    const accounts = await discoverAgentAccounts({ signal, commands: automatic ? {} : commands });
    for (const [index, account] of accounts.entries()) {
      print(`  ${index + 1}. ${account.label} — ${account.message}`);
    }
    print('Uses native subscription logins. No provider API key is required.');
    if (accounts.some(account => account.status === 'missing')) print('Enter rescan to look for current native installations again.');
    const ready = accounts.findIndex(account => account.status === 'ready'
      && account.kind === preferences.coordinator?.kind);
    const fallback = ready >= 0 ? ready : accounts.findIndex(account => account.status === 'ready');
    const answer = choose ? await choose({ title: 'Choose a subscription account', signal, initial: 'skip', items: [
      { value: 'skip', label: 'Skip for now', description: 'Return to Koto without installing or signing in.' },
      ...accounts.map((account, index) => ({ value: String(index + 1), label: account.label, description: account.message })),
      { value: 'rescan', label: 'Rescan installed clients', description: 'Inspect current known native client locations.' },
      { value: 'manual', label: 'Use a native client path', description: 'Select an existing Codex or Claude Code executable.' },
    ] }) : checkQuit(await ask(`Use account [${fallback >= 0 ? fallback + 1 : '1'}], rescan, manual, or skip: `));
    if (answer === null) return undefined;
    if (answer === 'rescan') { automatic = true; continue; }
    if (answer === 'skip') return undefined;
    if (answer === 'manual') {
      const kind = choose ? await choose({ title: 'Native client kind', signal, initial: 'cancel', items: [
        { value: 'cancel', label: 'Cancel' }, { value: 'codex', label: 'Codex / ChatGPT' }, { value: 'claude', label: 'Claude Code / Claude' },
      ] }) : checkQuit(await ask('Native client kind: codex, claude, or cancel: '));
      if (!['codex', 'claude'].includes(kind)) continue;
      const filename = checkQuit(await ask('Existing native executable path, or Enter to cancel: '));
      if (!filename) continue;
      try {
        const command = await resolveNativeClientExecutable(kind, filename);
        preferences.nativeCommands = { ...preferences.nativeCommands, [kind]: command };
        automatic = false;
      } catch (error) { throwOnResourceExhaustion(error); signal?.throwIfAborted(); print(error.message); }
      continue;
    }
    const selected = accounts[Number(answer || (fallback >= 0 ? fallback + 1 : 1)) - 1];
    if (!selected) { print('Choose a listed account number, or skip.'); continue; }
    if (selected.status === 'ready') return selected;
    if (selected.status === 'missing') {
      print(`${selected.label} needs its native client. ${selected.installation?.url ?? selected.install?.url ?? ''}`);
      if (installClient && await confirm({ ask, choose, signal }, `Install ${selected.label}'s native client for Koto?`)) {
        await installClient(selected.kind);
        automatic = false; // Rediscover the newly saved private executable.
      } else return undefined;
    } else {
      if (!await confirm({ ask, choose, signal }, `Open native ${selected.label} sign-in?`)) return undefined;
      await login(selected);
    }
  }
}

async function existingLocalModel({ ask, print, signal }) {
  const selected = checkQuit(await ask('Existing GGUF model path, or Enter to cancel: '));
  if (!selected) return undefined;
  const filename = await realpath(path.resolve(selected.startsWith('~/') ? path.join(homedir(), selected.slice(2)) : selected));
  signal?.throwIfAborted();
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 16 || !/\.gguf$/i.test(filename)) throw new Error('Choose an existing regular GGUF model file.');
  const handle = await open(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new Error('The model file changed while being selected.');
    const header = Buffer.alloc(4);
    const result = await handle.read(header, 0, 4, 0);
    if (result.bytesRead !== 4 || header.toString('ascii') !== 'GGUF') throw new Error('The selected file does not have a GGUF header.');
  } finally { await handle.close(); }
  print('An existing installed llama-server executable is required; Koto will not download one for this selection.');
  const runtime = checkQuit(await ask('Runtime executable [llama-server], or cancel: '));
  if (runtime === 'cancel') return undefined;
  const command = await resolveAgentExecutable(runtime || 'llama-server');
  return { id: `manual-${createHash('sha256').update(filename).digest('hex').slice(0, 12)}`,
    modelPath: filename, path: filename, command, contextSize: 8192, model: { label: path.basename(filename), contextSize: 8192 } };
}

export async function configureLocalModels({ ask, choose, print, signal, onProgress }) {
  const choices = listLocalModelChoices();
  print('Optional open-source models run on this computer. You can skip this and use your subscriptions.');
  print('Memory guidance describes resource fit. Review local coding results before integrating them.');
  for (const [index, model] of choices.entries()) {
    print(`  ${index + 1}. ${model.label} — ${gib(model.bytes)} download, ${model.license}${model.suitable ? '' : ' (does not fit the suggested memory budget)'}`);
    if (model.description) print(`     ${model.description}`);
  }
  for (;;) {
    const answer = choose ? await choose({ title: 'Optional local model', signal, initial: 'skip', items: [
      { value: 'skip', label: 'Skip local models', description: 'Use your configured subscription account.' },
      ...choices.map((model, index) => ({ value: String(index + 1), label: model.label,
        description: `${gib(model.bytes)} download · ${model.license}${model.suitable ? '' : ' · exceeds suggested memory budget'}`, disabled: !model.suitable })),
      { value: 'manual', label: 'Use an existing GGUF file', description: 'Select installed model weights and an installed llama-server; no download.' },
    ] }) : checkQuit(await ask('Choose a model number, manual for an existing GGUF, or Enter to skip: '));
    if (answer === null) return undefined;
    if (!answer || answer === 'skip') return undefined;
    if (answer === 'manual') {
      try { return await existingLocalModel({ ask, print, signal }); }
      catch (error) { throwOnResourceExhaustion(error); if (signal?.aborted || error.code === 'chat_cancelled') throw error; print(error.message); continue; }
    }
    const selected = choices[Number(answer) - 1];
    if (!selected) { print('Choose a listed model number, or Enter to skip.'); continue; }
    if (!selected.suitable) { print('Choose a model that fits the suggested memory budget, or skip.'); continue; }
    print(`Koto will download ${selected.label} (${gib(selected.bytes)}) and a pinned llama.cpp runtime if needed. Files stay in ${path.join(defaultStateDirectory, 'models')}.`);
    if (!await confirm({ ask, choose, signal }, 'Install this local model?')) return undefined;
    const runtime = await acquireLlamaRuntime({ directory: path.join(defaultStateDirectory, 'runtimes'), signal, onProgress });
    const installed = await installLocalModel({ id: selected.id, directory: path.join(defaultStateDirectory, 'models'), signal, onProgress });
    return { ...installed, command: runtime.path };
  }
}
