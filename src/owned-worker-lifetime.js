import { spawn } from 'node:child_process';

const MAX_PENDING_EVENTS = 64;

/** Private lifetime owner shared by process and native-helper adapters.
 * Adapters supply ownership evidence; closing a stream or killing a helper is
 * never evidence that its workload has stopped. Cleanup uncertainty is sticky.
 */
export function createOwnedWorkerLifetime({ timeoutMs, signal, cleanupMs,
  requestStop, escalations = [], forceStop, release, onEvent } = {}) {
  let resolve;
  const completion = new Promise(done => { resolve = done; });
  const timers = new Set();
  let deadlineTimer;
  let armed = false;
  let finished = false;
  let stopping = false;
  let closed = false;
  let ended = false;
  let cancelled = false;
  let failure;
  let exitCode = null;
  let exitSignal;
  let cleanupKnown = false;
  let cleanupConfirmed = false;
  let uncertain = false;
  let pendingEvents = 0;

  const safely = action => {
    try { action?.(); } catch { uncertain = true; }
  };
  const settle = (forced = false) => {
    if (finished || (!forced && (!closed || !cleanupKnown))) return;
    finished = true;
    clearTimeout(deadlineTimer);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    signal?.removeEventListener('abort', cancel);
    safely(() => release?.(forced));
    const error = forced || uncertain || !cleanupConfirmed ? 'cleanup_unconfirmed'
      : failure ?? (cancelled || exitCode === 0 ? undefined : 'exit_failed');
    resolve({
      status: cancelled ? 'cancelled' : error ? 'failed' : 'succeeded',
      exitCode,
      ...(exitSignal ? { signal: exitSignal } : {}),
      ...(error ? { error } : {}),
    });
  };
  const schedule = (delay, action) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!finished) action();
    }, delay);
    timers.add(timer);
  };
  const drain = () => {
    if (stopping || finished) return;
    stopping = true;
    clearTimeout(deadlineTimer);
    // Install the bound before requesting cleanup: an adapter may settle
    // synchronously when no workload exists or the owned group is already gone.
    schedule(cleanupMs, () => { safely(forceStop); settle(true); });
    for (const step of escalations) schedule(step.afterMs, () => safely(step.run));
    safely(requestStop);
  };
  const fail = code => {
    if (finished) return;
    failure ??= code;
    drain();
  };
  function cancel() {
    // Cancellation must not overwrite an earlier timeout/protocol failure or
    // retroactively relabel a workload that has already exited.
    if (finished || ended || cancelled || failure) return;
    cancelled = true;
    drain();
  }

  return {
    completion,
    get finished() { return finished; },
    get stopping() { return stopping; },
    get ended() { return ended; },
    get cancelled() { return cancelled; },
    get failure() { return failure; },
    arm() {
      if (armed || finished) return;
      armed = true;
      deadlineTimer = setTimeout(() => fail('timeout'), timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    },
    fail,
    cancel,
    drain,
    endedWith(code, name, error) {
      if (finished) return;
      ended = true;
      exitCode = code;
      exitSignal = name ?? exitSignal;
      if (error) failure ??= error;
      drain();
    },
    ownership(confirmed) {
      if (finished) return;
      cleanupKnown = true;
      cleanupConfirmed = confirmed === true;
      if (!cleanupConfirmed) uncertain = true;
      settle();
    },
    unconfirmed() { if (!finished) uncertain = true; },
    closed() { closed = true; settle(); },
    notStarted(error, wasCancelled = false) {
      if (finished) return;
      failure ??= error;
      cancelled ||= wasCancelled;
      ended = true;
      closed = true;
      cleanupKnown = true;
      cleanupConfirmed = true;
      settle();
    },
    emit(event) {
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
    },
  };
}

/** Own a direct command and its POSIX process group. Protocol adapters retain
 * their input/output rules; this module owns spawn through confirmed cleanup.
 * Windows pipes have no Job ownership and therefore cannot confirm cleanup.
 */
