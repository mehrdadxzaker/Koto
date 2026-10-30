import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { startCommand } from './command-session.js';
import { startTerminalCommand } from './terminal-session.js';
import { resolveTerminalHelper } from './terminal-helper.js';
import { resolveAgentExecutable } from './launch-preflight.js';
import { throwOnResourceExhaustion } from './bounded-fetch.js';

const MAX_PATHS = 1024;
const INVENTORY_BYTES = 24_000;
const MAX_FILES = 8;
const FILE_BYTES = 256 * 1024;
const EXCERPT_BYTES = 32_000;
const MAX_LINES = 160;
const MAX_ENTRIES = 4096;
const contexts = new WeakMap();
const SKIP = new Set(['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'coverage', '.next', '.cache', '.koto', '.codex', '.claude', '.aws',
  '.ssh', '.gnupg', '.config', '.secrets', 'secrets', 'credentials', 'private']);
const PRIVATE = /(?:^|[._-])(?:secrets?|credentials?|passwords?|tokens?|private[._-]?key)(?:[._-]|$)/i;
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|icns|avif|pdf|zip|gz|bz2|xz|7z|tar|wasm|node|exe|dll|dylib|so|a|o|class|pyc|gguf|bin|db|sqlite3?|pem|key|der|p12|pfx|keystore|mp[34]|mov|woff2?|ttf|otf)$/i;
const PRIVATE_NAMES = new Set(['.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519', '.ds_store', 'config.json']);

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function abort(signal) { signal?.throwIfAborted(); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function usableName(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096
    && !/[\x00-\x1f\x7f\\]/.test(value);
}
function permitted(relative) {
  if (!usableName(relative) || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return false;
  const parts = relative.split('/');
  return parts.every(part => part && !['.', '..'].includes(part) && !SKIP.has(part.toLowerCase())
    && !PRIVATE.test(part) && !PRIVATE_NAMES.has(part.toLowerCase())
    && !/^\.env(?:$|\.)/i.test(part) && !BINARY.test(part));
}
function same(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function stable(left, right) {
  return same(left, right) && left.size === right.size && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}
function inside(root, value) {
  const relative = path.relative(root, value);
  return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function canonicalProject(project, signal) {
  abort(signal);
  if (typeof project !== 'string' || !project.trim() || Buffer.byteLength(project) > 4096
    || /[\x00-\x1f\x7f]/.test(project) || !path.isAbsolute(project)) {
    throw failure('inspection_project_invalid', 'Select an absolute existing project directory before inspecting files.');
  }
  const root = await realpath(project);
  const info = await lstat(root);
  if (!info.isDirectory()) throw failure('inspection_project_invalid', 'The selected project is not a directory.');
  abort(signal);
  return { root, info };
}

// Every component is checked before a leaf is opened. Opened file identity is
// compared with that observation and with the path again before content is used.
async function checkedFile(root, relative, signal) {
  if (!permitted(relative)) throw failure('inspection_path_private', 'Private, secret, generated or binary paths are excluded.');
  let selected = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    abort(signal);
    selected = path.join(selected, parts[index]);
    const info = await lstat(selected);
    if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory()) {
      throw failure('inspection_path_symlink', 'Symlinks and non-directory parents are excluded.');
    }
    if (await realpath(selected) !== selected) throw failure('inspection_path_changed', 'The selected path changed during inspection.');
    if (index === parts.length - 1) return { selected, info };
  }
  throw failure('inspection_path_invalid', 'Choose a project-relative file.');
}

async function projectInventory(root, source, sourceTruncated, signal) {
  const paths = [];
  let bytes = 2, scanned = 0, truncated = sourceTruncated;
  const deadline = performance.now() + 10_000;
  const seen = new Set();
  for (const relative of source.split('\0').slice(0, -1)) {
    abort(signal);
    if (paths.length >= MAX_PATHS || ++scanned > MAX_ENTRIES || bytes >= INVENTORY_BYTES || performance.now() > deadline) {
      truncated = true; break;
    }
    if (!permitted(relative) || seen.has(relative)) continue;
    seen.add(relative);
    try {
      const { info } = await checkedFile(root, relative, signal);
      if (!info.isFile() || info.nlink !== 1 || info.size > FILE_BYTES) continue;
      const cost = Buffer.byteLength(JSON.stringify(relative)) + 1;
      if (bytes + cost > INVENTORY_BYTES) { truncated = true; break; }
      paths.push(relative); bytes += cost;
    } catch (error) {
      abort(signal);
      throwOnResourceExhaustion(error, 'inspection_socket_exhausted');
      // Removed, unavailable and changed paths are not inspection candidates.
    }
  }
  return { paths: paths.sort(), truncated };
}

function gitEnvironment() {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...inherited, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
}

async function gitMetadata(root, { signal, nativeHelperDirectory } = {}) {
  const command = await resolveAgentExecutable(process.platform === 'win32' ? 'git.exe' : 'git');
  if (inside(root, command)) throw failure('inspection_git_unavailable', 'Git must be installed outside the selected project.');
  const helperPath = process.platform === 'win32' ? await resolveTerminalHelper({ directory: nativeHelperDirectory }) : undefined;
  const start = helperPath ? startTerminalCommand : startCommand;
  async function run(args, allowed = [0], { maxBytes = 32_768, partial = false } = {}) {
    abort(signal);
    const controller = new AbortController();
    const joined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let output = '', bytes = 0, exceeded = false;
    const handle = start({ id: 'inspectionGit', command, cwd: root, env: gitEnvironment(),
      ...(helperPath ? { helperPath, transport: 'pipe' } : {}),
      args: ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
        '-c', 'core.splitIndex=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args],
      timeoutMs: 10_000, signal: joined,
      onEvent(event) {
        if (event.type !== 'output' || exceeded) return;
        bytes += Buffer.byteLength(event.text);
        if (bytes > maxBytes) { exceeded = true; controller.abort(); return; }
        if (event.stream === 'stdout') output += event.text;
      } });
    handle.endInput();
    const result = await handle.completion;
    if (result.error === 'cleanup_unconfirmed') throw failure('inspection_git_cleanup_unconfirmed', 'Git inspection cleanup could not be confirmed. Stop further work and inspect its owned process.');
    if (result.error?.endsWith('socket_exhausted')) throw failure('inspection_socket_exhausted', 'Socket or file-descriptor capacity is unavailable. Stop new requests and inspect system resources.');
    abort(signal);
    if (exceeded && partial) return { code: result.exitCode, output, truncated: true };
    if (exceeded || result.error && result.error !== 'exit_failed' || !allowed.includes(result.exitCode)) {
      throw failure('inspection_git_unavailable', 'Bounded read-only Git metadata is unavailable; no clean-base claim is made.');
    }
    return { code: result.exitCode, output, truncated: false };
  }
  const identity = await run(['rev-parse', '--show-toplevel', 'HEAD']);
  const lines = identity.output.trim().split(/\r?\n/);
  if (lines.length !== 2 || await realpath(lines[0]) !== root || !/^[a-f0-9]{40,64}$/.test(lines[1])) {
    throw failure('inspection_git_unavailable', 'The selected directory is not a committed Git project root.');
  }
  // Status can invoke a repository's clean/process filters. Apply the same
  // custom-driver refusal as workspace preflight before inspecting worktree state.
  const custom = await run(['config', '--name-only', '--get-regexp', String.raw`^(filter\..*|merge\..*\.driver)$`], [0, 1]);
  if (custom.output.trim()) {
    throw failure('inspection_custom_git_driver_unsupported', 'This repository configures custom Git filters or merge drivers. Read-only inspection is unavailable until that configuration is separately reviewed.');
  }
  const branch = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1]);
  const status = await run(['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all'], [0], { partial: true });
  const listed = await run(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], [0], { maxBytes: 128 * 1024, partial: true });
  const inventory = await projectInventory(root, listed.output, listed.truncated, signal);
  return { git: { status: 'available', head: lines[1], ...(branch.output.trim() ? { branch: branch.output.trim().slice(0, 512) } : {}),
    dirty: status.output.length > 0 ? true : status.truncated ? null : false }, inventory };
}

