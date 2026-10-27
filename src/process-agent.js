import { startOwnedPipe } from './owned-worker-lifetime.js';
import { TextDecoder } from 'node:util';

const INPUT_LIMIT = 512 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const STDERR_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 3_600_000;

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
  cleanup_unconfirmed: 'Owned-process cleanup could not be confirmed; inspect its process state.',
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

  const stdout = [];
  const diagnosticDecoder = new TextDecoder('utf-8', { fatal: true });
  let outputBytes = 0;
  let diagnosticBytes = 0;
  const owner = startOwnedPipe({
    command: agent.command, args: agent.args ?? [], cwd, timeoutMs, signal,
    onOutput(stream, chunk) {
      if (stream === 'stdout') {
        outputBytes += chunk.length;
        if (outputBytes > OUTPUT_LIMIT) { owner.lifetime.fail('output_too_large'); return; }
        stdout.push(chunk);
      } else {
        diagnosticBytes += chunk.length;
        if (diagnosticBytes > STDERR_LIMIT) { owner.lifetime.fail('stderr_too_large'); return; }
        try { diagnosticDecoder.decode(chunk, { stream: true }); }
        catch { owner.lifetime.fail('invalid_utf8'); }
      }
    },
    onExit(code) {
      if (code !== 0 && !owner.lifetime.cancelled) owner.lifetime.fail('exit_failed');
    },
  });
  if (owner.child && !owner.lifetime.stopping) {
    try { owner.child.stdin.end(input, error => { if (error) owner.lifetime.fail('stdin_failed'); }); }
    catch { owner.lifetime.fail('stdin_failed'); }
  }
  const outcome = await owner.lifetime.completion;
  if (outcome.error === 'cleanup_unconfirmed') throw failure(outcome.error);
  if (outcome.status === 'cancelled') throw failure('aborted');
  if (outcome.error) throw failure(outcome.error);
  let output;
  try {
    diagnosticDecoder.decode();
    output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout, outputBytes));
  } catch { throw failure('invalid_utf8'); }
  if (!output.trim()) throw failure('empty_output');
  return { output };
}
