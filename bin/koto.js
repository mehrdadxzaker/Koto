#!/usr/bin/env node
import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { TextDecoder } from 'node:util';
import { runWorkflow, validateWorkflow } from '../src/core.js';
import { runProjectCli } from './project.js';
import { runTerminalCli } from './terminal.js';
import { runPlanCli } from './plan.js';
import { runLauncher } from './launcher.js';

const packageRoot = new URL('../', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
const brokenStreams = new Set();
let activeController;
let outputFailed = false;
function streamFailed(stream) {
  brokenStreams.add(stream);
  outputFailed = true;
  process.exitCode = 1;
  activeController?.abort();
}
function write(stream, text) {
  if (brokenStreams.has(stream)) return;
  try { stream.write(text); }
  catch { streamFailed(stream); }
}
process.stdout.on('error', () => streamFailed(process.stdout));
process.stderr.on('error', () => streamFailed(process.stderr));
const help = `Koto — a shared agent orchestration core

Usage:
  koto                       Open the guided launcher
  koto start                 Open the guided launcher
  koto --help
  koto --version
  koto validate <workflow.json>
  koto run <workflow.json>
  koto project --help
  koto terminal --help
  koto plan --help

run executes the commands explicitly declared in the selected workflow.
Worker commands receive a JSON assignment on stdin and return text on stdout.
IDE plugins and Koto's own UI will use this same core.
`;

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    write(process.stdout, help);
    return;
  }
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    write(process.stdout, `${metadata.version}\n`);
    return;
  }
  const [command, path] = args;
  if (command === 'plan') {
    process.exitCode = await runPlanCli(args.slice(1), { write: text => write(process.stdout, text) });
    return;
  }
  if (!args.length || (command === 'start' && args.length === 1)) {
    const controller = new AbortController();
    activeController = controller;
    if (outputFailed) controller.abort();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
      process.exitCode = await runLauncher({ write: text => write(process.stdout, text), signal: controller.signal, version: metadata.version });
    } finally {
      activeController = undefined;
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
    return;
  }
  if (command === 'terminal') {
    process.exitCode = await runTerminalCli(args.slice(1), { write: text => write(process.stdout, text) });
    return;
  }
  if (command === 'project') {
    const controller = new AbortController();
    activeController = controller;
    if (outputFailed) controller.abort();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
      process.exitCode = await runProjectCli(args.slice(1), { signal: controller.signal,
        write: text => write(process.stdout, text) });
    } finally {
      activeController = undefined;
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
    return;
  }
  if (!(['validate', 'run'].includes(command) && args.length === 2 && !path.startsWith('-'))) {
    write(process.stderr, help);
    process.exitCode = 2;
    return;
  }
  const workflowPath = path;
  let bytes;
  try {
    // Opening a POSIX FIFO in blocking mode would hang before its type could
    // be checked. Regular files are unaffected by the nonblocking flag.
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK);
    const source = await open(workflowPath, flags);
    try {
      if (!(await source.stat()).isFile()) throw new Error('workflow_file_unavailable');
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await source.read(buffer, total, buffer.length - total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > 1024 * 1024) throw new Error('workflow_file_too_large');
      bytes = buffer.subarray(0, total);
    } finally { await source.close(); }
  } catch (error) {
    if (error.message === 'workflow_file_too_large') throw error;
    throw new Error('workflow_file_unavailable');
  }
  let workflow;
  try { workflow = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('workflow_json_invalid'); }
  validateWorkflow(workflow);
  if (command === 'validate') {
    write(process.stdout, `${JSON.stringify({ schemaVersion: 1, valid: true, tasks: workflow.tasks.length })}\n`);
    return;
  }
  const controller = new AbortController();
  activeController = controller;
  if (outputFailed) controller.abort();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const result = await runWorkflow(workflow, {
      cwd: process.cwd(),
      signal: controller.signal,
      onEvent: event => write(process.stderr, `${JSON.stringify(event)}\n`),
    });
    write(process.stdout, `${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'succeeded') process.exitCode = !outputFailed && controller.signal.aborted ? 130 : 1;
  } finally {
    activeController = undefined;
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  // Errors never reflect workflow contents, child stderr or credential values.
  const validation = typeof error?.message === 'string' && error.message.startsWith('Invalid workflow: ');
  const code = validation ? 'workflow_invalid' : typeof error?.code === 'string' && /^[a-z][a-z0-9_]+$/.test(error.code)
    ? error.code : /^[a-z][a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'koto_command_failed';
  write(process.stderr, `${JSON.stringify(validation ? { error: code, message: error.message } : { error: code })}\n`);
  process.exitCode = 2;
}
