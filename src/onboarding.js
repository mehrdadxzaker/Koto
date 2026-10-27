import { homedir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { startSetupCommand } from './setup-command.js';
import { resolveAgentExecutable } from './launch-preflight.js';

const CLIENTS = Object.freeze({
  codex: { label: 'Codex / ChatGPT', account: 'chatgpt', statusArgs: ['login', 'status'], loginArgs: ['login'],
    npmPackage: '@openai/codex', installationUrl: 'https://developers.openai.com/codex/cli/' },
  claude: { label: 'Claude Code / Claude', account: 'subscription', statusArgs: ['auth', 'status', '--json'], loginArgs: ['auth', 'login'],
    npmPackage: '@anthropic-ai/claude-code', installationUrl: 'https://code.claude.com/docs/en/quickstart' },
});
// Native account discovery and login must not silently select paid API access
// from the shell. Credentials and native account homes remain host-owned.
const PROVIDER_ENV = Object.freeze([
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
  'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_RESOURCE',
]);
const ENV_NAMES = new Set(PROVIDER_ENV);
const OUTPUT_LIMIT = 32 * 1024;
const STATUS_TIMEOUT_MS = 10_000;

const fail = (code, message) => Object.assign(new Error(message), { code });
function client(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(CLIENTS, kind)) {
    throw fail('onboarding_client_unsupported', 'Choose Codex or Claude Code for native subscription setup.');
  }
  return CLIENTS[kind];
}

/** Resolve known native installations without changing PATH or executing them.
 * An explicit selection is authoritative; an invalid selected path never falls
 * back to a different executable behind the user's back.
 */
export async function resolveNativeClientExecutable(kind, explicitCommand) {
  client(kind);
  if (explicitCommand !== undefined) {
    if (typeof explicitCommand !== 'string') throw fail('launch_invalid_executable', 'Choose a native client executable name or absolute path.');
    const command = explicitCommand.startsWith('~/') ? path.join(homedir(), explicitCommand.slice(2)) : explicitCommand;
    return resolveAgentExecutable(command);
  }
  let missing;
  try { return await resolveAgentExecutable(kind); }
  catch (error) { missing = error; }
  const filename = kind + (process.platform === 'win32' ? '.exe' : '');
  const candidates = [path.join(homedir(), '.local', 'bin', filename),
    ...(process.platform === 'win32' ? [] : ['/usr/local/bin/' + kind]),
    ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/' + kind,
      ...(kind === 'codex' ? ['/Applications/Codex.app/Contents/Resources/codex',
        path.join(homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex')] : [])] : []),
  ];
  for (const candidate of candidates) {
    try { return await resolveAgentExecutable(candidate); }
    catch { /* Check only known locations, never scan account or project files. */ }
  }
  throw missing;
}

function subscriptionEnvironment() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^GIT_/i.test(key) && !ENV_NAMES.has(key.toUpperCase()))),
  DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' };
}

function result(kind, command, status, message, error) {
  const definition = client(kind);
  return { id: kind, kind, label: definition.label, account: definition.account,
    ...(command ? { command } : {}), status, message, inferenceAccess: 'unverified',
    ...(status === 'missing' ? { installation: {
      npmPackage: definition.npmPackage, url: definition.installationUrl,
    } } : {}),
    ...(error ? { error } : {}) };
}