/** Read-only inventory for inspection and @ file discovery. Dirty projects are
 * allowed; no workspace, model, worker or build is started by this collector.
 */
export async function inspectProjectContext(project, { signal, nativeHelperDirectory } = {}) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Choose an AbortSignal for project inspection.');
  const { root, info } = await canonicalProject(project, signal);
  const warnings = [];
  let git, inventory;
  try { ({ git, inventory } = await gitMetadata(root, { signal, nativeHelperDirectory })); }
  catch (error) {
    abort(signal);
    throwOnResourceExhaustion(error, 'inspection_socket_exhausted');
    if (error.code?.endsWith('cleanup_unconfirmed')) throw error;
    git = { status: 'unavailable', dirty: null };
    inventory = { paths: [], truncated: true };
    if (error.code === 'inspection_custom_git_driver_unsupported') warnings.push(error.message);
    warnings.push('Safe Git inventory, HEAD and dirty state could not be established. No directory-scan fallback or source findings are claimed.');
  }
  abort(signal);
  if (!same(info, await lstat(root)) || await realpath(root) !== root) throw failure('inspection_project_changed', 'The selected project directory changed during inspection.');
  if (inventory.truncated) warnings.push('The project inventory is bounded and incomplete; excluded/private/generated paths are not inspected.');
  const context = freeze({ schemaVersion: 1, projectRoot: root, git, inventory, warnings });
  contexts.set(context, { root, info, paths: new Set(inventory.paths) });
  return context;
}

