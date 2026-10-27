import { discoverAgentAccounts, listLocalModelChoices, installLocalModel,
  acquireLlamaRuntime, defaultStateDirectory } from '../src/index.js';
import path from 'node:path';

const gib = bytes => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
const checkQuit = answer => {
  if (['/quit', '/exit'].includes(answer)) throw Object.assign(new Error('Koto closed.'), { code: 'chat_cancelled' });
  return answer;
};

export async function configureAccounts({ ask, print, preferences, signal, login, installClient }) {
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
    const answer = checkQuit(await ask(`Use account [${fallback >= 0 ? fallback + 1 : '1'}], or skip: `));
    if (answer === 'rescan') { automatic = true; continue; }
    if (answer === 'skip') return undefined;
    const selected = accounts[Number(answer || (fallback >= 0 ? fallback + 1 : 1)) - 1];
    if (!selected) { print('Choose a listed account number, or skip.'); continue; }
    if (selected.status === 'ready') return selected;
    if (selected.status === 'missing') {
      print(`${selected.label} needs its native client. ${selected.installation?.url ?? selected.install?.url ?? ''}`);
      if (installClient && ['y', 'yes'].includes((await ask(`Install ${selected.label}'s native client for Koto? [y/N]: `)).toLowerCase())) {
        await installClient(selected.kind);
        automatic = false; // Rediscover the newly saved private executable.
      } else return undefined;
    } else {
      if (!['y', 'yes'].includes((await ask(`Open native ${selected.label} sign-in? [y/N]: `)).toLowerCase())) return undefined;
      await login(selected);
    }
  }
}

export async function configureLocalModels({ ask, print, signal, onProgress }) {
  const choices = listLocalModelChoices();
  print('Optional open-source models run on this computer. You can skip this and use your subscriptions.');
  print('Memory guidance describes resource fit. Review local coding results before integrating them.');
  for (const [index, model] of choices.entries()) {
    print(`  ${index + 1}. ${model.label} — ${gib(model.bytes)} download, ${model.license}${model.suitable ? '' : ' (does not fit the suggested memory budget)'}`);
    if (model.description) print(`     ${model.description}`);
  }
  for (;;) {
    const answer = checkQuit(await ask('Choose a model number, or Enter to skip: '));
    if (!answer || answer === 'skip') return undefined;
    const selected = choices[Number(answer) - 1];
    if (!selected) { print('Choose a listed model number, or Enter to skip.'); continue; }
    if (!selected.suitable) { print('Choose a model that fits the suggested memory budget, or skip.'); continue; }
    print(`Koto will download ${selected.label} (${gib(selected.bytes)}) and a pinned llama.cpp runtime if needed. Files stay in ${path.join(defaultStateDirectory, 'models')}.`);
    if (!['y', 'yes'].includes((await ask('Install this local model? [y/N]: ')).toLowerCase())) return undefined;
    const runtime = await acquireLlamaRuntime({ directory: path.join(defaultStateDirectory, 'runtimes'), signal, onProgress });
    const installed = await installLocalModel({ id: selected.id, directory: path.join(defaultStateDirectory, 'models'), signal, onProgress });
    return { ...installed, command: runtime.path };
  }
}
