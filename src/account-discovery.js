import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveAgentExecutable } from './launch-preflight.js';
import { startCommand } from './command-session.js';
import { startTerminalCommand } from './terminal-session.js';
import { resolveTerminalHelper } from './terminal-helper.js';

const KINDS = new Set(['codex', 'claude']);
const OUTPUT_LIMIT = 32_768;
const API_ENV = new Set(['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
  'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_RESOURCE']);
const INSTALL = Object.freeze({
  codex: { url: 'https://github.com/openai/codex#installation', command: 'npm install -g @openai/codex' },
  claude: { url: 'https://code.claude.com/docs/en/setup', command: 'npm install -g @anthropic-ai/claude-code' },
});
const failure = (code, message) => Object.assign(new Error(message), { code });
function kindCheck(kind) {
  if (!KINDS.has(kind)) throw new TypeError('Choose codex or claude for a native subscription account.');
}
function nativeEnvironment() {
  // Let the installed CLI keep its own native account storage. Remove only
  // API/backend overrides so onboarding cannot silently select paid API access.
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)
    && !API_ENV.has(name.toUpperCase())));
}

/** Known installed locations only; no package download, shell or credential read. */
export async function resolveNativeAgentExecutable(kind, explicit) {
  kindCheck(kind);
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || !path.isAbsolute(explicit)) {
      throw failure('account_executable_path_required', 'Choose an absolute native executable path.');
    }
    return resolveAgentExecutable(explicit);
  }
  const candidates = [kind, path.join(homedir(), '.local', 'bin', kind),
    path.join(homedir(), '.bun', 'bin', kind), '/usr/local/bin/' + kind];
  if (process.platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/' + kind);
    if (kind === 'codex') candidates.push('/Applications/Codex.app/Contents/Resources/codex',
      path.join(homedir(), 'Applications/Codex.app/Contents/Resources/codex'));
  } else if (process.platform === 'win32') {
    for (const directory of [process.env.LOCALAPPDATA, process.env.APPDATA]) {
      if (!directory || !path.isAbsolute(directory)) continue;
      candidates.push(path.join(directory, kind, `${kind}.exe`),
        path.join(directory, 'Programs', kind, `${kind}.exe`),
        path.join(directory, 'npm', `${kind}.exe`));
    }
    candidates.push(path.join(homedir(), '.local', 'bin', `${kind}.exe`));
  }
  let lastError;
  for (const candidate of candidates) {
    try { return await resolveAgentExecutable(candidate); }
    catch (error) { lastError = error; }
  }
  throw lastError ?? failure('launch_executable_not_found', `The ${kind} native CLI is not installed.`);
}

/** Metadata-only assessment: a writable parent is enough for absent state.
 * This is a prerequisite, never a claim that authentication or inference works.
 */
