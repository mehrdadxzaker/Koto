import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { defaultStateDirectory } from '../src/preferences.js';

const LIMIT = 256 * 1024;
const disabled = () => process.env.KOTO_NO_HISTORY === '1';
const own = info => !process.getuid || info.uid === process.getuid();
const failure = () => new Error('Prompt history needs a private, canonical Koto state directory.');
const validMessage = value => typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= 32 * 1024
  && !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(value);

async function location({ project, directory = defaultStateDirectory }, create = false) {
  if (typeof project !== 'string' || !path.isAbsolute(project) || project.includes('\0')
    || typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw failure();
  const root = path.resolve(directory);
  if (await realpath(root) !== root) throw failure();
  const base = await lstat(root);
  if (!base.isDirectory() || base.isSymbolicLink() || !own(base)
    || process.platform !== 'win32' && (base.mode & 0o077) !== 0) throw failure();
  const historyDirectory = path.join(root, 'prompt-history');
  if (create) await mkdir(historyDirectory, { mode: 0o700 });
  const info = await lstat(historyDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || !own(info) || await realpath(historyDirectory) !== historyDirectory
    || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw failure();
  const projectRoot = await realpath(project);
  const digest = createHash('sha256').update(projectRoot).digest('hex');
  return { filename: path.join(historyDirectory, `${digest}.json`), projectRoot };
}

async function prepareLocation(options) {
  try { return await location(options, true); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return location(options); }
}

export async function loadPromptHistory({ project, directory = defaultStateDirectory } = {}) {
  if (disabled() || !project) return [];
  let found;
  try { found = await location({ project, directory }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  let before;
  try { before = await lstat(found.filename); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.size > LIMIT || !own(before)
    || process.platform !== 'win32' && (before.mode & 0o077) !== 0) throw failure();
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle = await open(found.filename, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size > LIMIT || !own(info)
      || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw failure();
    const buffer = Buffer.alloc(LIMIT + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    const after = await handle.stat();
    if (bytes > LIMIT || info.size !== after.size || info.mtimeMs !== after.mtimeMs) throw failure();
    const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)));
    if (record?.schemaVersion !== 1 || record.project !== found.projectRoot || !Array.isArray(record.messages)
      || record.messages.length > 200 || !record.messages.every(validMessage)) throw failure();
    return record.messages;
  } finally { await handle.close(); }
}

/** Saves user prompt history only. Caller excludes login, approval and setup
 * answers; assistant/tool output is never accepted as a transcript here.
 */
export async function savePromptHistory(history, { project, directory = defaultStateDirectory } = {}) {
  if (disabled() || !project) return;
  if (!Array.isArray(history)) throw new TypeError('Prompt history must be an array.');
  const found = await prepareLocation({ project, directory });
  const messages = history.filter(validMessage).slice(-200);
  let payload;
  do {
    payload = `${JSON.stringify({ schemaVersion: 1, project: found.projectRoot, messages }, null, 2)}\n`;
    if (Buffer.byteLength(payload) <= LIMIT) break;
    messages.shift();
  } while (messages.length);
  const temporary = path.join(path.dirname(found.filename), `.history-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, found.filename);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function clearPromptHistory(options = {}) {
  if (!options.project) return;
  let found;
  try { found = await location(options); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  // Exact project-owned target only; unlinking a symlink never follows it.
  await unlink(found.filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
