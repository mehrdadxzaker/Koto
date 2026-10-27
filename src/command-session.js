import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const EVENT_CHUNK_BYTES = 16 * 1024;
// UTF-8 replacement characters can expand malformed native bytes. Limiting
// decoded chunks by code units bounds each event below 16 KiB as UTF-8 too.
const EVENT_TEXT_UNITS = 4096;
const MAX_PENDING_EVENTS = 64;
const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_QUEUED_CONTROL_BYTES = 256 * 1024;
const CLEANUP_MS = 2_000;
const TERM_GRACE_MS = 250;
const validString = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0');

/** Start one explicitly configured native command over pipes, without a shell.
 * This preserves the command's own permissions and protocol; it provides no PTY,
 * provider parsing or containment of descendants that leave the owned group.
 * An explicit env replaces the inherited environment, as in child_process.spawn.
 */
export function startCommand({ id, command, args = [], cwd, env, timeoutMs = 900_000,
  onEvent, signal } = {}) {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)
    || !validString(command) || Buffer.byteLength(command) > 4096
    || /\.(?:cmd|bat)$/i.test(command)
    || !Array.isArray(args) || args.length > 128
    || args.some((value) => typeof value !== 'string' || value.includes('\0')
      || Buffer.byteLength(value) > 16_384)
    || (cwd !== undefined && !validString(cwd))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000
    || (onEvent !== undefined && typeof onEvent !== 'function')
    || (signal !== undefined && !(signal instanceof AbortSignal))
    || (env !== undefined && (!env || typeof env !== 'object' || Array.isArray(env)
      || Object.entries(env).some(([key, value]) => !validString(key)
        || typeof value !== 'string' || value.includes('\0'))))) {
    throw new TypeError('Invalid command session configuration');
  }

  let settle;
  const completion = new Promise((resolve) => { settle = resolve; });
  let child;
  let finished = false;
  let exited = false;
  let closed = false;
  let exitCode = null;
  let exitSignal;
  let reason;
  let cancelled = false;
  let cleanupStarted = false;
  let cleanupComplete = false;
  let cleanupUnconfirmed = false;
  let pendingEvents = 0;
  let pendingControls = 0;
  let inputEnded = false;
  let outputBytes = 0;
  let deadlineTimer;
  let termTimer;
  let cleanupTimer;
  let groupTimer;
  let taskkill;
  let taskkillTimer;
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };

  const clearTimers = () => {
    clearTimeout(deadlineTimer);
    clearTimeout(termTimer);
    clearTimeout(cleanupTimer);
    clearTimeout(taskkillTimer);
    clearInterval(groupTimer);
  };

  const finish = (force = false) => {
    if (finished || (!force && (!closed || !cleanupComplete))) return;
    finished = true;
    clearTimers();
    signal?.removeEventListener('abort', onAbort);
    // Keep stream error handlers for late errors after forced handle release.
    if (force && child) {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
    const error = cleanupUnconfirmed ? 'cleanup_unconfirmed'
      : reason ?? (cancelled || exitCode === 0 ? undefined : 'exit_failed');
    settle({
      status: cancelled ? 'cancelled' : error ? 'failed' : 'succeeded',
      exitCode,
      ...(exitSignal ? { signal: exitSignal } : {}),
      ...(error ? { error } : {}),
    });
  };

  const signalChild = (name) => {
    if (!child?.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, name);
      else if (child.exitCode === null && child.signalCode === null && !child.kill(name)) {
        cleanupUnconfirmed = true;
      }
    } catch (error) {
      if (error.code !== 'ESRCH') {
        cleanupUnconfirmed = true;
        try { child.kill(name); } catch { /* Preserve unconfirmed cleanup. */ }
      }
    }
  };

  const groupExists = () => {
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if (error.code !== 'ESRCH') cleanupUnconfirmed = true;
      return error.code !== 'ESRCH';
    }
  };

  const beginCleanup = () => {
    if (cleanupStarted || finished) return;
    cleanupStarted = true;
    clearTimeout(deadlineTimer);
    if (!child?.pid) {
      cleanupComplete = true;
      finish();
      return;
    }
    cleanupTimer = setTimeout(() => {
      if (!closed || !cleanupComplete) cleanupUnconfirmed = true;
      signalChild('SIGKILL');
      if (taskkill && taskkill.exitCode === null && taskkill.signalCode === null) {
        cleanupUnconfirmed = true;
        try { taskkill.kill('SIGKILL'); } catch { /* Fixed completion diagnostics only. */ }
        taskkill.unref();
      }
      finish(true);
    }, CLEANUP_MS);

    if (process.platform === 'win32') {
      // A departed parent cannot establish ownership of its former tree. A
      // normal exit establishes only direct-process completion on Windows;
      // retain that uncertainty so project integration cannot treat it as
      // confirmed owned-process cleanup.
      if (exited) {
        cleanupUnconfirmed = true;
        cleanupComplete = true;
        finish();
        return;
      }
      cleanupUnconfirmed = true;
      try {
        taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
          shell: false, windowsHide: true, stdio: 'ignore',
        });
        taskkill.on('error', () => { signalChild('SIGKILL'); });
        taskkill.once('close', () => {
          clearTimeout(taskkillTimer);
          cleanupComplete = true;
          finish();
        });
        taskkillTimer = setTimeout(() => {
          try { taskkill.kill('SIGKILL'); } catch { /* Cleanup remains unconfirmed. */ }
          signalChild('SIGKILL');
        }, 1_000);
      } catch {
        signalChild('SIGKILL');
      }
      return;
    }

    const checkGroup = () => {
      if (!groupExists()) {
        cleanupComplete = true;
        clearInterval(groupTimer);
        clearTimeout(termTimer);
        finish();
      }
    };
    signalChild('SIGTERM');
    termTimer = setTimeout(() => {
      signalChild('SIGKILL');
      checkGroup();
    }, TERM_GRACE_MS);
    groupTimer = setInterval(checkGroup, 25);
    checkGroup();
  };

  const fail = (code) => {
    if (finished) return;
    reason ??= code;
    beginCleanup();
  };

  const emit = (event) => {
    if (!onEvent || finished) return;
    if (pendingEvents >= MAX_PENDING_EVENTS) { fail('event_queue_overflow'); return; }
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

  const output = (stream, chunk) => {
    if (finished || reason || cancelled) return;
    outputBytes += chunk.length;
    if (outputBytes > MAX_OUTPUT_BYTES) { fail('output_limit'); return; }
    for (let offset = 0; offset < chunk.length; offset += EVENT_CHUNK_BYTES) {
      const text = decoders[stream].write(chunk.subarray(offset, offset + EVENT_CHUNK_BYTES));
      for (let start = 0; start < text.length;) {
        let end = Math.min(start + EVENT_TEXT_UNITS, text.length);
        // Keep a Unicode pair in one event, so terminal consumers can write
        // event text directly without corrupting a character at the boundary.
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
        emit({ type: 'output', agentId: id, stream, text: text.slice(start, end) });
        start = end;
        if (reason || cancelled || finished) break;
      }
      if (reason || cancelled || finished) break;
    }
  };

  const stop = () => {
    // An operator stop during failure cleanup must preserve the original
    // timeout/output/observer failure instead of relabeling it cancellation.
    if (finished || exited || cancelled || reason) return;
    cancelled = true;
    beginCleanup();
  };
  const onAbort = () => stop();
  const handle = {
    id,
    get pid() { return child?.pid ?? null; },
    completion,
    send(text) {
      if (finished || exited || cleanupStarted || inputEnded || !child || typeof text !== 'string'
        || child.stdin.destroyed || child.stdin.writableEnded || !child.stdin.writable) return false;
      const bytes = Buffer.byteLength(text);
      if (bytes === 0) return true;
      if (bytes > MAX_CONTROL_BYTES || pendingControls >= MAX_PENDING_EVENTS
        || child.stdin.writableLength + bytes > MAX_QUEUED_CONTROL_BYTES) {
        return false;
      }
      try {
        // write(false) still accepts the bytes; writableLength bounds the queue.
        pendingControls += 1;
        child.stdin.write(text, (error) => {
          pendingControls -= 1;
          if (error) fail('stdin_failed');
        });
        return true;
      } catch { pendingControls -= 1; fail('stdin_failed'); return false; }
    },
    endInput() {
      if (finished || exited || cleanupStarted || inputEnded || !child
        || child.stdin.destroyed || child.stdin.writableEnded || !child.stdin.writable) return false;
      inputEnded = true;
      try {
        child.stdin.end((error) => { if (error) fail('stdin_failed'); });
        return true;
      } catch { fail('stdin_failed'); return false; }
    },
    stop,
  };

  if (signal?.aborted) {
    cancelled = true;
    closed = true;
    cleanupComplete = true;
    finish();
    return handle;
  }
  try {
    child = spawn(command === '$node' ? process.execPath : command, [...args], {
      cwd, ...(env === undefined ? {} : { env: { ...env } }),
      shell: false, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    reason = 'spawn_failed';
    closed = true;
    cleanupComplete = true;
    finish();
    return handle;
  }

  child.on('error', () => fail('spawn_failed'));
  child.once('spawn', () => emit({ type: 'started', agentId: id, pid: handle.pid }));
  child.stdin.on('error', () => fail('stdin_failed'));
  child.stdout.on('error', () => fail('output_failed'));
  child.stderr.on('error', () => fail('output_failed'));
  child.stdout.on('data', (chunk) => output('stdout', chunk));
  child.stderr.on('data', (chunk) => output('stderr', chunk));
  child.once('exit', (code, name) => {
    exited = true;
    exitCode = code;
    exitSignal = name ?? undefined;
    beginCleanup();
  });
  child.once('close', (code, name) => {
    closed = true;
    exitCode = code;
    exitSignal = name ?? exitSignal;
    if (!reason && !cancelled) {
      for (const stream of ['stdout', 'stderr']) {
        const text = decoders[stream].end();
        if (text) emit({ type: 'output', agentId: id, stream, text });
      }
    }
    beginCleanup();
    finish();
  });
  deadlineTimer = setTimeout(() => fail('timeout'), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return handle;
}
