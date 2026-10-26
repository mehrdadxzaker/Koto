import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { runProcessAgent } from '../src/process-agent.js';

const assignment = {
  schemaVersion: 1,
  goal: 'Ship a checked change',
  task: { id: 'review', prompt: 'Review the implementation using the findings.' },
  inputs: { research: 'The input must be positive.' },
};

function agent(script, timeoutMs = 5_000, args = []) {
  return { command: '$node', args: ['-e', script, '--', ...args], timeoutMs };
}

function hasCode(code) {
  return (error) => {
    assert.equal(error.code, `process_agent_${code}`);
    assert.equal(error.name, 'ProcessAgentError');
    return true;
  };
}

async function withTerminatingWorker({ exitCode = 0, output = 'complete', inherited = false,
  malformed = false } = {}, check) {
  const directory = await mkdtemp(join(tmpdir(), 'koto-terminal-worker-'));
  const heartbeatPath = join(directory, 'heartbeat');
  const groupPath = join(directory, 'worker-pid');
  const descendant = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    let tick = 0;
    setInterval(() => fs.writeFileSync(${JSON.stringify(heartbeatPath)}, String(++tick)), 20);
  `;
  const worker = `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    process.stdin.resume();
    fs.writeFileSync(${JSON.stringify(groupPath)}, String(process.pid));
    spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {
      stdio: ${inherited ? "['ignore', 'inherit', 'inherit']" : "'ignore'"},
    });
    const ready = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(heartbeatPath)})) return;
      clearInterval(ready);
      const output = ${malformed ? 'Buffer.from([0xc3, 0x28])' : JSON.stringify(output)};
      if (output.length) process.stdout.write(output, () => process.exit(${exitCode}));
      else process.exit(${exitCode});
    }, 10);
  `;
  try {
    await check(runProcessAgent(agent(worker, 1_500), assignment), async () => {
      const first = await readFile(heartbeatPath, 'utf8');
      await delay(100);
      assert.equal(await readFile(heartbeatPath, 'utf8'), first,
        'an owned descendant must stop before the worker result settles');
    });
  } finally {
    try { process.kill(-Number(await readFile(groupPath, 'utf8')), 'SIGKILL'); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
}

test('passes a structured assignment and dependency outputs through stdin', async () => {
  const result = await runProcessAgent(agent(`
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => text += chunk);
    process.stdin.on('end', () => {
      const value = JSON.parse(text);
      process.stdout.write([value.schemaVersion, value.goal, value.task.id, value.task.prompt,
        value.inputs.research, text.endsWith('\\n')].join('|'));
    });
  `), assignment);
  assert.equal(result.output,
    '1|Ship a checked change|review|Review the implementation using the findings.|The input must be positive.|true');
});

test('preserves valid UTF-8 split across stdout chunks', async () => {
  const result = await runProcessAgent(agent(`
    process.stdin.resume();
    process.stdout.write(Buffer.from([0xf0, 0x9f]));
    setTimeout(() => process.stdout.write(Buffer.from([0x98, 0x80, 0x0a])), 15);
  `), assignment);
  assert.equal(result.output, '😀\n');
});

test('does not evaluate shell syntax in executable arguments', async () => {
  const argument = '$(echo injected) ; echo injected & %PATH%';
  const result = await runProcessAgent(agent(`
    process.stdin.resume();
    process.stdout.write(JSON.stringify(process.argv.slice(1)));
  `, 5_000, [argument]), assignment);
  assert.deepEqual(JSON.parse(result.output), [argument]);
});

test('reports nonzero exit without including child diagnostics', async () => {
  await assert.rejects(runProcessAgent(agent(`
    process.stdin.resume();
    process.stdin.on('end', () => {
      process.stderr.write('private-test-marker');
      process.exitCode = 7;
    });
  `), assignment), (error) => {
    hasCode('exit_failed')(error);
    assert.ok(!error.message.includes('private-test-marker'));
    return true;
  });
});

test('a failed worker stops descendants with ignored stdio before rejecting',
  { skip: process.platform === 'win32' }, async () => {
    await withTerminatingWorker({ exitCode: 7 }, async (pending, assertStopped) => {
      await assert.rejects(pending, hasCode('exit_failed'));
      await assertStopped();
    });
  });

test('a failed worker with inherited-pipe descendants preserves its known exit failure',
  { skip: process.platform === 'win32' }, async () => {
    await withTerminatingWorker({ exitCode: 7, inherited: true }, async (pending, assertStopped) => {
      await assert.rejects(pending, hasCode('exit_failed'));
      await assertStopped();
    });
  });

test('a completed worker stops owned descendants before returning its result',
  { skip: process.platform === 'win32' }, async () => {
    for (const inherited of [false, true]) {
      await withTerminatingWorker({ inherited }, async (pending, assertStopped) => {
        assert.deepEqual(await pending, { output: 'complete' });
        await assertStopped();
      });
    }
  });

test('an empty or malformed result still stops owned descendants',
  { skip: process.platform === 'win32' }, async () => {
    for (const [options, code] of [[{ output: '' }, 'empty_output'], [{ malformed: true }, 'invalid_utf8']]) {
      await withTerminatingWorker(options, async (pending, assertStopped) => {
        await assert.rejects(pending, hasCode(code));
        await assertStopped();
      });
    }
  });

test('reports an executable that cannot be started', async () => {
  await assert.rejects(runProcessAgent({ command: 'koto-fixture-executable-that-does-not-exist' }, assignment),
    hasCode('spawn_failed'));
});

test('reports an agent that closes stdin before accepting its assignment', async () => {
  await assert.rejects(runProcessAgent(agent(`
    process.stdin.destroy();
    try { require('node:fs').closeSync(0); }
    catch (error) { if (error.code !== 'EBADF') throw error; }
    setInterval(() => {}, 1000);
  `), {
    ...assignment,
    task: { ...assignment.task, prompt: 'x'.repeat(400 * 1024) },
  }), hasCode('stdin_failed'));
});

test('rejects .cmd and .bat wrappers without enabling a shell', async () => {
  for (const command of ['agent.cmd', 'agent.BAT']) {
    await assert.rejects(runProcessAgent({ command }, assignment), hasCode('command_wrapper_unsupported'));
  }
});

test('rejects oversized input before trying to start an executable', async () => {
  await assert.rejects(runProcessAgent({ command: 'missing-fixture' }, {
    ...assignment, task: { ...assignment.task, prompt: 'x'.repeat(512 * 1024) },
  }), hasCode('input_too_large'));
});

test('rejects unsupported assignments and invalid execution bounds', async () => {
  await assert.rejects(runProcessAgent(agent(''), { ...assignment, inputs: { research: {} } }),
    hasCode('invalid_assignment'));
  for (const timeoutMs of [0, -1, 3_600_001, 1.5]) {
    await assert.rejects(runProcessAgent(agent('', timeoutMs), assignment), hasCode('invalid_configuration'));
  }
});

test('rejects an already canceled assignment without starting work', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runProcessAgent({ command: 'missing-fixture' }, assignment,
    { signal: controller.signal }), hasCode('aborted'));
});

test('cancels an active process and settles after stopping it', async () => {
  const controller = new AbortController();
  const pending = runProcessAgent(agent('process.stdin.resume(); setInterval(() => {}, 1000);'), assignment,
    { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(pending, hasCode('aborted')); }
  finally { clearTimeout(timer); }
});

test('stops a process at its deadline', async () => {
  await assert.rejects(runProcessAgent(agent('process.stdin.resume(); setInterval(() => {}, 1000);', 100),
    assignment), hasCode('timeout'));
});

test('bounds stdout and diagnostic output', async () => {
  for (const [stream, bytes, code] of [
    ['stdout', 512 * 1024 + 1, 'output_too_large'],
    ['stderr', 64 * 1024 + 1, 'stderr_too_large'],
  ]) {
    await assert.rejects(runProcessAgent(agent(`
      process.stdin.resume();
      setInterval(() => {}, 1000);
      process.${stream}.write(Buffer.alloc(${bytes}, 120));
    `), assignment), hasCode(code));
  }
});

test('rejects malformed UTF-8 on stdout or stderr', async () => {
  for (const stream of ['stdout', 'stderr']) {
    await assert.rejects(runProcessAgent(agent(`
      process.stdin.resume();
      ${stream === 'stderr' ? 'setInterval(() => {}, 1000);' : ''}
      process.stdout.write('answer');
      process.${stream}.write(Buffer.from([0xc3, 0x28]));
    `), assignment), hasCode('invalid_utf8'));
  }
});

test('requires a nonempty result even after a successful exit', async () => {
  await assert.rejects(runProcessAgent(agent('process.stdin.resume(); process.stdout.write(" \\n");'), assignment),
    hasCode('empty_output'));
});

test('cancellation stops descendants that ignore SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'koto-process-tree-'));
  const heartbeatPath = join(directory, 'heartbeat');
  const pidPath = join(directory, 'pid');
  const controller = new AbortController();
  const descendant = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
    let tick = 0;
    setInterval(() => fs.writeFileSync(${JSON.stringify(heartbeatPath)}, String(++tick)), 20);
  `;
  const pending = runProcessAgent(agent(`
    const { spawn } = require('node:child_process');
    process.stdin.resume();
    spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `), assignment, { signal: controller.signal });
  // Attach rejection handling before aborting, including if fixture setup fails.
  const settled = pending.then(() => null, (error) => error);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await readFile(heartbeatPath, 'utf8'); ready = true; break; } catch {}
      await delay(20);
    }
    assert.ok(ready, 'descendant began work');
    controller.abort();
    hasCode('aborted')(await settled);
    await delay(30);
    const stoppedAt = await readFile(heartbeatPath, 'utf8');
    await delay(100);
    assert.equal(await readFile(heartbeatPath, 'utf8'), stoppedAt);
  } finally {
    controller.abort();
    await settled;
    try { process.kill(Number(await readFile(pidPath, 'utf8')), 'SIGKILL'); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports unconfirmed cleanup when an escaped descendant keeps pipes open',
  { skip: process.platform === 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'koto-escaped-process-'));
    const pidPath = join(directory, 'pid');
    const controller = new AbortController();
    const escaped = `
      require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `;
    const pending = runProcessAgent(agent(`
      const { spawn } = require('node:child_process');
      process.stdin.resume();
      spawn(process.execPath, ['-e', ${JSON.stringify(escaped)}], {
        detached: true, stdio: ['ignore', 'inherit', 'inherit'],
      });
      setInterval(() => {}, 1000);
    `), assignment, { signal: controller.signal });
    const settled = pending.then(() => null, (error) => error);
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try { await readFile(pidPath, 'utf8'); ready = true; break; } catch {}
        await delay(20);
      }
      assert.ok(ready, 'escaped fixture began work');
      controller.abort();
      hasCode('cleanup_failed')(await settled);
    } finally {
      controller.abort();
      await settled;
      try { process.kill(-Number(await readFile(pidPath, 'utf8')), 'SIGKILL'); } catch {}
      await rm(directory, { recursive: true, force: true });
    }
  });
