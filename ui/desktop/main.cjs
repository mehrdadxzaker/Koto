'use strict';

const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const fs = require('node:fs/promises');
const { constants, lstatSync, realpathSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

app.setName('Koto');

// A launch-time override permits a fresh installed-product observation without
// borrowing the user's desktop history. It is never renderer-controlled.
if (process.env.KOTO_DESKTOP_DATA_DIR !== undefined) {
  const directory = process.env.KOTO_DESKTOP_DATA_DIR;
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')
    || Buffer.byteLength(directory) > 4096) throw new Error('Invalid private desktop data directory.');
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== path.resolve(directory)
    || process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) {
    throw new Error('Desktop data must use a canonical private directory owned by this account.');
  }
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
}

const MAX_TAIL_BYTES = 256 * 1024;
const MAX_UNACKED_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_PROJECTS = 20;
const MAX_STATE_BYTES = 128 * 1024;
const CORE_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'koto') : path.resolve(__dirname, '../..');
const APP_ICON = path.join(CORE_ROOT, 'assets/koto-logo.png');
const RENDERER_PATH = path.join(__dirname, 'dist/index.html');
const RENDERER_URL = pathToFileURL(RENDERER_PATH).href;
let window;
let core;
let startTerminalCommand;
let coreVersion;
let helper = { ready: false, message: 'Checking terminal support…' };
let projects = [];
let recentSessions = [];
let preferencesNotice;
let active;
let mutation = Promise.resolve();
let pendingMutations = 0;
let closing = false;
let allowQuit = false;

function errorMessage(error) {
  return typeof error?.message === 'string' ? error.message.slice(0, 500) : 'The desktop operation could not finish.';
}
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 4096) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value) <= max && !value.includes('\0');
const dimension = value => Number.isInteger(value) && value >= 2 && value <= 1000;

