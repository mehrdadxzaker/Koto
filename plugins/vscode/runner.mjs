// A local IDE transport around the published CLI. The CLI owns product state,
// agents and integration; this process owns only its terminal and shutdown.
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';

const runFile = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.join(ROOT, 'dist', 'core');
const INPUT_LIMIT = 64 * 1024;
const QUEUE_LIMIT = 256 * 1024;
const MODE = process.argv[2];
const validText = (value, limit = 4096) => typeof value === 'string' && value.length > 0
  && !value.includes('\0') && Buffer.byteLength(value) <= limit;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid Koto IDE request.');
};
const dimension = value => Number.isInteger(value) && value >= 2 && value <= 1000;
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
let peerOpen = true;
let active;
let lease;
let receiptFile;
let stopPromise;
let finishing;
let core;
let coreVersion;
let startTerminalCommand;
let parentEnded = false;
let persistQueue = Promise.resolve();

function emit(value) {
  if (!peerOpen) return;
  const line = JSON.stringify(value) + '\n';
  if (process.stdout.writableLength + Buffer.byteLength(line) > QUEUE_LIMIT) {
    peerOpen = false;
    process.stdout.destroy();
    void stop('The editor output queue exceeded its bound.');
    return;
  }
  process.stdout.write(line);
}
function state() {
  return active ? {
    status: active.status, id: active.id, project: active.project, session: active.session,
    pid: active.handle?.pid ?? null, ...(active.error ? { error: active.error } : {}),
    ...(receiptFile ? { receiptFile } : {}),
  } : { status: 'idle' };
}
function announce() { emit({ type: 'state', state: state() }); }

