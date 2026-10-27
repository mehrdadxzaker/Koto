import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin', 'koto.js');
function run(args, cwd = root) {
  const child = spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(child.error, undefined, 'CLI must launch successfully.');
  return child;
}

test('CLI help and version are available without provider setup', async () => {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(run(['--help']).stdout, /koto run <workflow.json>/);
  assert.equal(run(['--version']).stdout.trim(), metadata.version);
  assert.equal(run(['unknown']).status, 2);
});

test('demo runs cooperating fixture processes from an unrelated directory', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'koto-cli-'));
  try {
    const child = run(['demo'], cwd);
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, 'succeeded');
    assert.match(report.output, /Checked result: 42/);
    assert.deepEqual(report.tasks.map(task => task.status), ['succeeded', 'succeeded', 'succeeded']);
    for (const event of child.stderr.trim().split('\n').map(line => JSON.parse(line))) {
      assert.equal(Object.hasOwn(event, 'prompt'), false);
      assert.equal(Object.hasOwn(event, 'output'), false);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('validate rejects malformed graphs and never launches workflow commands', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'koto-validate-'));
  try {
    const workflow = {
      schemaVersion: 1, goal: 'Validate without execution',
      agents: { fixture: { command: '$node', args: ['-e', 'process.exit(29)'] } },
      tasks: [{ id: 'answer', agent: 'fixture', prompt: 'Complete task' }], finalTask: 'answer',
    };
    const filename = path.join(cwd, 'workflow.json');
    await writeFile(filename, JSON.stringify(workflow));
    const valid = run(['validate', filename], cwd);
    assert.equal(valid.status, 0);
    assert.equal(JSON.parse(valid.stdout).valid, true);
    assert.equal(run(['run', filename], cwd).status, 1);
    workflow.tasks[0].dependsOn = ['missing'];
    await writeFile(filename, JSON.stringify(workflow));
    const invalid = run(['validate', filename], cwd);
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stderr).error, 'workflow_invalid');
    assert.match(JSON.parse(invalid.stderr).message, /dependencies must reference/);
    await writeFile(filename, '{bad-json');
    const malformed = run(['run', filename], cwd);
    assert.equal(malformed.status, 2);
    assert.equal(JSON.parse(malformed.stderr).error, 'workflow_json_invalid');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('CLI rejects missing, oversized and malformed UTF-8 workflow files', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'koto-input-'));
  try {
    const filename = path.join(cwd, 'workflow.json');
    assert.equal(JSON.parse(run(['run', filename]).stderr).error, 'workflow_file_unavailable');
    await writeFile(filename, Buffer.alloc(1024 * 1024 + 1));
    assert.equal(JSON.parse(run(['run', filename]).stderr).error, 'workflow_file_too_large');
    await writeFile(filename, Buffer.from([0xff]));
    assert.equal(JSON.parse(run(['run', filename]).stderr).error, 'workflow_json_invalid');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('CLI rejects FIFO workflow inputs without waiting for a writer', {
  skip: process.platform === 'win32' ? 'POSIX FIFOs are not available on Windows.' : false,
}, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'koto-fifo-'));
  try {
    const filename = path.join(cwd, 'workflow.json');
    execFileSync('mkfifo', [filename]);
    for (const command of ['validate', 'run']) {
      const child = spawnSync(process.execPath, [cli, command, filename], {
        cwd, encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
      });
      assert.equal(child.error, undefined, 'Non-regular workflow inputs must be rejected promptly.');
      assert.equal(child.status, 2);
      assert.equal(JSON.parse(child.stderr).error, 'workflow_file_unavailable');
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('CLI forwards interruption to active workers and returns a canceled report', {
  timeout: 10_000,
  skip: process.platform === 'win32' ? 'Node cannot synthesize a console interrupt on Windows; process cancellation is covered by adapter tests.' : false,
}, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'koto-interrupt-'));
  let child;
  try {
    const filename = path.join(cwd, 'workflow.json');
    await writeFile(filename, JSON.stringify({
      schemaVersion: 1, goal: 'Cancel running work',
      agents: { worker: { command: '$node', args: ['-e', 'setInterval(() => {}, 1000)'] } },
      tasks: [{ id: 'answer', agent: 'worker', prompt: 'Wait for cancellation' }], finalTask: 'answer',
    }));
    child = spawn(process.execPath, [cli, 'run', filename], { cwd });
    let stdout = '';
    let interrupted = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (!interrupted && stderr.includes('task_started')) {
        interrupted = true;
        child.kill('SIGINT');
      }
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => resolve(code));
    });
    assert.equal(interrupted, true);
    assert.equal(exit, 130);
    assert.equal(JSON.parse(stdout).status, 'canceled');
  } finally {
    if (child?.exitCode === null) child.kill('SIGKILL');
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a closed progress pipe cancels the run and waits for worker cleanup', { timeout: 10_000 }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'koto-pipe-'));
  let child;
  try {
    const filename = path.join(cwd, 'workflow.json');
    await writeFile(filename, JSON.stringify({
      schemaVersion: 1, goal: 'Clean up after the progress reader disconnects',
      agents: {
        first: { command: '$node', args: ['-e', 'process.stdin.resume(); setTimeout(() => process.stdout.write("ready"), 100)'] },
        second: { command: '$node', args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'] },
      },
      tasks: [
        { id: 'prepare', agent: 'first', prompt: 'Prepare work' },
        { id: 'answer', agent: 'second', prompt: 'Wait', dependsOn: ['prepare'] },
      ],
      finalTask: 'answer',
    }));
    child = spawn(process.execPath, [cli, 'run', filename], { cwd });
    let stdout = '';
    let detached = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => {
      if (!detached && chunk.includes('task_started')) {
        detached = true;
        child.stderr.destroy();
      }
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => resolve(code));
    });
    assert.equal(detached, true);
    assert.equal(exit, 1);
    assert.equal(JSON.parse(stdout).status, 'canceled');
  } finally {
    if (child?.exitCode === null) child.kill('SIGKILL');
    await rm(cwd, { recursive: true, force: true });
  }
});