function emit(event) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  try { window.webContents.send('koto:event', event); return true; }
  catch { return false; }
}
function state() {
  return {
    appVersion: app.getVersion(), coreVersion, platform: process.platform,
    projects: projects.map(project => ({ ...project })),
    recentSessions: recentSessions.map(saved => ({ ...saved })),
    active: active ? {
      id: active.id, project: active.project, session: active.session,
      status: active.status, pid: active.handle?.pid ?? null,
      tail: active.tail, sequence: active.sequence,
      ...(active.error ? { error: active.error } : {}),
      ...(active.outcome ? { outcome: { ...active.outcome } } : {}),
    } : null,
    helper: { ...helper },
    ...(preferencesNotice ? { notice: preferencesNotice } : {}),
  };
}
function announce() { emit({ type: 'state', state: state() }); }
function serial(operation, { duringShutdown = false } = {}) {
  if (!duringShutdown && (closing || allowQuit)) return Promise.reject(new Error('Koto is closing; no new operation can start.'));
  if (!duringShutdown && pendingMutations >= 8) return Promise.reject(new Error('Koto is finishing pending desktop operations. Please wait.'));
  pendingMutations += 1;
  const result = mutation.then(() => {
    if (!duringShutdown && (closing || allowQuit)) throw new Error('Koto is closing; no new operation can start.');
    return operation();
  }).finally(() => { pendingMutations -= 1; });
  mutation = result.catch(() => {});
  return result;
}
function assertTrusted(event) {
  if (!window || event.sender !== window.webContents
    || event.senderFrame !== window.webContents.mainFrame
    || event.senderFrame.url !== RENDERER_URL) throw new Error('Untrusted desktop request.');
}
function noPayload(value) {
  if (value !== undefined) throw new TypeError('This desktop operation takes no arguments.');
}
function exactKeys(value, allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError('Invalid desktop request.');
}
function desktopFile() { return path.join(app.getPath('userData'), 'projects.json'); }
async function canonicalDirectory(directory) {
  if (!text(directory) || !path.isAbsolute(directory)) throw new Error('Choose an absolute project directory.');
  const canonical = await fs.realpath(directory);
  if (!(await fs.stat(canonical)).isDirectory()) throw new Error('The selected project is not a directory.');
  return canonical;
}
async function loadDesktopProjects() {
  let file;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
      | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK);
    file = await fs.open(desktopFile(), flags);
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_STATE_BYTES
      || process.platform !== 'win32' && ((info.mode & 0o777) !== 0o600 || info.uid !== process.getuid())) throw new Error('Invalid desktop project history.');
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (offset > MAX_STATE_BYTES || offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
      throw new Error('Desktop project history changed while reading it.');
    }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)));
    if (!Array.isArray(parsed) || parsed.length > MAX_PROJECTS
      || !parsed.every(item => text(item.path))) throw new Error('Invalid desktop project history.');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    preferencesNotice = 'Desktop project history needs attention. Native Koto preferences have not been changed.';
    return [];
  } finally { await file?.close(); }
}
async function saveDesktopProjects() {
  const directory = app.getPath('userData');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, '.projects-' + randomUUID() + '.json');
  try {
    await fs.writeFile(temporary, JSON.stringify(projects.map(({ path: project }) => ({ path: project }))) + '\n',
      { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, desktopFile());
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function refresh() {
  preferencesNotice = undefined;
  const stored = await loadDesktopProjects();
  let preferences;
  try { preferences = await core.loadPreferences(); }
  catch {
    preferencesNotice = 'Saved Koto setup needs recovery. Open the CLI to preserve a backup and recover it.';
    preferences = { recentSessions: [] };
  }
  const candidates = [preferences.project, ...stored.map(item => item.path),
    ...(preferences.recentSessions ?? []).map(item => item.project)].filter(Boolean);
  const next = [];
  for (const candidate of candidates.slice(0, 41)) {
    try {
      const canonical = await canonicalDirectory(candidate);
      if (!next.some(item => item.path === canonical)) next.push({ id: idFor(canonical), name: path.basename(canonical), path: canonical });
    } catch { /* Missing project shortcuts never become fabricated projects. */ }
    if (next.length === MAX_PROJECTS) break;
  }
  projects = next;
  recentSessions = [];
  for (const saved of (preferences.recentSessions ?? []).slice(0, 20)) {
    try {
      const snapshot = core.readProjectSession(saved.directory);
      const project = projects.find(item => item.path === saved.project);
      if (!project) continue;
      recentSessions.push({
        id: idFor(saved.directory), directory: saved.directory, project: project.path,
        goal: typeof saved.goal === 'string' ? saved.goal.slice(0, 4096) : '',
        savedAt: saved.savedAt, active: snapshot.active === true,
      });
    } catch { /* A missing or invalid retained record is not a selectable session. */ }
  }
  try {
    await core.resolveTerminalHelper({ directory: path.join(core.defaultStateDirectory, 'native') });
    helper = { ready: true };
  } catch { helper = { ready: false, message: 'Build terminal support once with the host’s installed developer tools.' }; }
  announce();
  return state();
}

async function processIdentity(pid) {
  if (process.platform === 'win32' || !Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const { stdout } = await runFile('/bin/ps', ['-p', String(pid), '-o', 'pid=,lstart=,command='],
      { timeout: 2000, maxBuffer: 16 * 1024 });
    const identity = stdout.trim();
    return identity.startsWith(String(pid) + ' ') && identity.includes(path.join(CORE_ROOT, 'bin/koto.js')) ? identity : null;
  } catch { return null; }
}
function waitForCompletion(owned, milliseconds) {
  let timer;
  return Promise.race([
    owned.handle.completion.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}
async function stopActive() {
  const owned = active;
  if (!owned || ['stopped', 'failed'].includes(owned.status)) return state();
  if (owned.status === 'cleanup_unconfirmed') throw new Error('Cleanup is unconfirmed. Inspect the retained CLI process before restarting Koto.');
  owned.stopRequested = true;
  owned.status = 'stopping';
  announce();
  const identity = await owned.identity;
  if (active === owned && !owned.outcome && identity
    && identity === await processIdentity(owned.handle.pid)) {
    // Signal only the same birth/command identity captured for this helper-owned
    // CLI. Its signal handler first closes Koto's own coordinators and workers.
    try { process.kill(owned.handle.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') owned.error = 'The CLI could not receive its graceful shutdown signal.'; }
    await waitForCompletion(owned, 12_000);
  }
  if (!owned.outcome) {
    owned.forcedStop = true;
    owned.handle.stop();
    await owned.handle.completion;
  }
  if (owned.status === 'cleanup_unconfirmed') throw new Error('Cleanup could not be confirmed. Koto remains open so you can inspect the owned work.');
  return state();
}
function captureOutput(owned, data) {
  if (active !== owned || typeof data !== 'string') return;
  const bytes = Buffer.byteLength(data);
  owned.sequence += 1;
  owned.tail = Buffer.from(owned.tail + data).subarray(-MAX_TAIL_BYTES).toString('utf8');
  if (owned.pendingBytes + bytes > MAX_UNACKED_BYTES || owned.pending.size >= 256) {
    if (!owned.outputOverflow) {
      owned.outputOverflow = true;
      owned.error = 'desktop_output_overflow: terminal output exceeded the bounded renderer queue; the CLI was stopped.';
      emit({ type: 'error', message: owned.error });
      // Do not keep accepting or dropping an unbounded ANSI stream.
      owned.forcedStop = true;
      owned.handle?.stop();
      announce();
    }
    return;
  }
  owned.pending.set(owned.sequence, bytes);
  owned.pendingBytes += bytes;
  if (!emit({ type: 'output', id: owned.id, data, sequence: owned.sequence })) {
    owned.error = 'The terminal view disconnected; its owned CLI was stopped.';
    owned.forcedStop = true;
    owned.handle?.stop();
  }
}
async function start(options = {}) {
  if (closing || allowQuit) throw new Error('Koto is closing; a CLI cannot start.');
  exactKeys(options, ['projectId', 'sessionId', 'cols', 'rows', 'animation']);
  if (options.projectId !== undefined && !text(options.projectId, 20)
    || options.sessionId !== undefined && !text(options.sessionId, 20)
    || options.cols !== undefined && !dimension(options.cols)
    || options.rows !== undefined && !dimension(options.rows)
    || options.animation !== undefined && typeof options.animation !== 'boolean') throw new TypeError('Invalid terminal launch options.');
  if (active?.status === 'cleanup_unconfirmed') throw new Error('Cleanup is unconfirmed; a replacement CLI cannot start.');
  await refresh();
  const project = options.projectId === undefined ? undefined : projects.find(item => item.id === options.projectId);
  if (options.projectId !== undefined && !project) throw new Error('This project is no longer available. Choose it again.');
  const saved = options.sessionId === undefined ? undefined : recentSessions.find(item => item.id === options.sessionId && item.project === project?.path);
  if (options.sessionId !== undefined && !saved) throw new Error('This retained session is no longer available for the selected project.');
  if (active && ['starting', 'running', 'stopping'].includes(active.status)) {
    const answer = await dialog.showMessageBox(window, {
      type: 'question', buttons: ['Keep current CLI', 'Stop and switch'], defaultId: 0, cancelId: 0,
      message: 'Stop the current Koto CLI and switch?',
      detail: 'Koto will stop its owned work and retain the session before opening the selected project.',
    });
    if (answer.response !== 1) return state();
    await stopActive();
  }
  const helperPath = await core.resolveTerminalHelper({ directory: path.join(core.defaultStateDirectory, 'native') });
  const cliPath = path.join(CORE_ROOT, 'bin/koto.js');
  const args = [cliPath, 'start'];
  if (project) args.push('--project', project.path);
  if (saved) args.push('--session', saved.directory);
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
  env.ELECTRON_RUN_AS_NODE = '1';
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  if (options.animation === false) env.KOTO_NO_ANIMATION = '1';
  const extraPaths = [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  if (process.platform !== 'win32') env.PATH = [...new Set([...(env.PATH ?? '/usr/bin:/bin').split(path.delimiter), ...extraPaths])].join(path.delimiter);
  const owned = {
    id: 'desktop-' + randomUUID(), project: project?.path ?? null, session: saved?.directory ?? null,
    status: 'starting', tail: '', sequence: 0, pending: new Map(), pendingBytes: 0, identity: Promise.resolve(null),
  };
  active = owned;
  announce();
  owned.handle = startTerminalCommand({
    id: 'desktop', command: process.execPath, args,
    cwd: project?.path ?? os.homedir(), env,
    columns: options.cols ?? 100, rows: options.rows ?? 30, helperPath, timeoutMs: 3_600_000,
    onEvent(event) {
      if (active !== owned) return;
      if (event.type === 'output') captureOutput(owned, event.text);
      else if (event.type === 'started') {
        owned.status = 'running';
        owned.identity = processIdentity(event.pid);
        announce();
      }
    },
  });
  owned.handle.completion.then(outcome => {
    owned.outcome = outcome;
    // The outer helper proves its own workload cleanup. A CLI-specific exit
    // or an interrupted CLI cannot prove cleanup of its nested native work.
    const ordinaryExit = Number.isInteger(outcome.exitCode) && !outcome.signal
      && !owned.forcedStop && (!outcome.error || outcome.error === 'exit_failed');
    const nestedCleanupUnconfirmed = outcome.exitCode === 74 || !ordinaryExit;
    const requestedStopCompleted = owned.stopRequested && [0, 130].includes(outcome.exitCode)
      && ordinaryExit && !owned.outputOverflow;
    owned.status = outcome.error === 'cleanup_unconfirmed' || nestedCleanupUnconfirmed ? 'cleanup_unconfirmed'
      : requestedStopCompleted ? 'stopped'
        : owned.outputOverflow || outcome.status === 'failed' ? 'failed' : 'stopped';
    if (nestedCleanupUnconfirmed) owned.error = owned.error
      ?? 'The CLI did not confirm cleanup of its nested native work. Inspect its retained sessions before restarting.';
    else if (outcome.error && !(requestedStopCompleted && outcome.error === 'exit_failed')) owned.error = owned.error ?? outcome.error;
    owned.pending.clear();
    owned.pendingBytes = 0;
    announce();
  }).catch(() => {
    owned.status = 'cleanup_unconfirmed';
    owned.error = 'CLI cleanup could not be confirmed.';
    announce();
  });
  return state();
}

function registerHandlers() {
  const handlers = {
    state: value => { noPayload(value); return state(); },
    refresh: value => { noPayload(value); return serial(refresh); },
    'choose-project': value => serial(async () => {
      noPayload(value);
      const result = await dialog.showOpenDialog(window, { title: 'Choose a Koto project', properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return state();
      const canonical = await canonicalDirectory(result.filePaths[0]);
      projects = [{ id: idFor(canonical), name: path.basename(canonical), path: canonical },
        ...projects.filter(item => item.path !== canonical)].slice(0, MAX_PROJECTS);
      await saveDesktopProjects();
      announce();
      return { ...state(), chosenProjectId: idFor(canonical) };
    }),
    start: value => serial(() => start(value)),
    stop: value => { noPayload(value); return serial(stopActive); },
    'build-helper': value => serial(async () => {
      noPayload(value);
      if (active && !['stopped', 'failed'].includes(active.status)) throw new Error('Stop the current CLI before building terminal support.');
      await core.buildTerminalHelper({ directory: path.join(core.defaultStateDirectory, 'native') });
      return refresh();
    }),
    write: value => {
      exactKeys(value, ['id', 'data']);
      if (closing || allowQuit || !active || value.id !== active.id || !['starting', 'running'].includes(active.status)
        || typeof value.data !== 'string' || Buffer.byteLength(value.data) > MAX_INPUT_BYTES) return false;
      return active.handle?.send(value.data) ?? false;
    },
    resize: value => {
      exactKeys(value, ['id', 'cols', 'rows']);
      if (!active || value.id !== active.id || !dimension(value.cols) || !dimension(value.rows)) return false;
      return active.handle?.resize(value.cols, value.rows) ?? false;
    },
    ack: value => {
      exactKeys(value, ['id', 'sequence']);
      if (!active || value.id !== active.id || !Number.isSafeInteger(value.sequence)
        || value.sequence < 0 || value.sequence > active.sequence) return false;
      for (const [sequence, bytes] of active.pending) {
        if (sequence <= value.sequence) { active.pending.delete(sequence); active.pendingBytes -= bytes; }
      }
      return true;
    },
  };
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle('koto:' + name, async (event, value) => {
      assertTrusted(event);
      try { return await handler(value); }
      catch (error) {
        emit({ type: 'error', message: errorMessage(error) });
        throw new Error(errorMessage(error));
      }
    });
  }
}
async function closeApplication() {
  if (closing || allowQuit) return;
  closing = true;
  try {
    await mutation;
    await stopActive();
    allowQuit = true;
    app.quit();
  } catch (error) {
    closing = false;
    if (window && !window.isDestroyed()) {
      await dialog.showMessageBox(window, {
        type: 'error', message: 'Koto could not confirm cleanup.',
        detail: errorMessage(error) + ' The window remains open; no replacement CLI will be started.',
      });
    }
  }
}
async function createWindow() {
  window = new BrowserWindow({
    title: 'Koto', icon: APP_ICON, width: 1440, height: 960, minWidth: 760, minHeight: 520,
    backgroundColor: '#101316', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== RENDERER_URL) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => {
    void serial(stopActive, { duringShutdown: true }).catch(error => { preferencesNotice = errorMessage(error); });
  });
  window.on('close', event => {
    if (!allowQuit) { event.preventDefault(); void closeApplication(); }
  });
  await window.loadFile(RENDERER_PATH);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { window.show(); window.focus(); } });
  app.on('before-quit', event => {
    if (!allowQuit) { event.preventDefault(); void closeApplication(); }
  });
  app.whenReady().then(async () => {
    const metadata = JSON.parse(await fs.readFile(path.join(CORE_ROOT, 'package.json'), 'utf8'));
    coreVersion = metadata.version;
    if (process.platform === 'darwin') app.dock.setIcon(APP_ICON);
    core = await import(pathToFileURL(path.join(CORE_ROOT, 'src/index.js')).href);
    ({ startTerminalCommand } = await import(pathToFileURL(path.join(CORE_ROOT, 'src/terminal-session.js')).href));
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerHandlers();
    await refresh();
    await createWindow();
  }).catch(async error => {
    await dialog.showMessageBox({ type: 'error', message: 'Koto could not open.', detail: errorMessage(error) });
    allowQuit = true;
    app.quit();
  });
}