async function privateDirectory(directory) {
  if (!validText(directory) || !path.isAbsolute(directory)) throw new Error('Koto IDE storage needs an absolute directory.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(directory) !== path.resolve(directory)
    || process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) {
    throw new Error('Koto IDE storage must be a private canonical directory owned by this account.');
  }
  return directory;
}
async function privateJson(filename) {
  let handle;
  try {
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024 || process.platform !== 'win32'
      && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) throw new Error('Invalid Koto IDE ownership record.');
    const buffer = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size) throw new Error('Koto IDE ownership record changed while reading.');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle?.close(); }
}
async function saveReceipt() {
  if (!receiptFile || !active) return;
  const value = {
    schemaVersion: 1, kind: 'koto-ide-terminal-owner', id: active.id,
    runnerPid: process.pid, cliPid: active.handle?.pid ?? null, status: active.status,
    project: active.project, session: active.session, coreVersion,
    startedAt: active.startedAt, observedAt: new Date().toISOString(),
    ...(active.error ? { error: active.error } : {}),
    ...(active.outcome ? { outcome: active.outcome } : {}),
  };
  persistQueue = persistQueue.then(async () => {
    const temporary = receiptFile + '.' + randomUUID();
    try {
      await fs.writeFile(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, receiptFile);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
  await persistQueue;
}
async function acquireLease(directory) {
  directory = await privateDirectory(directory);
  const filename = path.join(directory, 'terminal-owner.lock');
  try {
    const handle = await fs.open(filename, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, id: active.id, runnerPid: process.pid }) + '\n'); }
    finally { await handle.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Another Koto terminal is running or its cleanup is unconfirmed. Inspect '
      + path.join(directory, 'terminal-owner.json') + ' before starting a replacement.');
  }
  lease = { filename, id: active.id };
  receiptFile = path.join(directory, 'terminal-owner.json');
  await saveReceipt();
}
async function releaseLease() {
  if (!lease) return;
  const current = await privateJson(lease.filename);
  if (current.id !== lease.id || current.runnerPid !== process.pid) throw new Error('Koto IDE ownership changed; cleanup is unconfirmed.');
  await fs.unlink(lease.filename);
  lease = undefined;
}
async function canonicalDirectory(value) {
  if (!validText(value) || !path.isAbsolute(value)) throw new Error('Choose an absolute local project folder.');
  const canonical = await fs.realpath(value);
  if (!(await fs.stat(canonical)).isDirectory()) throw new Error('The selected project is not a folder.');
  return canonical;
}
async function snapshot(projectPaths = []) {
  if (!Array.isArray(projectPaths) || projectPaths.length > 20 || projectPaths.some(value => !validText(value))) {
    throw new Error('Invalid local project list.');
  }
  let preferences;
  let notice;
  try { preferences = await core.loadPreferences(); }
  catch { preferences = { recentSessions: [] }; notice = 'Saved Koto setup needs recovery. Open the CLI to preserve a backup and recover it.'; }
  const projects = [];
  for (const candidate of [preferences.project, ...projectPaths,
    ...(preferences.recentSessions ?? []).map(saved => saved.project)].filter(Boolean).slice(0, 41)) {
    try {
      const canonical = await canonicalDirectory(candidate);
      if (!projects.some(project => project.path === canonical)) projects.push({ id: idFor(canonical), name: path.basename(canonical), path: canonical });
    } catch { /* Missing shortcuts are not selectable projects. */ }
    if (projects.length === 20) break;
  }
  const sessions = [];
  for (const saved of (preferences.recentSessions ?? []).slice(0, 20)) {
    try {
      const retained = core.readProjectSession(saved.directory);
      const project = await canonicalDirectory(saved.project);
      if (retained.projectRoot !== project || !projects.some(item => item.path === project)) continue;
      sessions.push({ id: idFor(saved.directory), project, directory: saved.directory,
        goal: typeof saved.goal === 'string' ? saved.goal.slice(0, 4096) : '', active: retained.active === true });
    } catch { /* Never fabricate or repair a retained session from a shortcut. */ }
  }
  let helper;
  try { await core.resolveTerminalHelper({ directory: path.join(core.defaultStateDirectory, 'native') }); helper = { ready: true }; }
  catch { helper = { ready: false, message: 'Choose Set Up Terminal Support once to use the host\'s installed developer tools.' }; }
  return { coreVersion, stateDirectory: core.defaultStateDirectory, projects, sessions, helper, ...(notice ? { notice } : {}) };
}
async function processIdentity(pid) {
  if (process.platform === 'win32' || !Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const { stdout } = await runFile('/bin/ps', ['-p', String(pid), '-o', 'pid=,lstart=,command='], { timeout: 2000, maxBuffer: 16 * 1024 });
    const value = stdout.trim();
    return value.startsWith(String(pid) + ' ') && value.includes(path.join(CORE, 'bin', 'koto.js')) ? value : null;
  } catch { return null; }
}
async function wait(milliseconds) {
  let timer;
  return Promise.race([active.handle.completion.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
async function stop(reason) {
  if (stopPromise) return stopPromise;
  if (!active?.handle) { parentEnded = true; return; }
  stopPromise = (async () => {
    active.stopRequested = true;
    if (reason) active.error ??= reason;
    active.status = 'stopping';
    announce();
    await saveReceipt().catch(error => { active.error ??= error.message; });
    if (!active.outcome) {
      let timer;
      await Promise.race([active.ready, new Promise(resolve => { timer = setTimeout(resolve, 3000); })])
        .finally(() => clearTimeout(timer));
    }
    const identity = await active.identity;
    if (!active.outcome && identity && identity === await processIdentity(active.handle.pid)) {
      try { process.kill(active.handle.pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') active.error ??= 'The CLI could not receive its shutdown signal.'; }
    } else if (!active.outcome && process.platform === 'win32') {
      // ConPTY forwards native Ctrl+C; success still requires the CLI's ordinary
      // exit and the helper's independent owned-workload acknowledgement.
      active.handle.send('\x03');
    }
    if (!active.outcome && !await wait(45_000)) {
      active.forcedStop = true;
      active.handle.stop();
    }
    await active.handle.completion;
    await finishing;
  })();
  return stopPromise;
}
async function open(options) {
  exact(options, ['project', 'session', 'cols', 'rows', 'storagePath']);
  if (!validText(options.storagePath) || options.cols !== undefined && !dimension(options.cols)
    || options.rows !== undefined && !dimension(options.rows)
    || options.session !== undefined && !/^[a-f0-9]{20}$/.test(options.session)) throw new Error('Invalid terminal launch options.');
  if (parentEnded) throw new Error('The editor disconnected before Koto could start.');
  const project = options.project === undefined ? undefined : await canonicalDirectory(options.project);
  const current = await snapshot(project ? [project] : []);
  const saved = options.session === undefined ? undefined : current.sessions.find(item => item.id === options.session && item.project === project);
  if (options.session !== undefined && !saved) throw new Error('This saved session no longer belongs to the selected project. Refresh and choose it again.');
  const helperPath = await core.resolveTerminalHelper({ directory: path.join(core.defaultStateDirectory, 'native') });
  active = { id: 'ide-' + randomUUID(), status: 'starting', project: project ?? null,
    session: saved?.directory ?? null, startedAt: new Date().toISOString(), identity: Promise.resolve(null) };
  active.ready = new Promise(resolve => { active.resolveReady = resolve; });
  await acquireLease(options.storagePath);
  if (parentEnded) { active.status = 'stopped'; await saveReceipt(); await releaseLease(); throw new Error('The editor disconnected before Koto started.'); }
  const cliPath = path.join(CORE, 'bin', 'koto.js');
  const args = [cliPath, 'start'];
  if (project) args.push('--project', project);
  if (saved) args.push('--session', saved.directory);
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  if (process.platform !== 'win32') env.PATH = [...new Set([...(env.PATH ?? '/usr/bin:/bin').split(path.delimiter),
    path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'])].join(path.delimiter);
  announce();
  active.handle = startTerminalCommand({ id: 'kotoIde', command: process.execPath, args,
    cwd: project ?? os.homedir(), env, columns: options.cols ?? 100, rows: options.rows ?? 30,
    helperPath, timeoutMs: 3_600_000, onEvent(event) {
      if (event.type === 'started') {
        active.status = 'running';
        active.identity = processIdentity(event.pid);
        active.resolveReady();
        announce();
        void saveReceipt().catch(() => { active.error = 'The IDE ownership receipt could not be saved.'; void stop(); });
      } else if (event.type === 'output') emit({ type: 'output', text: event.text });
    } });
  finishing = active.handle.completion.then(async outcome => {
    active.resolveReady();
    active.outcome = outcome;
    const ordinary = Number.isInteger(outcome.exitCode) && !outcome.signal && !active.forcedStop
      && (!outcome.error || outcome.error === 'exit_failed');
    const confirmed = outcome.error !== 'cleanup_unconfirmed' && ordinary && outcome.exitCode !== 74;
    active.status = !confirmed ? 'cleanup_unconfirmed'
      : active.stopRequested && [0, 130].includes(outcome.exitCode) ? 'stopped'
        : outcome.status === 'failed' ? 'failed' : 'stopped';
    if (!confirmed) active.error ??= 'The CLI did not confirm its nested cleanup. Inspect the retained Koto session before restarting.';
    await saveReceipt();
    if (confirmed) await releaseLease();
    announce();
    emit({ type: 'completion', outcome: { ...outcome, status: active.status, cleanupConfirmed: confirmed,
      ...(active.error ? { message: active.error } : {}), receiptFile } });
    process.exitCode = confirmed ? 0 : 74;
    process.stdin.pause();
    process.stdin.destroy();
  }).catch(async error => {
    active.status = 'cleanup_unconfirmed'; active.error = error.message;
    await saveReceipt().catch(() => {}); announce();
    emit({ type: 'completion', outcome: { status: 'cleanup_unconfirmed', cleanupConfirmed: false, message: error.message, receiptFile } });
    process.exitCode = 74; process.stdin.destroy();
  });
  if (parentEnded) void stop('The editor disconnected.');
}

async function initialize() {
  const metadata = JSON.parse(await fs.readFile(path.join(CORE, 'package.json'), 'utf8'));
  if (metadata.name !== '@mehrdadz/koto' || metadata.version !== '3.0.0-alpha.1') throw new Error('The IDE bundle does not contain its pinned Koto core. Reinstall the extension.');
  coreVersion = metadata.version;
  core = await import(pathToFileURL(path.join(CORE, 'src', 'index.js')).href);
  ({ startTerminalCommand } = await import(pathToFileURL(path.join(CORE, 'src', 'terminal-session.js')).href));
}
async function main() {
  if (!['snapshot', 'helper', 'terminal'].includes(MODE)) throw new Error('Unknown IDE runner operation.');
  await initialize();
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let started = false;
  let queue = Promise.resolve();
  let queued = 0;
  const startup = setTimeout(() => { emit({ type: 'error', message: 'The IDE did not send a launch request.' }); process.exitCode = 2; process.stdin.destroy(); }, 10_000);
  startup.unref();
  process.stdin.on('data', chunk => {
    buffer += decoder.write(chunk);
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line) continue;
      if (Buffer.byteLength(line) > INPUT_LIMIT) {
        parentEnded = true; process.stdin.destroy();
        void stop('An IDE input frame exceeded its bound.');
        break;
      }
      if (++queued > 128) {
        parentEnded = true; process.stdin.destroy();
        void stop('The IDE input queue exceeded its bound.');
        break;
      }
      queue = queue.then(async () => {
        const value = JSON.parse(line);
        if (!started) {
          started = true; clearTimeout(startup);
          if (MODE === 'terminal') { await open(value); return; }
          if (parentEnded) throw new Error('The editor disconnected before this operation started.');
          exact(value, ['projects']);
          if (MODE === 'helper') await core.buildTerminalHelper({ directory: path.join(core.defaultStateDirectory, 'native') });
          emit({ type: 'result', value: await snapshot(value.projects ?? []) });
          process.stdin.destroy(); return;
        }
        if (MODE !== 'terminal') throw new Error('This runner takes one request.');
        exact(value, ['type', 'text', 'cols', 'rows']);
        if (value.type === 'stop') { void stop(); return; }
        if (active.stopRequested || active.outcome) return;
        if (value.type === 'input' && typeof value.text === 'string' && Buffer.byteLength(value.text) <= INPUT_LIMIT && !value.text.includes('\0')) {
          if (!active.handle.send(value.text)) throw new Error('The Koto terminal could not accept input.');
        } else if (value.type === 'resize' && dimension(value.cols) && dimension(value.rows)) active.handle.resize(value.cols, value.rows);
        else throw new Error('Invalid terminal control.');
      }).catch(async error => {
        emit({ type: 'error', message: error.message });
        if (active?.handle) await stop(error.message);
        else {
          if (lease) { active.status = 'stopped'; await saveReceipt().catch(() => {}); await releaseLease().catch(() => {}); }
          emit({ type: 'completion', outcome: { status: 'failed', cleanupConfirmed: true, message: error.message } });
          process.exitCode = 0; process.stdin.destroy();
        }
      }).finally(() => { queued--; });
    }
    if (Buffer.byteLength(buffer) > INPUT_LIMIT) {
      parentEnded = true; process.stdin.destroy();
      void stop('An IDE input frame exceeded its bound.');
    }
  });
  const parentClosed = () => {
    parentEnded = true; peerOpen = false; clearTimeout(startup);
    if (active?.handle && !active.outcome) void stop('The editor disconnected.').catch(() => {});
  };
  // A one-shot RPC deliberately closes request stdin while still reading its
  // response. Only a terminal's control-pipe EOF means its editor disconnected.
  process.stdin.on('end', () => { if (MODE === 'terminal') parentClosed(); });
  process.stdin.on('error', parentClosed);
  process.stdout.on('error', parentClosed);
  for (const signal of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? [] : ['SIGHUP'])]) process.on(signal, parentClosed);
}

main().catch(error => {
  emit({ type: 'error', message: error.message });
  // No terminal/helper was started during dependency validation. Keep that
  // prerequisite error distinct from an interrupted running CLI.
  if (!active?.handle && !lease) {
    emit({ type: 'completion', outcome: { status: 'failed', cleanupConfirmed: true, message: error.message } });
    process.exitCode = 0;
    process.stdin.destroy();
  } else {
    process.exitCode = 74;
    void stop(error.message).catch(() => {});
  }
});
