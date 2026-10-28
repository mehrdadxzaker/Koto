import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaultStateDirectory = process.env.KOTO_STATE_DIR && path.isAbsolute(process.env.KOTO_STATE_DIR)
  ? process.env.KOTO_STATE_DIR : path.join(homedir(), '.koto');

const LIMIT = 128 * 1024;
const KINDS = new Set(['codex', 'claude', 'local']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, maximum = 4096) => typeof value === 'string' && value.length > 0
  && !value.includes('\0') && Buffer.byteLength(value) <= maximum;
const optional = (value, key, valid) => value[key] === undefined || valid(value[key]);
const strings = (value, maximum = 128) => Array.isArray(value) && value.length <= maximum
  && value.every(item => typeof item === 'string' && !item.includes('\0') && Buffer.byteLength(item) <= 16_384);
const list = (value, maximum, valid) => Array.isArray(value) && value.length <= maximum && value.every(valid);
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const own = info => !process.getuid || info.uid === process.getuid();
const invalid = () => new Error('Saved Koto setup contains invalid fields. Preserve a backup and restart setup.');

function worker(value) {
  return record(value) && text(value.id, 64) && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.id)
    && KINDS.has(value.nativeKind) && text(value.command) && strings(value.args)
    && ['model', 'account', 'effort', 'label', 'localEndpoint'].every(key => optional(value, key, text))
    && optional(value, 'inputMode', item => ['closed', 'pipe'].includes(item))
    && optional(value, 'transport', item => ['pipe', 'pty'].includes(item))
    && optional(value, 'unsetEnv', item => strings(item, 32))
    && optional(value, 'timeoutMs', item => integer(item, 1, 3_600_000));
}

function localInstall(value) {
  return record(value) && ['id', 'modelPath', 'command'].every(key => text(value[key]))
    && optional(value, 'label', text) && optional(value, 'contextSize', item => integer(item, 512, 32768));
}

function nativeConversation(value) {
  return record(value) && ['codex', 'claude'].includes(value.kind)
    && ['command', 'cwd', 'sessionId'].every(key => text(value[key])) && optional(value, 'model', text);
}

function localConversation(value) {
  if (!record(value) || value.schemaVersion !== 1 || value.kind !== 'koto-local-conversation'
    || !['sessionId', 'agentId', 'endpoint', 'model', 'cwd'].every(key => text(value[key]))
    || !['conversation', 'coding'].includes(value.mode) || !record(value.policy)
    || !list(value.history, 64, turn => Array.isArray(turn) && turn.length > 0 && list(turn, 128, message => record(message)
      && ['user', 'assistant', 'tool'].includes(message.role)
      && (typeof message.content === 'string' && !message.content.includes('\0')
        || message.role === 'assistant' && message.content === null)
      && optional(message, 'tool_call_id', text)
      && (message.role !== 'tool' || text(message.tool_call_id))
      && optional(message, 'tool_calls', calls => message.role === 'assistant' && Array.isArray(calls) && calls.length > 0 && list(calls, 4, call => record(call)
        && text(call.id, 256) && call.type === 'function' && record(call.function)
        && text(call.function.name, 256) && typeof call.function.arguments === 'string'
        && !call.function.arguments.includes('\0')))))) return false;
  const policy = value.policy;
  return policy.version === 1 && integer(policy.timeoutMs, 1, 3_600_000)
    && integer(policy.maxTurns, 1, 16) && integer(policy.maxOutputTokens, 1, 4096)
    && integer(policy.contextBytes, 1, 1024 * 1024) && text(policy.toolPolicy)
    && ['deny', 'per-command-callback'].includes(policy.commandApproval) && strings(policy.unsetEnv, 32);
}

