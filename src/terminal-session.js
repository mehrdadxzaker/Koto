import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { TextDecoder } from 'node:util';

const OUTPUT_LIMIT = 8 * 1024 * 1024;
const DIAGNOSTIC_LIMIT = 64 * 1024;
const STATUS_LIMIT = 16 * 1024;
const STATUS_LINE_LIMIT = 4096;
const DATA_LIMIT = 64 * 1024;
const CONTROL_QUEUE_LIMIT = 256 * 1024;
const PENDING_LIMIT = 64;
const TEXT_UNITS = 4096;
const HELPER_TERM_MS = 2_000;
const HELPER_KILL_MS = 4_000;
const FORCE_FINISH_MS = 4_500;
const validString = value => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const dimension = value => Number.isInteger(value) && value >= 1
  && value <= (process.platform === 'win32' ? 32_767 : 65_535);
const identity = value => Number.isSafeInteger(value) && value > 0;
const HELPER_REASONS = new Set([
  'stopped', 'control_eof', 'invalid_control', 'host_signal', 'host_gone',
  'output_failed', 'output_stalled', 'status_failed', 'status_stalled', 'pty_failed', 'input_overflow',
  'eof_unavailable', 'child_setup_failed', 'session_inspection_failed', 'cleanup_timeout',
]);
const EXPECTED_STOP_REASONS = new Set(['stopped', 'host_signal']);

/** Transport for the locally built, caller-approved platform helper.
 * POSIX fd 3 or Windows stderr carries helper lifecycle records; native terminal
 * bytes remain uninterpreted. Windows also supports owned pipe commands.
 * Only a matching ready/complete identity can confirm workload cleanup. Killing
 * the helper process group alone never establishes that its PTY workload ended.
 */
