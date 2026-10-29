'use strict';

const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const QUEUE_LIMIT = 256 * 1024;
const FRAME_LIMIT = 256 * 1024;
const validPath = value => typeof value === 'string' && path.isAbsolute(value)
  && !value.includes('\0') && Buffer.byteLength(value) <= 4096;
const activeStatus = status => ['starting', 'running', 'stopping', 'cleanup_unconfirmed'].includes(status);

function environment(stateDirectory) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  if (stateDirectory !== undefined) env.KOTO_STATE_DIR = stateDirectory;
  return env;
}
function execute(command, args, options, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { ...options, windowsHide: true }, (error, stdout, stderr) => {
      if (error) { error.message = (stderr.trim() || error.message).slice(0, 2000); reject(error); }
      else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

class KotoClient extends EventEmitter {
  constructor({ extensionPath, storagePath, nodePath, stateDirectory } = {}) {
    super();
    if (!validPath(extensionPath) || !validPath(storagePath)
      || nodePath !== undefined && !validPath(nodePath)
      || stateDirectory !== undefined && !validPath(stateDirectory)) throw new Error('Koto needs absolute local paths from user settings.');
    this.extensionPath = extensionPath;
    this.storagePath = path.join(storagePath, 'terminal');
    this.nodePath = nodePath;
    this.stateDirectory = stateDirectory;
    this.runner = path.join(extensionPath, 'runner.mjs');
    this.env = environment(stateDirectory);
    this._state = { status: 'idle' };
    this._closing = false;
    this._startGeneration = 0;
    this._operations = new Set();
  }
  get state() { return { ...this._state }; }
  _setState(value) { this._state = { ...value }; this.emit('state', this.state); }
  async _node() {
    if (!this._nodePromise) this._nodePromise = (async () => {
      const defaults = process.platform === 'win32'
        ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')]
        : ['/opt/homebrew/opt/node@24/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
      const candidates = this.nodePath ? [this.nodePath]
        : [...defaults, ...(this.env.PATH || '').split(path.delimiter).filter(directory => directory && path.isAbsolute(directory))
          .map(directory => path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node'))];
      for (const candidate of [...new Set(candidates)]) {
        try {
          const canonical = await fs.realpath(candidate);
          if (!(await fs.stat(canonical)).isFile()) continue;
          const version = await execute(canonical, ['--version'], { env: this.env, timeout: 5000, maxBuffer: 4096 });
          const match = /^v(\d+)\.\d+\.\d+\s*$/.exec(version);
          if (match && Number(match[1]) >= 22) return canonical;
        } catch { /* An absent/older Node candidate is not the selected runtime. */ }
      }
      throw new Error('Koto needs Node.js 22 or newer. Install Node, or set Koto: Node Path in your user settings to its absolute executable path.');
    })();
    const pending = this._nodePromise;
    pending.catch(() => { if (this._nodePromise === pending) this._nodePromise = undefined; });
    return this._nodePromise;
  }
  async _request(mode, projects = []) {
    if (this._closing) throw new Error('Koto is closing.');
    const node = await this._node();
    if (this._closing) throw new Error('Koto closed before this operation started.');
    const operation = execute(node, [this.runner, mode], {
      cwd: this.extensionPath, env: this.env, timeout: mode === 'helper' ? 120_000 : 15_000,
      maxBuffer: 1024 * 1024, detached: process.platform !== 'win32',
    }, JSON.stringify({ projects }) + '\n').then(output => {
      const frames = output.split('\n').filter(Boolean).map(line => JSON.parse(line));
      const result = frames.find(frame => frame.type === 'result');
      if (!result) throw new Error(frames.find(frame => frame.type === 'error')?.message || 'Koto returned no state.');
      return result.value;
    });
    this._operations.add(operation);
    try { return await operation; } finally { this._operations.delete(operation); }
  }
  snapshot(projects = []) { return this._request('snapshot', projects); }
  buildHelper() {
    if (activeStatus(this._state.status)) return Promise.reject(new Error('Stop the current Koto CLI before setting up terminal support.'));
    return this._request('helper');
  }
  _send(frame) {
    const child = this._child;
    if (!child || child.stdin.destroyed || !child.stdin.writable) return false;
    const data = JSON.stringify(frame) + '\n';
    if (child.stdin.writableLength + Buffer.byteLength(data) > QUEUE_LIMIT) return false;
    child.stdin.write(data);
    return true;
  }
  write(text) {
    if (this._closing || !['starting', 'running'].includes(this._state.status)
      || typeof text !== 'string' || text.includes('\0') || Buffer.byteLength(text) > 64 * 1024) return false;
    const child = this._child;
    if (!child || child.stdin.destroyed || !child.stdin.writable) return false;
    // Small UTF-8 frames also bound the JSON expansion of terminal control
    // characters. Reserve the entire action before forwarding any of a paste.
    const bytes = Buffer.from(text);
    const decoder = new StringDecoder('utf8');
    const frames = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      const chunk = decoder.write(bytes.subarray(offset, offset + 8192));
      if (chunk) frames.push(JSON.stringify({ type: 'input', text: chunk }) + '\n');
    }
    const tail = decoder.end();
    if (tail) frames.push(JSON.stringify({ type: 'input', text: tail }) + '\n');
    if (child.stdin.writableLength + frames.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0) > QUEUE_LIMIT) return false;
    for (const frame of frames) child.stdin.write(frame);
    return true;
  }
  resize(cols, rows) {
    if (!['starting', 'running'].includes(this._state.status)
      || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 1000 || rows > 1000) return false;
    this._dimensions = { cols, rows };
    if (!this._resizeTimer) this._resizeTimer = setTimeout(() => {
      this._resizeTimer = undefined;
      if (this._dimensions && !this._closing) this._send({ type: 'resize', ...this._dimensions });
    }, 40);
    return true;
  }
  async start({ project, session, cols = 100, rows = 30 } = {}) {
    if (this._closing || activeStatus(this._state.status) || this._child) throw new Error('Stop the existing Koto terminal and confirm cleanup before opening another.');
    if (project !== undefined && !validPath(project)
      || session !== undefined && (typeof session !== 'string' || !/^[a-f0-9]{20}$/.test(session))
      || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 1000 || rows > 1000) throw new Error('Invalid Koto terminal options.');
    this._setState({ status: 'starting', project: project ?? null, session: session ?? null });
    const generation = ++this._startGeneration;
    let node;
    try { node = await this._node(); }
    catch (error) { this._setState({ status: 'failed', error: error.message }); throw error; }
    if (generation !== this._startGeneration) return;
    if (this._closing) { this._setState({ status: 'stopped' }); return; }
    // A detached transport survives extension-host shutdown long enough to stop
    // the CLI on control-pipe EOF and persist its real cleanup result. It has no
    // listening socket and never reconnects or replays a coding task.
    const child = spawn(node, [this.runner, 'terminal'], {
      cwd: this.extensionPath, env: this.env, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this._child = child;
    let final;
    let errorMessage;
    let buffer = '';
    let stderr = '';
    let settled = false;
    let readyResolve;
    let readyReject;
    const decoder = new StringDecoder('utf8');
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // Attach a rejection observer immediately; close may precede the caller's
    // await after a spawn failure.
    ready.catch(() => {});
    this._completion = new Promise(resolve => {
      const malformed = message => {
        errorMessage = message;
        this._setState({ ...this._state, status: 'cleanup_unconfirmed', error: message });
        child.stdin.end();
      };
      child.stdout.on('data', chunk => {
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > FRAME_LIMIT) { malformed('Koto IDE output exceeded its bounded frame.'); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line) continue;
          try {
            const frame = JSON.parse(line);
            if (frame.type === 'state' && frame.state && typeof frame.state.status === 'string') {
              this._setState(frame.state);
              if (frame.state.status === 'running') readyResolve();
            } else if (frame.type === 'output' && typeof frame.text === 'string') this.emit('output', frame.text);
            else if (frame.type === 'completion' && typeof frame.outcome?.cleanupConfirmed === 'boolean') final = frame.outcome;
            else if (frame.type === 'error' && typeof frame.message === 'string') errorMessage = frame.message;
            else malformed('Koto IDE returned an invalid transport message.');
          } catch { malformed('Koto IDE returned invalid transport JSON.'); }
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
      child.stdout.on('error', error => malformed(error.message));
      child.stderr.on('error', error => { errorMessage ||= error.message; });
      child.stdin.on('error', error => { errorMessage ||= error.message; });
      child.on('error', error => { errorMessage = error.message; readyReject(error); });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(this._resizeTimer); this._resizeTimer = undefined;
        this._child = undefined;
        const confirmed = final?.cleanupConfirmed === true && code === 0 && !signal;
        const outcome = confirmed ? final : {
          ...(final ?? {}), status: 'cleanup_unconfirmed', cleanupConfirmed: false,
          message: final?.message || errorMessage || stderr.trim() || 'The IDE runner exited without confirming nested CLI cleanup.',
        };
        this._setState({ ...this._state, status: outcome.status, ...(outcome.message ? { error: outcome.message } : {}) });
        this.emit('completion', outcome);
        if (this._state.status !== 'running') readyReject(new Error(outcome.message || errorMessage || 'Koto closed before the terminal became ready.'));
        resolve(outcome);
      });
    });
    const request = { project, session, cols, rows, storagePath: this.storagePath };
    if (!this._send(request)) { child.stdin.end(); throw new Error('The Koto runner could not receive its launch request.'); }
    let timer;
    try {
      await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Koto terminal startup exceeded its deadline.')), 15_000); })]);
    } catch (error) {
      child.stdin.end();
      throw error;
    } finally { clearTimeout(timer); }
  }
  async stop() {
    this._startGeneration++;
    clearTimeout(this._resizeTimer); this._resizeTimer = undefined;
    if (!this._child) {
      if (this._state.status === 'cleanup_unconfirmed') throw new Error(this._state.error || 'Koto cleanup is unconfirmed. Inspect its retained session.');
      if (this._state.status === 'starting') this._setState({ ...this._state, status: 'stopped' });
      return;
    }
    this._setState({ ...this._state, status: 'stopping' });
    if (!this._send({ type: 'stop' })) this._child.stdin.end();
    let timer;
    try {
      const result = await Promise.race([this._completion,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Koto cleanup is still unconfirmed; its bounded shutdown runner remains responsible for stopping the CLI.')), 60_000); })]);
      if (!result.cleanupConfirmed) throw new Error(result.message || 'Koto cleanup is unconfirmed. Inspect its retained session.');
    } finally { clearTimeout(timer); }
  }
  async dispose() {
    this._closing = true;
    try { await this.stop(); }
    finally {
      this._child?.stdin.end();
      await Promise.allSettled([...this._operations]);
      clearTimeout(this._resizeTimer);
    }
  }
}

module.exports = { KotoClient };
