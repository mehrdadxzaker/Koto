import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow, validateWorkflow } from '../src/core.js';

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function workflow(changes = {}) {
  return {
    schemaVersion: 1,
    goal: 'Produce one cooperative result',
    agents: { worker: { command: process.execPath } },
    tasks: [{ id: 'final', agent: 'worker', prompt: 'Return the result' }],
    finalTask: 'final',
    ...changes,
  };
}

test('validation normalizes defaults without mutating source objects', () => {
  const source = workflow();
  const normalized = validateWorkflow(source);
  assert.equal(normalized.maxConcurrency, 2);
  assert.equal(normalized.timeoutMs, 300_000);
  assert.deepEqual(normalized.agents.worker, {
    command: process.execPath, args: [], timeoutMs: 120_000,
  });
  assert.deepEqual(normalized.tasks[0].dependsOn, []);
  normalized.agents.worker.args.push('new argument');
  assert.equal(source.agents.worker.args, undefined);
  assert.equal(source.tasks[0].dependsOn, undefined);
});

test('invalid workflows fail validation before an adapter executes', async () => {
  const bad = [
    workflow({ schemaVersion: 2 }),
    workflow({ hidden: true }),
    workflow({ goal: '' }),
    workflow({ maxConcurrency: 9 }),
    workflow({ timeoutMs: Infinity }),
    workflow({ agents: { worker: { command: '', args: [] } } }),
    workflow({ agents: { worker: { command: 'agent', shell: true } } }),
    workflow({ agents: { worker: { command: 'agent', args: ['\0'] } } }),
    workflow({ finalTask: 'missing' }),
    workflow({ tasks: [{ id: '../outside', agent: 'worker', prompt: 'No' }] }),
    workflow({ tasks: [{ id: 'final', agent: 'missing', prompt: 'No' }] }),
    workflow({ tasks: [{ id: 'final', agent: 'worker', prompt: 'No', dependsOn: ['missing'] }] }),
    workflow({ tasks: [{ id: 'final', agent: 'worker', prompt: 'No', dependsOn: ['final'] }] }),
    workflow({ tasks: [
      { id: 'final', agent: 'worker', prompt: 'No' },
      { id: 'final', agent: 'worker', prompt: 'Duplicate' },
    ] }),
    workflow({ tasks: [
      { id: 'other', agent: 'worker', prompt: 'Unrelated' },
      { id: 'final', agent: 'worker', prompt: 'No' },
    ] }),
    workflow({ tasks: [
      { id: 'first', agent: 'worker', prompt: 'No', dependsOn: ['second'] },
      { id: 'second', agent: 'worker', prompt: 'No', dependsOn: ['first'] },
      { id: 'final', agent: 'worker', prompt: 'No', dependsOn: ['first'] },
    ] }),
  ];
  let invoked = 0;
  for (const source of bad) {
    await assert.rejects(runWorkflow(source, {
      adapters: { worker: async () => { invoked += 1; return { output: 'unexpected' }; } },
    }), /Invalid workflow:/);
  }
  assert.equal(invoked, 0);
});

test('independent agents run concurrently and hand outputs to their dependent task', async () => {
  const analysisStarted = deferred();
  const checksStarted = deferred();
  const release = deferred();
  const events = [];
  let active = 0;
  let maximum = 0;
  let finalStarted = false;
  const source = workflow({
    agents: {
      analysis: { command: 'explicit-analysis-agent' },
      checks: { command: 'explicit-check-agent' },
      integrate: { command: 'explicit-integration-agent' },
    },
    tasks: [
      { id: 'analysis', agent: 'analysis', prompt: 'Find the required change' },
      { id: 'checks', agent: 'checks', prompt: 'Identify acceptance checks' },
      { id: 'final', agent: 'integrate', prompt: 'Integrate findings', dependsOn: ['analysis', 'checks'] },
    ],
  });
  const run = runWorkflow(source, {
    onEvent: (event) => events.push(event),
    adapters: {
      analysis: async (assignment) => {
        assert.deepEqual(assignment.inputs, {});
        active += 1; maximum = Math.max(maximum, active);
        analysisStarted.resolve();
        await release.promise;
        active -= 1;
        return { output: 'Change the input validation' };
      },
      checks: async () => {
        active += 1; maximum = Math.max(maximum, active);
        checksStarted.resolve();
        await release.promise;
        active -= 1;
        return { output: 'Check invalid and valid inputs' };
      },
      integrate: async (assignment) => {
        finalStarted = true;
        assert.deepEqual(assignment, {
          schemaVersion: 1,
          goal: source.goal,
          task: { id: 'final', prompt: 'Integrate findings' },
          inputs: {
            analysis: 'Change the input validation',
            checks: 'Check invalid and valid inputs',
          },
        });
        return { output: 'Integrated patch with acceptance checks' };
      },
    },
  });
  await Promise.all([analysisStarted.promise, checksStarted.promise]);
  assert.equal(maximum, 2);
  assert.equal(finalStarted, false);
  release.resolve();
  const report = await run;
  assert.equal(report.status, 'succeeded');
  assert.equal(report.output, 'Integrated patch with acceptance checks');
  assert.deepEqual(report.tasks.map(({ id, agent, status }) => ({ id, agent, status })), [
    { id: 'analysis', agent: 'analysis', status: 'succeeded' },
    { id: 'checks', agent: 'checks', status: 'succeeded' },
    { id: 'final', agent: 'integrate', status: 'succeeded' },
  ]);
  assert.equal(events[0].type, 'run_started');
  assert.equal(events.at(-1).type, 'run_finished');
  assert.ok(events.every((event) => Object.keys(event).every((key) =>
    ['type', 'taskId', 'agent', 'status'].includes(key))));
  assert.ok(!JSON.stringify(events).includes('input validation'));
});