export function startTerminalCommand({ id, command, args = [], cwd, env,
  timeoutMs = 900_000, onEvent, signal, columns = 80, rows = 24, helperPath, transport = 'pty' } = {}) {
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('terminal_platform_unsupported');
  const windows = process.platform === 'win32';
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)
    || !validString(command) || Buffer.byteLength(command) > 4096
    || !validString(helperPath) || !isAbsolute(helperPath) || Buffer.byteLength(helperPath) > 4096
    || !Array.isArray(args) || args.length > 128
    || args.some(value => typeof value !== 'string' || value.includes('\0')
      || Buffer.byteLength(value) > 16_384)
    || (cwd !== undefined && !validString(cwd))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000
    || !dimension(columns) || !dimension(rows) || !['pipe', 'pty'].includes(transport)
    || (transport === 'pipe' && !windows)
    || (onEvent !== undefined && typeof onEvent !== 'function')
    || (signal !== undefined && !(signal instanceof AbortSignal))
    || (env !== undefined && (!env || typeof env !== 'object' || Array.isArray(env)
      || Object.entries(env).some(([key, value]) => !validString(key)
        || typeof value !== 'string' || value.includes('\0'))))) {
    throw new TypeError('Invalid terminal session configuration');
  }

  let settle;
  const completion = new Promise(resolve => { settle = resolve; });
  let child;
  let ready;
  let final;
  let finished = false;
  let closed = false;
  let helperExited = false;
  let helperSpawned = false;
  let helperExitCode = null;
  let helperExitSignal;
  let spawnFailed = false;
  let cancelled = false;
  let failure;
  let stopping = false;
  let inputEnded = false;
  let protocolInvalid = false;
  let outputBytes = 0;
  let diagnosticBytes = 0;
  let diagnosticAnnounced = false;
  let statusBytes = 0;
  let statusBuffer = Buffer.alloc(0);
  let pendingControls = 0;
  let pendingEvents = 0;
  let deadlineTimer;
  let termTimer;
  let killTimer;
  let finishTimer;
  const outputDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');

  const clearTimers = () => {
    clearTimeout(deadlineTimer);
    clearTimeout(termTimer);
    clearTimeout(killTimer);
    clearTimeout(finishTimer);
  };

  const finish = (forced = false) => {
    if (finished || (!closed && !forced)) return;
    finished = true;
    clearTimers();
    signal?.removeEventListener('abort', onAbort);
    if (forced && child) {
      // Error listeners remain installed for errors from late stream closure.
      for (const stream of child.stdio) stream?.destroy();
      child.unref();
    }
    const confirmed = !forced && ready && final && !protocolInvalid && final.cleanup === 'confirmed'
      && final.pid === ready.pid && final.sessionId === ready.sessionId;
    // No helper was spawned in these two cases, hence no workload was started.
    const noWorkload = (!child && cancelled) || (spawnFailed && !helperSpawned);
    let error = (!confirmed && !noWorkload) ? 'cleanup_unconfirmed' : failure;
    if (!error && final?.reason && !(cancelled && EXPECTED_STOP_REASONS.has(final.reason))) {
      error = final.reason;
    }
    if (!error && !cancelled && (helperExitCode !== 0 || helperExitSignal)) error = 'helper_failed';
    if (!error && !cancelled && final?.exitCode !== 0) error = 'exit_failed';
    settle({
      status: cancelled ? 'cancelled' : error ? 'failed' : 'succeeded',
      exitCode: final?.exitCode ?? null,
      ...(final?.signal ? { signal: final.signal } : {}),
      ...(error ? { error } : {}),
    });
  };

  const signalHelper = name => {
    if (!child?.pid || helperExited) return;
    try { if (windows) child.kill(name); else process.kill(-child.pid, name); }
    catch (error) {
      if (error.code !== 'ESRCH') {
        try { child.kill(name); } catch { /* A missing final remains unconfirmed. */ }
      }
    }
  };

  const writeFrame = (opcode, payload = Buffer.alloc(0), priority = false) => {
    if (finished || helperExited || !child || child.stdin.destroyed
      || !child.stdin.writable || child.stdin.writableEnded) return false;
    const bytes = payload.byteLength + 5;
    if ((!priority && (stopping || final || pendingControls >= PENDING_LIMIT
      || child.stdin.writableLength + bytes > CONTROL_QUEUE_LIMIT))
      || child.stdin.writableLength + bytes > CONTROL_QUEUE_LIMIT + 64) return false;
    const frame = Buffer.allocUnsafe(bytes);
    frame[0] = opcode;
    frame.writeUInt32BE(payload.byteLength, 1);
    frame.set(payload, 5);
    pendingControls += 1;
    try {
      child.stdin.write(frame, error => {
        pendingControls -= 1;
        if (error && !final) fail('control_failed');
      });
      return true;
    } catch {
      pendingControls -= 1;
      if (!final) fail('control_failed');
      return false;
    }
  };

  const beginStop = () => {
    if (stopping || finished) return;
    stopping = true;
    clearTimeout(deadlineTimer);
    // One reserved small frame can request cleanup even with a full data queue.
    writeFrame(3, Buffer.alloc(0), true);
    termTimer = setTimeout(() => signalHelper('SIGTERM'), HELPER_TERM_MS);
    killTimer = setTimeout(() => signalHelper('SIGKILL'), HELPER_KILL_MS);
    finishTimer = setTimeout(() => {
      signalHelper('SIGKILL');
      finish(true);
    }, FORCE_FINISH_MS);
  };

  const fail = code => {
    if (finished) return;
    failure ??= code;
    beginStop();
  };

  const emit = event => {
    if (!onEvent || finished) return;
    if (pendingEvents >= PENDING_LIMIT) { fail('event_queue_overflow'); return; }
    try {
      const result = onEvent(Object.freeze(event));
      if (result && typeof result.then === 'function') {
        pendingEvents += 1;
        Promise.resolve(result).then(
          () => { pendingEvents -= 1; },
          () => { pendingEvents -= 1; fail('observer_failed'); },
        );
      }
    } catch { fail('observer_failed'); }
  };

  const outputText = (text, stream = 'stdout') => {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + TEXT_UNITS, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      // Preserve native terminal controls. The UI decides how to render a PTY.
      emit({ type: 'output', agentId: id, stream, text: text.slice(start, end) });
      start = end;
      if (failure || cancelled || finished) break;
    }
  };

  const badStatus = () => { protocolInvalid = true; fail('helper_protocol_failed'); };
  const statusLine = bytes => {
    let record;
    try { record = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)); }
    catch { badStatus(); return; }
    if (!record || typeof record !== 'object' || Array.isArray(record)) { badStatus(); return; }
    if (windows && transport === 'pipe' && record.type === 'stderr') {
      if (Object.keys(record).some(key => !['type', 'data'].includes(key))
        || typeof record.data !== 'string' || record.data.length > 2732
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.data)) { badStatus(); return; }
      const bytes = Buffer.from(record.data, 'base64');
      if (bytes.length > 2048 || bytes.toString('base64') !== record.data) { badStatus(); return; }
      outputBytes += bytes.length;
      if (outputBytes > OUTPUT_LIMIT) { fail('output_limit'); return; }
      outputText(stderrDecoder.write(bytes), 'stderr');
      return;
    }
    if (record.type === 'ready') {
      if (ready || final || Object.keys(record).some(key => !['type', 'pid', 'sessionId', 'columns', 'rows'].includes(key))
        || !identity(record.pid) || record.sessionId !== record.pid
        || !dimension(record.columns) || !dimension(record.rows)) { badStatus(); return; }
      ready = record;
      emit({ type: 'started', agentId: id, pid: ready.pid, sessionId: ready.sessionId,
        transport, columns: ready.columns, rows: ready.rows });
      if (transport === 'pty') emit({ type: 'pty_ready', agentId: id, pid: ready.pid, sessionId: ready.sessionId,
        platform: process.platform, transport, columns: ready.columns, rows: ready.rows });
      return;
    }
    if (record.type !== 'complete' || final || !ready
      || Object.keys(record).some(key => !['type', 'pid', 'sessionId', 'exitCode', 'signal', 'cleanup', 'reason'].includes(key))
      || record.pid !== ready.pid || record.sessionId !== ready.sessionId
      || !(record.exitCode === null || (Number.isInteger(record.exitCode) && record.exitCode >= 0 && record.exitCode <= (windows ? 0xffffffff : 255)))
      || (record.signal !== undefined && record.signal !== null && !/^SIG[A-Z0-9]{1,16}$/.test(record.signal))
      || !['confirmed', 'unconfirmed'].includes(record.cleanup)
      || (record.reason !== undefined && !HELPER_REASONS.has(record.reason))) { badStatus(); return; }
    if ((record.exitCode === null && !record.signal && !record.reason)
      || (record.exitCode !== null && record.signal)) { badStatus(); return; }
    final = record;
    clearTimeout(deadlineTimer);
    // The final closes the workload lifecycle, but the helper/streams must also
    // end. Bound a helper that emits a final and then fails to close its handles.
    if (!stopping) {
      termTimer = setTimeout(() => signalHelper('SIGTERM'), HELPER_TERM_MS);
      killTimer = setTimeout(() => signalHelper('SIGKILL'), HELPER_KILL_MS);
      finishTimer = setTimeout(() => { signalHelper('SIGKILL'); finish(true); }, FORCE_FINISH_MS);
    }
  };

  const stop = () => {
    if (finished || final || cancelled || failure) return;
    cancelled = true;
    beginStop();
  };
  const onAbort = () => stop();
  const handle = {
    id,
    get pid() { return ready?.pid ?? null; },
    completion,
    send(data) {
      if (inputEnded || stopping || final || finished) return false;
      let payload;
      if (typeof data === 'string') {
        if (Buffer.byteLength(data) > DATA_LIMIT) return false;
        payload = Buffer.from(data);
      } else if (data instanceof Uint8Array) {
        if (data.byteLength > DATA_LIMIT) return false;
        payload = data;
      } else return false;
      return writeFrame(0, payload);
    },
    endInput() {
      if (inputEnded || stopping || final || finished) return false;
      const accepted = writeFrame(2);
      if (accepted) inputEnded = true;
      return accepted;
    },
    resize(nextColumns, nextRows) {
      if (transport !== 'pty') return false;
      if (!dimension(nextColumns) || !dimension(nextRows)) return false;
      const payload = Buffer.allocUnsafe(4);
      payload.writeUInt16BE(nextColumns, 0);
      payload.writeUInt16BE(nextRows, 2);
      return writeFrame(1, payload);
    },
    stop,
  };

  if (signal?.aborted) {
    cancelled = true;
    closed = true;
    finish();
    return handle;
  }
  try {
    child = spawn(helperPath, [...(windows ? ['--host-pid', String(process.pid), ...(transport === 'pipe' ? ['--pipe'] : [])] : []),
      '--cols', String(columns), '--rows', String(rows), '--',
      command === '$node' ? process.execPath : command, ...args], {
      cwd, ...(env === undefined ? {} : { env: { ...env } }),
      shell: false, detached: !windows, windowsHide: true,
      stdio: windows ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'pipe'],
    });
  } catch {
    spawnFailed = true;
    failure = 'spawn_failed';
    closed = true;
    finish();
    return handle;
  }
  child.once('spawn', () => { helperSpawned = true; });
  child.on('error', () => {
    if (!child.pid && !helperSpawned) spawnFailed = true;
    fail('spawn_failed');
  });
  child.stdin.on('error', () => { if (!final) fail('control_failed'); });
  child.stdout.on('error', () => fail('output_failed'));
  const metadata = windows ? child.stderr : child.stdio[3];
  if (!windows) child.stderr.on('error', () => fail('helper_diagnostic_failed'));
  metadata.on('error', badStatus);
  child.stdout.on('data', chunk => {
    if (finished || failure || cancelled) return;
    outputBytes += chunk.length;
    if (outputBytes > OUTPUT_LIMIT) { fail('output_limit'); return; }
    // Decode bounded pieces, without collecting the native transcript in memory.
    for (let start = 0; start < chunk.length; start += 16_384) {
      outputText(outputDecoder.write(chunk.subarray(start, start + 16_384)));
      if (failure || cancelled || finished) break;
    }
  });
  child.stdout.once('end', () => {
    if (!finished && !failure && !cancelled) outputText(outputDecoder.end());
  });
  if (!windows) child.stderr.on('data', chunk => {
    if (finished) return;
    diagnosticBytes += chunk.length;
    if (diagnosticBytes > DIAGNOSTIC_LIMIT) { fail('helper_diagnostic_limit'); return; }
    if (!diagnosticAnnounced && chunk.length) {
      diagnosticAnnounced = true;
      emit({ type: 'diagnostic', agentId: id, error: 'helper_diagnostic' });
    }
  });
  metadata.on('data', chunk => {
    if (finished || protocolInvalid) return;
    statusBytes += chunk.length;
    if (statusBytes > (windows && transport === 'pipe' ? OUTPUT_LIMIT * 2 + STATUS_LIMIT : STATUS_LIMIT)) { badStatus(); return; }
    statusBuffer = Buffer.concat([statusBuffer, chunk]);
    let newline;
    while ((newline = statusBuffer.indexOf(10)) !== -1) {
      if (newline === 0 || newline > STATUS_LINE_LIMIT) { badStatus(); return; }
      const line = statusBuffer.subarray(0, newline);
      statusBuffer = statusBuffer.subarray(newline + 1);
      statusLine(line);
      if (protocolInvalid || finished) return;
    }
    if (statusBuffer.length > STATUS_LINE_LIMIT) badStatus();
  });
  metadata.once('end', () => {
    if (windows && transport === 'pipe') outputText(stderrDecoder.end(), 'stderr');
    if (statusBuffer.length || !final) badStatus();
  });
  child.once('exit', (code, name) => {
    helperExited = true;
    helperExitCode = code;
    helperExitSignal = name;
    // fd3 data may still be draining; decide validity only after stream close.
    if (!stopping && !final) beginStop();
  });
  child.once('close', (code, name) => {
    closed = true;
    helperExitCode = code;
    helperExitSignal = name;
    finish();
  });
  deadlineTimer = setTimeout(() => fail('timeout'), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return handle;
}
