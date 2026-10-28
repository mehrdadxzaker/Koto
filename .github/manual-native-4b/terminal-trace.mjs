// Explicit controls-only diagnosis. Every wrapped operation calls its original.
// This records real terminal behavior; it is not an acceptance verdict.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { syncBuiltinESMExports } from 'node:module';

if (process.platform !== 'win32' || process.arch !== 'x64'
  || process.env.GITHUB_ACTIONS !== 'true' || process.env.OBS_EXECUTION !== 'windows-actions'
  || process.env.OBS_OPERATION !== 'controls' || process.env.OBS_TERMINAL_TRACE !== '1') {
  throw new Error('explicit_windows_terminal_diagnosis_required');
}
const root = path.resolve(process.env.OBS_ROOT ?? '');
const expected = path.join(root, 'evidence', 'raw', 'windows-cli-control', 'evidence', 'terminal-trace.jsonl');
const target = process.env.KOTO_TERMINAL_TRACE_FILE;
if (!target || path.resolve(target).toLowerCase() !== expected.toLowerCase()
  || fs.realpathSync(path.dirname(target)).toLowerCase() !== path.dirname(expected).toLowerCase()) {
  throw new Error('private_terminal_trace_path_required');
}
const fd = fs.openSync(target, 'wx', 0o600);
let count = 0, total = 0, disabled = false, closed = false, nextInterface = 0;
const start = process.hrtime.bigint();
function errorFields(error) {
  try {
    const code = error?.code;
    return { name: typeof error?.name === 'string' ? error.name.slice(0, 80) : typeof error,
      codeType: typeof code,
      ...(typeof code === 'number' && Number.isFinite(code) ? { code } : {}),
      ...(typeof code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(code) ? { code } : {}),
      frames: typeof error?.stack === 'string' ? error.stack.split('\n').filter(line => /^\s*at\s/.test(line)).slice(0, 6).map(line => line.slice(-240)) : [] };
  } catch { return { opaque: true }; }
}
function state() {
  try {
    return { stdinRaw: process.stdin.isRaw === true, stdinDestroyed: process.stdin.destroyed === true,
      stdinEnded: process.stdin.readableEnded === true, stdinFlowing: process.stdin.readableFlowing,
      stdoutDestroyed: process.stdout.destroyed === true, stdoutEnded: process.stdout.writableEnded === true,
      columns: process.stdout.columns, rows: process.stdout.rows };
  } catch { return { stateUnavailable: true }; }
}
function record(operation, details = {}) {
  if (disabled || closed) return;
  try {
    const line = Buffer.from(JSON.stringify({ at: new Date().toISOString(),
      elapsedMs: Number(process.hrtime.bigint() - start) / 1e6, operation, ...details }) + '\n');
    if (++count > 512 || total + line.length > 128 * 1024) { disabled = true; return; }
    total += line.length;
    let offset = 0;
    while (offset < line.length) {
      const written = fs.writeSync(fd, line, offset, line.length - offset);
      if (written < 1) { disabled = true; return; }
      offset += written;
    }
  } catch { disabled = true; } // Trace failure must not replace product behavior.
}
record('trace_started', { node: process.version, pid: process.pid, ...state() });

const raw = process.stdin.setRawMode;
if (typeof raw === 'function') process.stdin.setRawMode = function (...args) {
  record('set_raw_begin', { requested: args[0], ...state() });
  try {
    const result = Reflect.apply(raw, this, args);
    record('set_raw_end', state());
    return result;
  } catch (error) { record('set_raw_error', errorFields(error)); throw error; }
};
const inputEmit = process.stdin.emit;
process.stdin.emit = function (event, ...args) {
  try {
    if (event === 'data') {
      const value = args[0];
      const bytes = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value) : undefined;
      if (bytes?.includes(0x1d)) record('detach_input', { bytes: bytes.length, ...state() });
    } else if (['end', 'close', 'error'].includes(event)) {
      record(`stdin_${event}`, { ...state(), ...(event === 'error' ? errorFields(args[0]) : {}) });
    }
  } catch { disabled = true; }
  return Reflect.apply(inputEmit, this, [event, ...args]);
};
for (const [name, stream] of [['stdout', process.stdout], ['stderr', process.stderr]]) {
  const emit = stream.emit;
  stream.emit = function (event, ...args) {
    if (event === 'error' || event === 'close') record(`${name}_${event}`,
      { ...state(), ...(event === 'error' ? errorFields(args[0]) : {}) });
    return Reflect.apply(emit, this, [event, ...args]);
  };
  const write = stream.write;
  stream.write = function (...args) {
    try {
      const value = args[0];
      const text = typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
      if (text.includes('\x1b[?1049') || text.includes('Returned to Koto controls.')) {
        record(`${name}_handoff_write`, { alternateBuffer: text.includes('\x1b[?1049'),
          returnMarker: text.includes('Returned to Koto controls.'), bytes: Buffer.byteLength(text) });
      }
    } catch { disabled = true; }
    try { return Reflect.apply(write, this, args); }
    catch (error) { record(`${name}_write_error`, errorFields(error)); throw error; }
  };
}

const createInterface = readline.createInterface;
readline.createInterface = function (...args) {
  const id = ++nextInterface;
  record('interface_create_begin', { id, ...state() });
  let terminal;
  try { terminal = Reflect.apply(createInterface, this, args); }
  catch (error) { record('interface_create_error', { id, ...errorFields(error) }); throw error; }
  record('interface_create_end', { id, terminal: terminal.terminal, closed: terminal.closed, ...state() });
  const emit = terminal.emit;
  terminal.emit = function (event, ...values) {
    if (['close', 'SIGINT', 'error'].includes(event)) record(`interface_${event}`,
      { id, closed: terminal.closed, ...state(), ...(event === 'error' ? errorFields(values[0]) : {}) });
    return Reflect.apply(emit, this, [event, ...values]);
  };
  for (const method of ['close', 'prompt', 'getCursorPos']) {
    const original = terminal[method];
    if (typeof original !== 'function') continue;
    terminal[method] = function (...values) {
      if (method === 'close') record('interface_close_call', { id, closed: terminal.closed, ...state() });
      try { return Reflect.apply(original, this, values); }
      catch (error) { record(`interface_${method}_error`, { id, ...errorFields(error) }); throw error; }
    };
  }
  return terminal;
};
syncBuiltinESMExports();

const abort = AbortController.prototype.abort;
AbortController.prototype.abort = function (...args) {
  try {
    const frames = new Error().stack?.split('\n').filter(line => /^\s*at\s/.test(line)).slice(0, 9).map(line => line.slice(-240)) ?? [];
    if (frames.some(line => /\/bin\/(?:koto|project|activity-view)\.js:/.test(line.replaceAll('\\', '/')))) {
      record('terminal_abort', { alreadyAborted: this.signal.aborted, frames, ...state() });
    }
  } catch { disabled = true; }
  return Reflect.apply(abort, this, args);
};

const processEmit = process.emit;
process.emit = function (event, ...args) {
  if (['SIGINT', 'SIGTERM', 'SIGBREAK'].includes(event)) record('process_signal', { event, ...state() });
  return Reflect.apply(processEmit, this, [event, ...args]);
};

process.on('uncaughtExceptionMonitor', (error, origin) => record('uncaught_exception_monitor',
  { origin, ...errorFields(error) })); // Monitoring does not suppress Node's exit.
process.once('exit', code => {
  record('process_exit', { code, ...state() });
  closed = true;
  try { fs.closeSync(fd); } catch { /* Process exit still owns descriptor cleanup. */ }
});