function possibleCredential(content) {
  return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(content)
    || /\b(?:ghp_|github_pat_|sk-(?:proj-|live-|test-)?)[A-Za-z0-9_-]{20,}\b/.test(content)
    || /\bAKIA[A-Z0-9]{16}\b/.test(content)
    || /(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_+\/=.-]{20,}["']/i.test(content);
}

/** Bounded actual UTF-8 excerpts from a context returned by inspectProjectContext.
 * Paths are inventory-bound; the model cannot supply a new filesystem root.
 */
export async function readProjectContextFiles(context, requests, { signal } = {}) {
  const binding = contexts.get(context);
  if (!binding) throw failure('inspection_context_invalid', 'Collect a fresh project context before reading selected files.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Choose an AbortSignal for project inspection.');
  if (!Array.isArray(requests) || requests.length > MAX_FILES) throw failure('inspection_selection_invalid', 'Select at most eight project files.');
  abort(signal);
  const { root, info, paths } = binding;
  if (!same(info, await lstat(root)) || await realpath(root) !== root) throw failure('inspection_project_changed', 'The selected project directory changed. Collect a new inventory.');
  const files = [], rejected = [], seen = new Set();
  let truncated = false;
  for (const request of requests) {
    abort(signal);
    const relative = typeof request?.path === 'string' ? request.path : '';
    let file;
    try {
      if (!request || typeof request !== 'object' || Object.keys(request).some(key => !['path', 'startLine', 'endLine'].includes(key))
        || !paths.has(relative) || seen.has(relative)) throw failure('inspection_selection_invalid', 'Select one occurrence of a file from the current safe inventory.');
      seen.add(relative);
      const first = request.startLine ?? 1, requestedLast = request.endLine ?? first + MAX_LINES - 1;
      if (!Number.isSafeInteger(first) || first < 1 || first > 1_000_000 || !Number.isSafeInteger(requestedLast) || requestedLast < first || requestedLast > 1_000_000) {
        throw failure('inspection_selection_invalid', 'Choose positive bounded line ranges.');
      }
      const checked = await checkedFile(root, relative, signal);
      if (!checked.info.isFile() || checked.info.nlink !== 1 || checked.info.size > FILE_BYTES) {
        throw failure('inspection_file_excluded', 'Only regular, single-link source files of at most 256 KiB are inspected.');
      }
      file = await open(checked.selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const before = await file.stat();
      if (!before.isFile() || !stable(checked.info, before) || before.nlink !== 1 || before.size > FILE_BYTES) {
        throw failure('inspection_file_changed', 'The file changed before it could be read safely.');
      }
      const buffer = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < buffer.length) {
        abort(signal);
        const next = await file.read(buffer, count, buffer.length - count, count);
        if (!next.bytesRead) break;
        count += next.bytesRead;
      }
      const after = await file.stat();
      const observed = await checkedFile(root, relative, signal);
      if (count !== before.size || !stable(before, after) || !stable(after, observed.info)) {
        throw failure('inspection_file_changed', 'The file changed while its excerpt was being collected.');
      }
      const raw = buffer.subarray(0, count);
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
      catch { throw failure('inspection_file_binary', 'Non-UTF-8 files are excluded.'); }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) throw failure('inspection_file_binary', 'Binary/control-byte files are excluded.');
      if (possibleCredential(content)) throw failure('inspection_file_secret', 'Possible embedded credentials were detected; file content was not supplied.');
      const lines = content.split(/\r?\n/);
      if (first > lines.length) throw failure('inspection_line_unavailable', 'The selected start line is outside the actual file.');
      const last = Math.min(requestedLast, first + MAX_LINES - 1, lines.length);
      const excerpt = { path: relative, startLine: first, endLine: last, totalLines: lines.length,
        content: lines.slice(first - 1, last).join('\n'), sha256: createHash('sha256').update(raw).digest('hex'),
        truncated: first > 1 || last < lines.length || last < requestedLast };
      // Serialized accounting includes escaping and metadata, not just text.
      while (excerpt.endLine >= excerpt.startLine && Buffer.byteLength(JSON.stringify([...files, excerpt])) > EXCERPT_BYTES) {
        excerpt.endLine -= 1;
        excerpt.content = lines.slice(first - 1, excerpt.endLine).join('\n');
        excerpt.truncated = true;
      }
      if (excerpt.endLine < excerpt.startLine) { truncated = true; throw failure('inspection_excerpt_limit', 'The excerpt budget could not include this file.'); }
      files.push(excerpt);
      truncated ||= excerpt.truncated;
    } catch (error) {
      abort(signal);
      throwOnResourceExhaustion(error, 'inspection_socket_exhausted');
      rejected.push({ path: permitted(relative) ? relative : '[excluded path]', reason: error.code ?? 'inspection_file_unavailable' });
    } finally { await file?.close(); }
  }
  return freeze({ files, rejected, truncated });
}