test('concurrency one prevents a second independent task from starting early', async () => {
  const started = deferred();
  const release = deferred();
  const seen = [];
  const source = workflow({
    maxConcurrency: 1,
    tasks: [
      { id: 'first', agent: 'worker', prompt: 'First' },
      { id: 'second', agent: 'worker', prompt: 'Second' },
      { id: 'final', agent: 'worker', prompt: 'Join', dependsOn: ['first', 'second'] },
    ],
  });
  const run = runWorkflow(source, { adapters: {
    worker: async (assignment) => {
      seen.push(assignment.task.id);
      if (assignment.task.id === 'first') {
        started.resolve();
        await release.promise;
      }
      return { output: assignment.task.id };
    },
  } });
  await started.promise;
  assert.deepEqual(seen, ['first']);
  release.resolve();
  assert.equal((await run).status, 'succeeded');
  assert.deepEqual(seen, ['first', 'second', 'final']);
});

test('failed dependencies block descendants while independent work still completes', async () => {
  const seen = [];
  const source = workflow({ tasks: [
    { id: 'broken', agent: 'worker', prompt: 'Fails' },
    { id: 'independent', agent: 'worker', prompt: 'Still completes' },
    { id: 'blocked', agent: 'worker', prompt: 'Never starts', dependsOn: ['broken'] },
    { id: 'final', agent: 'worker', prompt: 'Join', dependsOn: ['blocked', 'independent'] },
  ] });
  const report = await runWorkflow(source, { adapters: {
    worker: async ({ task }) => {
      seen.push(task.id);
      if (task.id === 'broken') throw new Error('secret exception content');
      return { output: 'independent result' };
    },
  } });
  assert.equal(report.status, 'failed');
  assert.equal(report.output, null);
  assert.deepEqual(report.tasks.map((task) => task.status), ['failed', 'succeeded', 'blocked', 'blocked']);
  assert.deepEqual(seen, ['broken', 'independent']);
  assert.ok(!JSON.stringify(report).includes('secret exception content'));
});

test('agent deadlines stop cooperative custom adapters and block dependents', { timeout: 2000 }, async () => {
  let canceled = false;
  const report = await runWorkflow(workflow({
    agents: { worker: { command: process.execPath, timeoutMs: 10 } },
  }), { adapters: {
    worker: async (_assignment, { signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        canceled = true;
        resolve({ output: 'late output' });
      }, { once: true });
    }),
  } });
  assert.equal(canceled, true);
  assert.equal(report.status, 'failed');
  assert.equal(report.output, null);
  assert.equal(report.tasks[0].error, 'agent timed out');
});

test('abort stops scheduling and waits for cooperative cleanup', async () => {
  const started = deferred();
  const cleanup = deferred();
  const controller = new AbortController();
  let cleaned = false;
  const seen = [];
  const run = runWorkflow(workflow({
    maxConcurrency: 1,
    tasks: [
      { id: 'first', agent: 'worker', prompt: 'Start' },
      { id: 'final', agent: 'worker', prompt: 'Never start', dependsOn: ['first'] },
    ],
  }), {
    signal: controller.signal,
    adapters: { worker: async ({ task }, { signal }) => {
      seen.push(task.id);
      started.resolve();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      await cleanup.promise;
      cleaned = true;
      return { output: 'discarded after cancellation' };
    } },
  });
  await started.promise;
  controller.abort();
  cleanup.resolve();
  const report = await run;
  assert.equal(cleaned, true);
  assert.deepEqual(seen, ['first']);
  assert.equal(report.status, 'canceled');
  assert.deepEqual(report.tasks.map((task) => task.status), ['canceled', 'canceled']);
});

test('a pre-aborted signal never invokes an agent', async () => {
  const controller = new AbortController();
  controller.abort();
  let invoked = false;
  const report = await runWorkflow(workflow(), {
    signal: controller.signal,
    adapters: { worker: async () => { invoked = true; return { output: 'unexpected' }; } },
  });
  assert.equal(invoked, false);
  assert.equal(report.status, 'canceled');
  assert.equal(report.tasks[0].status, 'canceled');
});