function validatePreferences(value) {
  if (!record(value) || value.schemaVersion !== 1
    || !optional(value, 'workers', items => list(items, 8, worker)
      && new Set(items.map(item => item.id)).size === items.length)
    || !optional(value, 'coordinator', item => record(item) && KINDS.has(item.kind)
      && ['command', 'model', 'effort', 'account', 'endpoint'].every(key => optional(item, key, text)))
    || !optional(value, 'nativeCommands', item => record(item) && Object.keys(item).every(key =>
      ['codex', 'claude'].includes(key) && text(item[key])))
    || !['project', 'llamaCommand', 'selectedSession'].every(key => optional(value, key, text))
    || !optional(value, 'onboardingComplete', item => typeof item === 'boolean')
    || !optional(value, 'local', item => record(item) && text(item.endpoint) && text(item.model))
    || !optional(value, 'localInstall', localInstall)
    || !optional(value, 'localInstalls', items => list(items, 32, localInstall))
    || !optional(value, 'conversation', nativeConversation)
    || !optional(value, 'conversations', items => list(items, 12, nativeConversation))
    || !optional(value, 'localConversation', localConversation)
    || !optional(value, 'localConversations', items => list(items, 12, localConversation))
    || !optional(value, 'recentSessions', items => list(items, 20, item => record(item)
      && text(item.directory) && text(item.project) && optional(item, 'goal', goal => typeof goal === 'string' && !goal.includes('\0') && Buffer.byteLength(goal) <= 4096)
      && optional(item, 'savedAt', saved => text(saved, 128))))) throw invalid();
  return value;
}

async function protectedDirectory(directory, create = false) {
  if (!text(directory) || !path.isAbsolute(directory)) throw new Error('Koto setup needs an absolute protected directory owned by your account.');
  directory = path.resolve(directory);
  let current = path.parse(directory).root;
  const parts = path.relative(current, directory).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) return undefined;
      try { await mkdir(current, { mode: 0o700 }); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      info = await lstat(current);
    }
    const final = index === parts.length - 1;
    const sticky = !final && (info.mode & 0o1000) !== 0;
    if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32'
      && (((info.mode & 0o022) !== 0 && !sticky) || !own(info) && (final || info.uid !== 0))) {
      throw new Error('Koto setup needs real, protected directories owned by your account. Symlinked or writable shared locations are unsupported.');
    }
  }
  if (await realpath(directory) !== directory) throw new Error('Koto setup needs a canonical directory without symlinks.');
  return directory;
}

function privateSource(info) {
  return info.isFile() && !info.isSymbolicLink() && own(info)
    && (process.platform === 'win32' || (info.mode & 0o777) === 0o600);
}

/** Local product choices only. Native credentials remain with their CLI. */
export async function loadPreferences({ directory = defaultStateDirectory } = {}) {
  directory = await protectedDirectory(directory);
  if (!directory) return { schemaVersion: 1, workers: [] };
  const filename = path.join(directory, 'preferences.json');
  let file;
  try {
    const info = await lstat(filename);
    if (!privateSource(info) || info.size < 2 || info.size > LIMIT) throw new Error('Saved Koto setup must be a private regular file owned by your account (mode 600), no larger than 128 KiB.');
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await file.stat();
    if (!privateSource(opened) || opened.ino !== info.ino || opened.dev !== info.dev) throw invalid();
    const buffer = Buffer.alloc(LIMIT + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (offset > LIMIT || offset !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw invalid();
    let value;
    try { value = JSON.parse(buffer.subarray(0, offset).toString('utf8')); }
    catch { throw new Error('Saved Koto setup has invalid JSON. Preserve a backup and restart setup.'); }
    return validatePreferences(value);
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, workers: [] };
    throw error;
  } finally { await file?.close(); }
}

export async function savePreferences(preferences, { directory = defaultStateDirectory } = {}) {
  const bytes = `${JSON.stringify({ ...preferences, schemaVersion: 1 }, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > LIMIT) throw new Error('Koto preferences are too large.');
  validatePreferences(JSON.parse(bytes));
  directory = await protectedDirectory(directory, true);
  const temporary = path.join(directory, `.preferences-${randomUUID()}.json`);
  let file, created = false;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
    await rename(temporary, path.join(directory, 'preferences.json'));
  } finally {
    await file?.close();
    if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Explicit recovery preserves unreadable setup; session records stay intact. */
export async function archivePreferences({ directory = defaultStateDirectory } = {}) {
  directory = await protectedDirectory(directory);
  if (!directory) throw new Error('No saved Koto setup exists to preserve.');
  const folder = await lstat(directory);
  const filename = path.join(directory, 'preferences.json');
  const source = await lstat(filename);
  if (!folder.isDirectory() || folder.isSymbolicLink() || !source.isFile() || source.isSymbolicLink()
    || process.platform !== 'win32' && ((folder.mode & 0o022) !== 0
      || process.getuid && (folder.uid !== process.getuid() || source.uid !== process.getuid()))) {
    throw new Error('Saved setup must be an ordinary file in your own protected Koto directory before recovery.');
  }
  const backup = path.join(directory, `preferences-backup-${randomUUID()}.json`);
  await rename(filename, backup);
  return backup;
}