export function startOwnedPipe({ command, args, cwd, env, timeoutMs, signal,
  onEvent, onSpawn, onOutput, onExit, onClose } = {}) {
  let child;
  let exited = false;
  let groupGone = false;
  let groupTimer;
  let taskkill;
  let taskkillTimer;

  const signalChild = name => {
    if (!child?.pid || groupGone) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, name);
      else if (child.exitCode === null && child.signalCode === null && !child.kill(name)) {
        lifetime.unconfirmed();
      }
    } catch (error) {
      if (error.code === 'ESRCH') groupGone = true;
      else {
        lifetime.unconfirmed();
        if (!exited && child.exitCode === null && child.signalCode === null) {
          try { child.kill(name); } catch { /* Cleanup remains unconfirmed. */ }
        }
      }
    }
  };
  const checkGroup = () => {
    if (lifetime.finished || process.platform === 'win32') return;
    if (!groupGone) {
      try { process.kill(-child.pid, 0); }
      catch (error) {
        if (error.code === 'ESRCH') groupGone = true;
        // A probe can transiently fail while a group is dying. It supplies no
        // proof either way; keep waiting for ESRCH within the fixed bound.
      }
    }
    if (groupGone) {
      clearInterval(groupTimer);
      lifetime.ownership(true);
    }
  };
  const stopTaskkill = () => {
    if (taskkill && taskkill.exitCode === null && taskkill.signalCode === null) {
      lifetime.unconfirmed();
      try { taskkill.kill('SIGKILL'); } catch { /* Preserve uncertainty. */ }
      taskkill.unref();
    }
  };
  const lifetime = createOwnedWorkerLifetime({
    timeoutMs, signal, onEvent, cleanupMs: 2_000,
    requestStop() {
      if (!child?.pid) { lifetime.ownership(true); return; }
      if (process.platform === 'win32') {
        lifetime.unconfirmed();
        if (exited) { lifetime.ownership(false); return; }
        try {
          taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
            shell: false, windowsHide: true, stdio: 'ignore',
          });
          taskkill.on('error', () => signalChild('SIGKILL'));
          taskkill.once('close', () => {
            clearTimeout(taskkillTimer);
            lifetime.ownership(false);
          });
          taskkillTimer = setTimeout(() => { stopTaskkill(); signalChild('SIGKILL'); }, 1_000);
        } catch { signalChild('SIGKILL'); }
        return;
      }
      signalChild('SIGTERM');
      groupTimer = setInterval(checkGroup, 25);
      checkGroup();
    },
    escalations: [{ afterMs: 250, run() { signalChild('SIGKILL'); checkGroup(); } }],
    forceStop() { signalChild('SIGKILL'); stopTaskkill(); },
    release(forced) {
      clearInterval(groupTimer);
      clearTimeout(taskkillTimer);
      if (forced && child) {
        // Retain error listeners to absorb late errors after forced closure.
        for (const stream of child.stdio) stream?.destroy();
        child.unref();
      }
    },
  });
  const owner = { get child() { return child; }, lifetime };
  if (signal?.aborted) { lifetime.notStarted(undefined, true); return owner; }
  try {
    child = spawn(command === '$node' ? process.execPath : command, args, {
      cwd, ...(env === undefined ? {} : { env: { ...env } }),
      shell: false, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { lifetime.notStarted('spawn_failed'); return owner; }
  child.on('error', () => lifetime.fail('spawn_failed'));
  child.once('spawn', () => {
    try { onSpawn?.(child.pid); } catch { lifetime.fail('observer_failed'); }
  });
  child.stdin.on('error', () => lifetime.fail('stdin_failed'));
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('error', () => lifetime.fail('output_failed'));
    child[stream].on('data', chunk => {
      if (lifetime.finished || lifetime.failure || lifetime.cancelled) return;
      try { onOutput?.(stream, chunk); } catch { lifetime.fail('output_failed'); }
    });
  }
  child.once('exit', (code, name) => {
    exited = true;
    lifetime.endedWith(code, name);
    try { onExit?.(code, name); } catch { lifetime.fail('output_failed'); }
  });
  child.once('close', (code, name) => {
    exited = true;
    try { onClose?.(); } catch { lifetime.fail('output_failed'); }
    lifetime.endedWith(code, name);
    lifetime.closed();
  });
  lifetime.arm();
  return owner;
}