test('run deadline cancels work even when an injected adapter does not cooperate', { timeout: 2000 }, async () => {
  const report = await runWorkflow(workflow({ timeoutMs: 10 }), {
    adapters: { worker: () => new Promise(() => {}) },
  });
  assert.equal(report.status, 'canceled');
  assert.equal(report.tasks[0].error, 'run timed out; cancellation unconfirmed');
});

test('observer exceptions cannot interrupt execution or cleanup', async () => {
  for (const onEvent of [
    () => { throw new Error('observer failed'); },
    async () => { throw new Error('asynchronous observer failed'); },
  ]) {
    const report = await runWorkflow(workflow(), {
      onEvent,
      adapters: { worker: async () => ({ output: 'completed' }) },
    });
    assert.equal(report.status, 'succeeded');
    assert.equal(report.output, 'completed');
  }
  await new Promise(setImmediate);
});

test('invalid and oversized adapter outputs fail without becoming downstream inputs', async () => {
  for (const result of [{}, { output: 42 }, { output: '' }, { output: 'x'.repeat(524_289) }]) {
    const report = await runWorkflow(workflow(), {
      adapters: { worker: async () => result },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.tasks[0].status, 'failed');
    assert.equal(report.output, null);
  }
});

test('oversized aggregate handoffs never reach a dependent adapter', async () => {
  const seen = [];
  const report = await runWorkflow(workflow({ tasks: [
    { id: 'first', agent: 'worker', prompt: 'First contribution' },
    { id: 'second', agent: 'worker', prompt: 'Second contribution' },
    { id: 'final', agent: 'worker', prompt: 'Join', dependsOn: ['first', 'second'] },
  ] }), { adapters: {
    worker: async ({ task }) => {
      seen.push(task.id);
      return { output: 'x'.repeat(300_000) };
    },
  } });
  assert.deepEqual(seen, ['first', 'second']);
  assert.equal(report.status, 'failed');
  assert.equal(report.tasks[2].error, 'task input exceeds byte limit');
});

test('a missing built-in executable exposes its fixed diagnostic without task content', async () => {
  const report = await runWorkflow(workflow({
    agents: { worker: { command: 'koto-nonexistent-test-agent-command-461de217' } },
  }));
  assert.equal(report.status, 'failed');
  assert.equal(report.tasks[0].error, 'process_agent_spawn_failed');
  assert.equal(report.output, null);
});

test('injected errors cannot impersonate trusted built-in diagnostics', async () => {
  const report = await runWorkflow(workflow(), { adapters: {
    worker: async () => {
      const error = new Error('private agent stderr content');
      error.name = 'ProcessAgentError';
      error.code = 'process_agent_spawn_failed';
      throw error;
    },
  } });
  assert.equal(report.tasks[0].error, 'agent failed');
  assert.ok(!JSON.stringify(report).includes('private agent stderr content'));
});

test('injected cancellation errors cannot impersonate unconfirmed process cleanup', async () => {
  const started = deferred();
  const controller = new AbortController();
  const run = runWorkflow(workflow(), {
    signal: controller.signal,
    adapters: {
      worker: async (_assignment, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('private cleanup diagnostics');
          error.code = 'process_agent_cleanup_failed';
          reject(error);
        }, { once: true });
        started.resolve();
      }),
    },
  });
  await started.promise;
  controller.abort();
  const report = await run;
  assert.equal(report.status, 'canceled');
  assert.equal(report.tasks[0].error, 'run canceled');
  assert.ok(!JSON.stringify(report).includes('private cleanup diagnostics'));
});

test('aborting synchronously from task_started prevents adapter dispatch', async () => {
  const controller = new AbortController();
  let invoked = false;
  const report = await runWorkflow(workflow(), {
    signal: controller.signal,
    onEvent(event) {
      if (event.type === 'task_started') controller.abort();
    },
    adapters: { worker: async () => { invoked = true; return { output: 'unexpected' }; } },
  });
  assert.equal(invoked, false);
  assert.equal(report.status, 'canceled');
  assert.equal(report.tasks[0].status, 'canceled');
});

test('prototype-named aliases and task ids retain own-property semantics', async () => {
  const source = workflow({
    agents: { constructor: { command: 'explicit-worker' }, prototype: { command: 'explicit-worker' } },
    tasks: [
      { id: 'constructor', agent: 'constructor', prompt: 'Produce a finding' },
      { id: 'final', agent: 'prototype', prompt: 'Consume it', dependsOn: ['constructor'] },
    ],
  });
  const report = await runWorkflow(source, { adapters: {
    constructor: async () => ({ output: 'own property result' }),
    prototype: async ({ inputs }) => {
      assert.equal(Object.hasOwn(inputs, 'constructor'), true);
      assert.equal(inputs.constructor, 'own property result');
      return { output: 'integrated own property result' };
    },
  } });
  assert.equal(report.status, 'succeeded');
  assert.equal(report.output, 'integrated own property result');
  const invalid = JSON.parse('{"schemaVersion":1,"goal":"goal","agents":{"__proto__":{"command":"agent"}},"tasks":[],"finalTask":"final"}');
  assert.throws(() => validateWorkflow(invalid), /agent alias must be a valid identifier/);
});
