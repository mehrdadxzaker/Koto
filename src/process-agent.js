import { spawn } from 'node:child_process';
import { TextDecoder } from 'node:util';

const INPUT_LIMIT = 512 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const STDERR_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 3_600_000;
const TERMINATION_GRACE = 250;

const MESSAGES = {
  invalid_configuration: 'Use an executable command, string arguments and a timeout from 1 to 3600000 milliseconds.',
  command_wrapper_unsupported: 'Use a real executable or $node with a script; .cmd and .bat wrappers are unsupported.',
  invalid_assignment: 'Supply a version 1 assignment with a goal, task id, prompt and string dependency outputs.',
  input_too_large: 'The agent assignment exceeds the 512 KiB input limit; reduce its context.',
  aborted: 'The agent assignment was canceled.',
  timeout: 'The agent exceeded its deadline and was stopped.',
  output_too_large: 'The agent exceeded the 512 KiB output limit and was stopped.',
  stderr_too_large: 'The agent exceeded the 64 KiB diagnostic output limit and was stopped.',
  invalid_utf8: 'The agent returned malformed UTF-8; configure UTF-8 text output.',
  exit_failed: 'The agent exited unsuccessfully; inspect its configuration independently.',
  empty_output: 'The agent exited without a nonempty text result.',
  spawn_failed: 'The agent executable could not be started; check its installation and working directory.',
  stdin_failed: 'The agent did not accept the assignment on standard input.',
  output_failed: 'The agent output stream failed before a complete result was received.',
  cleanup_failed: 'The agent could not be stopped cleanly; inspect its process state.',
};

function failure(code) {
  const error = new Error(MESSAGES[code]);
  error.name = 'ProcessAgentError';
  error.code = `process_agent_${code}`;
  return error;
}