async function inspectNativeState(kind) {
  const configured = process.env[kind === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'];
  if (configured !== undefined && (!configured || !path.isAbsolute(configured))) {
    return { writable: false, reason: 'native_state_path_invalid' };
  }
  const directory = configured ?? path.join(homedir(), kind === 'codex' ? '.codex' : '.claude');
  let candidate = directory;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const info = await lstat(candidate);
      // Native account directories can be symlinked by their owner. access
      // asks the filesystem about the real target without reading its contents.
      if (!info.isDirectory() && !info.isSymbolicLink()) return { writable: false, reason: 'native_state_not_directory' };
      await access(candidate, constants.W_OK | constants.X_OK);
      return { writable: true, ...(candidate !== directory ? { needsCreation: true } : {}) };
    } catch (error) {
      if (error.code !== 'ENOENT') return { writable: false, reason: 'native_state_not_writable' };
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return { writable: false, reason: 'native_state_unavailable' };
}

async function inspectCommand({ kind, command, args, cwd, signal, helperPath }) {
  let output = '', standardOutput = '', exceeded = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const handle = (helperPath ? startTerminalCommand : startCommand)({ id: 'accountInspection',
    command, args, cwd, env: nativeEnvironment(), signal: controller.signal, timeoutMs: 10_000,
    ...(helperPath ? { helperPath, transport: 'pipe' } : {}),
    onEvent(event) {
      if (event.type !== 'output' || exceeded) return;
      output += event.text;
      if (event.stream === 'stdout') standardOutput += event.text;
      if (Buffer.byteLength(output) > OUTPUT_LIMIT) { exceeded = true; output = ''; controller.abort(); }
    } });
  handle.endInput();
  try {
    const outcome = await handle.completion;
    if (exceeded) return { error: 'account_output_limit' };
    if (outcome.error === 'cleanup_unconfirmed') return { error: 'cleanup_unconfirmed' };
    if (signal?.aborted) return { error: 'account_inspection_cancelled' };
    const stateWarning = /read-only file system|\bEROFS\b|os error 30/i.test(output);
    const metadata = value => ({ ...value, ...(stateWarning ? { error: 'native_state_not_writable' } : {}) });
    if (outcome.error && outcome.error !== 'exit_failed') return { error: outcome.error };
    if (args[0] === '--version') {
      const match = output.match(/\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/);
      return metadata(outcome.status === 'succeeded' && match ? { version: match[0] } : { error: 'native_version_unavailable' });
    }
    if (kind === 'codex') {
      if (outcome.exitCode === 0 && /logged in (?:with|using) chatgpt/i.test(output)) return metadata({ signedIn: true, accountType: 'chatgpt' });
      if (/not logged in|not signed in|login required|authentication required/i.test(output)) return metadata({ signedIn: false });
      if (/logged in (?:with|using).*api(?: key)?/i.test(output)) return metadata({ signedIn: true, accountType: 'api' });
      return { error: 'native_auth_status_unavailable' };
    }
    let record;
    try { record = JSON.parse(standardOutput); } catch { return { error: 'native_auth_status_unavailable' }; }
    if (record?.loggedIn === false) return metadata({ signedIn: false });
    if (record?.loggedIn !== true || outcome.exitCode !== 0) return { error: 'native_auth_status_unavailable' };
    return metadata({ signedIn: true, accountType: ['claude.ai', 'oauth_token'].includes(record.authMethod)
      && (record.apiProvider === undefined || record.apiProvider === 'firstParty') ? 'subscription' : 'api' });
  } finally { signal?.removeEventListener('abort', abort); }
}

/** Inspect installed native auth metadata only; never starts a model turn.
 * `ready` means prerequisites passed, not verified account/model entitlement.
 */
export async function discoverAgentAccounts({ commands = {}, cwd = process.cwd(), signal,
  nativeHelperDirectory } = {}) {
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)
    || Object.keys(commands).some(kind => !KINDS.has(kind))
    || typeof cwd !== 'string' || !path.isAbsolute(cwd)
    || (signal !== undefined && !(signal instanceof AbortSignal))) throw new TypeError('Invalid native account discovery options.');
  let helperPath;
  if (process.platform === 'win32') {
    try { helperPath = await resolveTerminalHelper({ directory: nativeHelperDirectory }); }
    catch { /* Report missing ownership support without launching inspection. */ }
  }
  return Promise.all([...KINDS].map(async kind => {
    const base = { kind, installed: false, signedIn: null, access: 'unverified', accessVerified: false };
    let command;
    try { command = await resolveNativeAgentExecutable(kind, commands[kind]); }
    catch (error) { return { ...base, status: 'not_installed', reason: error.code ?? 'launch_executable_not_found',
      install: { ...INSTALL[kind] } }; }
    base.installed = true;
    base.command = command;
    const nativeState = await inspectNativeState(kind);
    if (process.platform === 'win32' && !helperPath) return { ...base, nativeState,
      status: 'needs_attention', reason: 'native_helper_required' };
    const version = await inspectCommand({ kind, command, args: ['--version'], cwd, signal, helperPath });
    if (['cleanup_unconfirmed', 'account_inspection_cancelled'].includes(version.error)) {
      return { ...base, nativeState, status: 'needs_attention', reason: version.error };
    }
    // Auth status remains useful even when a CLI warns that its state directory
    // is read-only. Never reinterpret that warning as an absent account.
    const auth = await inspectCommand({ kind, command,
      args: kind === 'codex' ? ['login', 'status'] : ['auth', 'status'], cwd, signal, helperPath });
    const result = { ...base, ...(version.version ? { version: version.version } : {}), nativeState,
      ...(auth.signedIn !== undefined ? { signedIn: auth.signedIn } : {}),
      ...(auth.accountType ? { accountType: auth.accountType } : {}) };
    const error = auth.error ?? version.error;
    if (error || !nativeState.writable) return { ...result, status: 'needs_attention',
      reason: !nativeState.writable ? nativeState.reason : error };
    if (!auth.signedIn) return { ...result, status: 'needs_sign_in', reason: 'native_subscription_login_required' };
    if (auth.accountType === 'api') return { ...result, status: 'needs_sign_in', reason: 'native_subscription_account_required' };
    return { ...result, status: 'ready', reason: 'native_login_detected_access_unverified' };
  }));
}

/** Explicit native browser/device sign-in; no API login or credential transfer.
 * Caller owns terminal attachment and must await completion before continuing.
 * Supply the verified platform helper for PTY/native interactive prompts.
 */
export async function startNativeSignIn({ kind, command, approved = false, cwd = process.cwd(),
  signal, onEvent, helperPath, timeoutMs = 600_000 } = {}) {
  kindCheck(kind);
  if (approved !== true) throw failure('native_sign_in_approval_required', 'Choose native sign-in explicitly before starting the installed CLI account flow.');
  const executable = await resolveNativeAgentExecutable(kind, command);
  const state = await inspectNativeState(kind);
  if (!state.writable) throw failure(state.reason, 'The native account directory is not writable. Use its supported account-owned environment; Koto will not move credentials.');
  if (process.platform === 'win32' && !helperPath) throw failure('native_helper_required', 'Build the platform helper before owned native sign-in on Windows.');
  const handle = (helperPath ? startTerminalCommand : startCommand)({ id: 'nativeSignIn', command: executable,
    args: kind === 'codex' ? ['-c', 'forced_login_method="chatgpt"', 'login'] : ['auth', 'login', '--claudeai'],
    cwd, env: nativeEnvironment(), signal, timeoutMs, onEvent,
    ...(helperPath ? { helperPath, transport: 'pty' } : {}) });
  return Object.assign(handle, { kind, command: executable, transport: helperPath ? 'pty' : 'pipe' });
}