async function inspectAccount(kind, command, { cwd, signal }) {
  const definition = client(kind);
  const controller = new AbortController();
  let stdout = '', stderr = '', bytes = 0, exceeded = false;
  let handle;
  try {
    handle = await startSetupCommand({ id: `discover-${kind}`, command, args: definition.statusArgs,
      cwd, env: subscriptionEnvironment(), timeoutMs: STATUS_TIMEOUT_MS,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      onEvent(event) {
        if (event.type !== 'output' || exceeded) return;
        bytes += Buffer.byteLength(event.text);
        if (bytes > OUTPUT_LIMIT) { exceeded = true; controller.abort(); return; }
        // The native status protocol may contain private metadata. Inspect it
        // only here; never return/log the payload or native diagnostics.
        if (event.stream === 'stdout') stdout += event.text;
        else stderr += event.text;
      } });
    handle.endInput();
    const outcome = await handle.completion;
    if (outcome.error === 'cleanup_unconfirmed') {
      throw fail('onboarding_cleanup_unconfirmed', 'Cleanup of an owned native account-status process could not be confirmed. Inspect that process before retrying setup.');
    }
    if (exceeded) return result(kind, command, 'unavailable', 'The native client returned too much account-status output. Check its native account setup.', 'onboarding_status_output_limit');
    if (signal?.aborted || outcome.status === 'cancelled') return result(kind, command, 'unavailable', 'Account discovery was cancelled.', 'onboarding_cancelled');
    if (outcome.error && outcome.error !== 'exit_failed') {
      return result(kind, command, 'unavailable', outcome.error === 'timeout'
        ? 'The native account-status check timed out. Check the client before retrying.'
        : 'The native account-status check could not complete. Check the installed client.',
      outcome.error === 'timeout' ? 'onboarding_status_timeout' : 'onboarding_status_unavailable');
    }
    if (kind === 'codex') {
      const status = stripVTControlCharacters(`${stdout}\n${stderr}`);
      if (outcome.status === 'succeeded' && /^\s*Logged in (?:using|with) ChatGPT\s*$/im.test(status)) {
        return result(kind, command, 'ready', 'Existing ChatGPT login found. Model access and remaining usage are checked when you start work.');
      }
      if (/^\s*Not logged in\s*$/im.test(status) || /Logged in (?:using|with) (?:an? )?API key/i.test(status)) {
        return result(kind, command, 'login_required', 'Sign in to Codex with your ChatGPT account to reuse its subscription.');
      }
    } else {
      let account;
      try { account = JSON.parse(stdout); } catch { /* Unknown native versions remain unverified. */ }
      if (account && typeof account === 'object' && !Array.isArray(account)) {
        if (outcome.status === 'succeeded' && account.loggedIn === true
          && ['claude.ai', 'oauth_token'].includes(account.authMethod)
          && (account.apiProvider === undefined || account.apiProvider === 'firstParty')) {
          return result(kind, command, 'ready', 'Existing Claude subscription login found. Model access and remaining usage are checked when you start work.');
        }
        if (account.loggedIn === false || account.loggedIn === true
          && (typeof account.authMethod === 'string' || typeof account.apiProvider === 'string')) {
          return result(kind, command, 'login_required', 'Sign in to Claude Code with your Claude subscription account.');
        }
      }
    }
    return result(kind, command, 'unavailable', 'The native client could not confirm a subscription login. Open its native account setup.', 'onboarding_status_unrecognized');
  } finally {
    // Completed checks have already settled owned cleanup. On an exception,
    // stop and await the same owner before allowing setup to continue.
    if (handle) { handle.stop(); await handle.completion; }
    stdout = ''; stderr = '';
  }
}

/** Inspect at most two native account-status processes concurrently. No model
 * requests, token files, provider account APIs or implicit login flows are used.
 * Ready means a native subscription login was observed, not paid entitlement,
 * available model access or a successful coding/inference request.
 */
export async function discoverAgentAccounts({ signal, cwd = homedir(), commands = {} } = {}) {
  if (signal !== undefined && !(signal instanceof AbortSignal)
    || typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0') || Buffer.byteLength(cwd) > 4096
    || !commands || typeof commands !== 'object' || Array.isArray(commands)
    || Object.keys(commands).some(kind => !Object.hasOwn(CLIENTS, kind)
      || commands[kind] !== undefined && typeof commands[kind] !== 'string')) {
    throw new TypeError('Choose an absolute account-discovery directory, supported native commands and an optional AbortSignal.');
  }
  if (signal?.aborted) throw fail('onboarding_cancelled', 'Account discovery was cancelled.');
  const controller = new AbortController();
  const joinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const records = await Promise.allSettled(Object.keys(CLIENTS).map(async kind => {
    let command;
    try { command = await resolveNativeClientExecutable(kind, commands[kind]); }
    catch { return result(kind, undefined, 'missing', `${kind === 'codex' ? 'Codex' : 'Claude Code'} is not installed or its selected executable is unavailable.`); }
    try { return await inspectAccount(kind, command, { cwd, signal: joinedSignal }); }
    catch (error) { controller.abort(); throw error; }
  }));
  const failed = records.find(record => record.status === 'rejected');
  if (failed) throw failed.reason;
  return records.map(record => record.value);
}

/** The caller executes this descriptor with native stdin/stdout/stderr attached
 * to the user's real terminal and owns cancellation/deadline/cleanup. It must
 * remove unsetEnv case-insensitively plus GIT_* overrides from the child env.
 * Opening this descriptor never starts login or changes native credentials.
 */
export async function getNativeLoginCommand({ kind, command } = {}) {
  const definition = client(kind);
  return { kind, command: await resolveNativeClientExecutable(kind, command),
    args: [...definition.loginArgs], account: definition.account,
    unsetEnv: [...PROVIDER_ENV], timeoutMs: 300_000 };
}