function validString(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function assignmentInput(assignment) {
  if (!assignment || assignment.schemaVersion !== 1 || !validString(assignment.goal)
      || !assignment.task || !validString(assignment.task.id) || !validString(assignment.task.prompt)
      || !assignment.inputs || typeof assignment.inputs !== 'object' || Array.isArray(assignment.inputs)
      || Object.values(assignment.inputs).some((value) => typeof value !== 'string')) {
    throw failure('invalid_assignment');
  }
  const input = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    goal: assignment.goal,
    task: { id: assignment.task.id, prompt: assignment.task.prompt },
    inputs: Object.fromEntries(Object.entries(assignment.inputs)),
  })}\n`, 'utf8');
  if (input.length > INPUT_LIMIT) throw failure('input_too_large');
  return input;
}

/** Run one explicitly configured executable without a shell or model retry. */
export async function runProcessAgent(agent, assignment, { cwd, signal } = {}) {
  const timeoutMs = agent?.timeoutMs ?? DEFAULT_TIMEOUT;
  if (!agent || !validString(agent.command)
      || (agent.args !== undefined && (!Array.isArray(agent.args)
        || agent.args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))))
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT
      || (cwd !== undefined && !validString(cwd))
      || (signal !== undefined && !(signal instanceof AbortSignal))) {
    throw failure('invalid_configuration');
  }
  if (/\.(?:cmd|bat)$/i.test(agent.command)) throw failure('command_wrapper_unsupported');
  const input = assignmentInput(assignment);
  if (signal?.aborted) throw failure('aborted');

  let child;
  try {
    child = spawn(agent.command === '$node' ? process.execPath : agent.command, agent.args ?? [], {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw failure('spawn_failed');
  }

  return new Promise((resolve, reject) => {
    const stdout = [];
    const diagnosticDecoder = new TextDecoder('utf-8', { fatal: true });
    let outputBytes = 0;
    let diagnosticBytes = 0;
    let terminalError;
    let closed = false;
    let exited = false;
    let exitCode;
    let cleanupComplete = true;
    let cleanupStarted = false;
    let deadlineTimer;
    let terminationTimer;
    let cleanupTimer;
    let taskkill;
    let taskkillTimer;
    let finished = false;
    let closeUnconfirmed = false;

    const cleanupFailed = () => { terminalError = failure('cleanup_failed'); };

    const signalProcess = (signalName) => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signalName);
        else if (!child.kill(signalName) && child.exitCode === null && child.signalCode === null) {
          cleanupFailed();
        }
      } catch (error) {
        if (error.code !== 'ESRCH') {
          // Stopping only the direct child cannot confirm that its tree stopped.
          cleanupFailed();
          try { child.kill(signalName); } catch { /* Preserve the cleanup failure. */ }
        }
      }
    };

    const finish = () => {
      if (finished || (!closed && !closeUnconfirmed) || !cleanupComplete) return;
      finished = true;
      clearTimeout(deadlineTimer);
      clearTimeout(terminationTimer);
      clearTimeout(cleanupTimer);
      clearTimeout(taskkillTimer);
      signal?.removeEventListener('abort', onAbort);
      // Keep the error handler until an unconfirmed child eventually closes;
      // a late OS error must not become an unhandled EventEmitter error.
      if (closed) child.removeListener('error', onSpawnError);
      child.stdin.removeListener('error', onStdinError);
      child.stdout.removeListener('data', onOutput);
      child.stderr.removeListener('data', onDiagnostic);
      child.stdout.removeListener('error', onOutputError);
      child.stderr.removeListener('error', onOutputError);
      if (terminalError) return reject(terminalError);
      if (exitCode !== 0) return reject(failure('exit_failed'));
      try {
        diagnosticDecoder.decode();
        const output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout, outputBytes));
        if (!output.trim()) return reject(failure('empty_output'));
        resolve({ output });
      } catch {
        reject(failure('invalid_utf8'));
      }
    };

    const finishTermination = () => {
      if (cleanupComplete) return;
      cleanupComplete = true;
      clearTimeout(taskkillTimer);
      finish();
    };

    const startCleanup = () => {
      if (cleanupStarted || finished) return;
      cleanupStarted = true;
      clearTimeout(deadlineTimer);
      cleanupComplete = false;
      if (!child.pid) return finishTermination();
      cleanupTimer = setTimeout(() => {
        // An escaped descendant or denied termination must not keep this call
        // pending forever. Report unconfirmed cleanup before releasing handles.
        if (!closed) {
          cleanupFailed();
          closeUnconfirmed = true;
        }
        signalProcess('SIGKILL');
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        if (taskkill && taskkill.exitCode === null && taskkill.signalCode === null) {
          cleanupFailed();
          try { taskkill.kill('SIGKILL'); } catch { /* Its state remains unconfirmed. */ }
          taskkill.unref();
        }
        finishTermination();
        finish();
      }, 2_000);
      if (process.platform === 'win32') {
        // taskkill cannot reliably reconstruct a departed parent's tree. Keep
        // ordinary exit results accurate, and bound any pipes still held open.
        // Native Windows job ownership is outside this pure-Node adapter.
        if (exited) return finishTermination();
        try {
          taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
            shell: false, windowsHide: true, stdio: 'ignore',
          });
          const taskkillFailed = () => {
            cleanupFailed();
            signalProcess('SIGKILL');
          };
          taskkill.once('error', taskkillFailed);
          taskkill.once('close', (code) => {
            if (code !== 0) taskkillFailed();
            finishTermination();
          });
          taskkillTimer = setTimeout(() => {
            cleanupFailed();
            try { taskkill.kill('SIGKILL'); } catch { /* Fall back to the owned child. */ }
            signalProcess('SIGKILL');
          }, 1_000);
        } catch {
          cleanupFailed();
          signalProcess('SIGKILL');
          finishTermination();
        }
      } else {
        try { process.kill(-child.pid, 0); }
        catch (error) {
          if (error.code === 'ESRCH') return finishTermination();
          cleanupFailed();
        }
        signalProcess('SIGTERM');
        terminationTimer = setTimeout(() => {
          signalProcess('SIGKILL');
          finishTermination();
        }, TERMINATION_GRACE);
      }
    };

    const fail = (code) => {
      if (terminalError || finished) return;
      terminalError = failure(code);
      startCleanup();
    };

    const onAbort = () => fail('aborted');
    const onSpawnError = () => {
      if (terminalError && child.pid) cleanupFailed();
      else fail('spawn_failed');
    };
    const onStdinError = () => fail('stdin_failed');
    const onOutputError = () => fail('output_failed');
    const onOutput = (chunk) => {
      if (terminalError) return;
      outputBytes += chunk.length;
      if (outputBytes > OUTPUT_LIMIT) return fail('output_too_large');
      stdout.push(chunk);
    };
    const onDiagnostic = (chunk) => {
      if (terminalError) return;
      diagnosticBytes += chunk.length;
      if (diagnosticBytes > STDERR_LIMIT) return fail('stderr_too_large');
      try { diagnosticDecoder.decode(chunk, { stream: true }); }
      catch { fail('invalid_utf8'); }
    };

    child.on('error', onSpawnError);
    child.stdin.on('error', onStdinError);
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onDiagnostic);
    child.stdout.on('error', onOutputError);
    child.stderr.on('error', onOutputError);
    child.once('exit', (code) => {
      exited = true;
      exitCode = code;
      if (!terminalError && code !== 0) terminalError = failure('exit_failed');
      // A worker owns its process group for this assignment. No background
      // ownership transfer is supported, even when its own exit was successful.
      startCleanup();
    });
    child.once('close', (code) => {
      closed = true;
      exitCode = code;
      if (finished) child.removeListener('error', onSpawnError);
      finish();
    });
    deadlineTimer = setTimeout(() => fail('timeout'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (!terminalError) child.stdin.end(input, (error) => { if (error) onStdinError(); });
  });
}
