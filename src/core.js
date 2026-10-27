import { runProcessAgent } from './process-agent.js';

const MAX_TEXT_BYTES = 65_536;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_ASSIGNMENT_BYTES = 512 * 1024;
const CUSTOM_CANCEL_GRACE_MS = 100;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
// Only fixed errors from the built-in adapter may enter a report. External
// worker text and exceptions from injected adapters stay outside diagnostics.
const PROCESS_ERRORS = new Set([
  'invalid_configuration', 'command_wrapper_unsupported', 'invalid_assignment',
  'input_too_large', 'aborted', 'timeout', 'output_too_large', 'stderr_too_large',
  'invalid_utf8', 'exit_failed', 'empty_output', 'spawn_failed', 'stdin_failed', 'output_failed',
  'cleanup_failed', 'cleanup_unconfirmed', 'socket_exhausted',
].map((code) => `process_agent_${code}`));

function fail(message) {
  throw new Error(`Invalid workflow: ${message}`);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fields(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object`);
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    fail(`${label} contains an unsupported field`);
  }
}

function text(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > maximum) {
    fail(`${label} must be nonempty text within its byte limit`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} must be a valid identifier`);
  return value;
}

function integer(value, fallback, maximum, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} must be a positive integer within its limit`);
  }
  return value;
}

/** Validate and normalize an explicit workflow without launching any agents. */
export function validateWorkflow(workflow) {
  fields(workflow, ['schemaVersion', 'goal', 'agents', 'tasks', 'finalTask',
    'maxConcurrency', 'timeoutMs'], 'workflow');
  if (workflow.schemaVersion !== 1) fail('schemaVersion must be 1');
  const goal = text(workflow.goal, MAX_TEXT_BYTES, 'goal');
  if (!object(workflow.agents)) fail('agents must be an object');
  const entries = Object.entries(workflow.agents);
  if (entries.length < 1 || entries.length > 16) fail('agents must contain 1 to 16 entries');
  const agents = {};
  for (const [alias, source] of entries) {
    identifier(alias, 'agent alias');
    fields(source, ['command', 'args', 'timeoutMs'], 'agent');
    const command = text(source.command, 4096, 'agent command');
    const args = source.args === undefined ? [] : source.args;
    if (!Array.isArray(args) || args.length > 128
      || args.some((value) => typeof value !== 'string' || value.includes('\0')
        || Buffer.byteLength(value, 'utf8') > 16_384)) {
      fail('agent args must contain at most 128 bounded strings');
    }
    agents[alias] = {
      command,
      args: [...args],
      timeoutMs: integer(source.timeoutMs, 120_000, 3_600_000, 'agent timeoutMs'),
    };
  }
  if (!Array.isArray(workflow.tasks) || workflow.tasks.length < 1 || workflow.tasks.length > 64) {
    fail('tasks must contain 1 to 64 entries');
  }
  const byId = new Map();
  const tasks = workflow.tasks.map((source) => {
    fields(source, ['id', 'agent', 'prompt', 'dependsOn'], 'task');
    const id = identifier(source.id, 'task id');
    if (byId.has(id)) fail('task ids must be unique');
    const agent = identifier(source.agent, 'task agent');
    if (!own(agents, agent)) fail('task agent must reference a configured agent');
    const prompt = text(source.prompt, MAX_TEXT_BYTES, 'task prompt');
    const dependencies = source.dependsOn === undefined ? [] : source.dependsOn;
    if (!Array.isArray(dependencies) || dependencies.length > 63) {
      fail('dependsOn must be a bounded array');
    }
    const dependsOn = dependencies.map((value) => identifier(value, 'dependency'));
    if (new Set(dependsOn).size !== dependsOn.length) fail('dependencies must be unique');
    const task = { id, agent, prompt, dependsOn };
    byId.set(id, task);
    return task;
  });
  for (const task of tasks) {
    if (task.dependsOn.some((id) => !byId.has(id))) {
      fail('dependencies must reference existing tasks');
    }
  }
  const finalTask = workflow.finalTask == null ? null : identifier(workflow.finalTask, 'finalTask');
  if (finalTask !== null && !byId.has(finalTask)) fail('finalTask must reference an existing task');
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('task dependencies contain a cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);
  const contributing = new Set();
  function contribute(id) {
    if (contributing.has(id)) return;
    contributing.add(id);
    for (const dependency of byId.get(id).dependsOn) contribute(dependency);
  }
  if (finalTask !== null) {
    contribute(finalTask);
    if (contributing.size !== tasks.length) fail('every task must contribute to finalTask');
  }
  return {
    schemaVersion: 1,
    goal,
    agents,
    tasks,
    finalTask,
    maxConcurrency: integer(workflow.maxConcurrency, 2, 8, 'maxConcurrency'),
    timeoutMs: integer(workflow.timeoutMs, 300_000, 3_600_000, 'timeoutMs'),
  };
}

class CancellationUnconfirmed extends Error {}

// Injected JavaScript adapters must honor AbortSignal. Bound the wait when an
// adapter violates that contract; its unowned resources cannot be killed here.
function awaitCustomAdapter(execution, signal) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      if (timer !== undefined || finished) return;
      timer = setTimeout(() => finish(reject, new CancellationUnconfirmed()), CUSTOM_CANCEL_GRACE_MS);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    execution.then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

/** Run a cooperative task graph. A successful report means execution completed,
 * not that an agent's answer is correct. No retry or write replay is performed.
 */
export async function runWorkflow(source, { cwd, signal, onEvent, adapters = {} } = {}) {
  const workflow = validateWorkflow(source);
  if (cwd !== undefined && (typeof cwd !== 'string' || !cwd.trim() || cwd.includes('\0'))) {
    throw new TypeError('cwd must be a nonempty path');
  }
  if (signal !== undefined && (typeof signal?.addEventListener !== 'function'
    || typeof signal?.removeEventListener !== 'function' || typeof signal?.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('onEvent must be a function');
  }
  if (!object(adapters) || Object.entries(adapters).some(([alias, adapter]) =>
    !own(workflow.agents, alias) || typeof adapter !== 'function')) {
    throw new TypeError('adapters must map configured agent aliases to functions');
  }
  const emit = (event) => {
    try {
      // An asynchronous observer must not create an unhandled rejection after
      // scheduling or cancellation. Observers never hold up the worker lifecycle.
      Promise.resolve(onEvent?.(Object.freeze(event))).catch(() => {});
    } catch { /* Observers cannot interrupt cleanup. */ }
  };
  const controller = new AbortController();
  let stopReason = 'run canceled';
  let resourceExhausted = false;
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const runTimer = setTimeout(() => {
    stopReason = 'run timed out';
    controller.abort();
  }, workflow.timeoutMs);
  const records = new Map(workflow.tasks.map((task) => [task.id,
    { id: task.id, agent: task.agent, status: 'pending' }]));
  const active = new Map();

  function terminal(record, status, error) {
    record.status = status;
    if (error) record.error = error;
    emit({ type: 'task_finished', taskId: record.id, agent: record.agent, status });
  }

  async function execute(task) {
    const record = records.get(task.id);
    record.status = 'running';
    emit({ type: 'task_started', taskId: task.id, agent: task.agent, status: 'running' });
    const taskController = new AbortController();
    const abort = () => taskController.abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    if (controller.signal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      taskController.abort();
    }, workflow.agents[task.agent].timeoutMs);
    let failure = 'agent failed';
    const custom = own(adapters, task.agent);
    try {
      if (taskController.signal.aborted) throw new Error();
      const inputs = Object.fromEntries(task.dependsOn.map((id) => [id, records.get(id).output]));
      const assignment = {
        schemaVersion: 1,
        goal: workflow.goal,
        task: { id: task.id, prompt: task.prompt },
        inputs,
      };
      if (Buffer.byteLength(JSON.stringify(assignment), 'utf8') + 1 > MAX_ASSIGNMENT_BYTES) {
        failure = 'task input exceeds byte limit';
        throw new Error();
      }
      const execution = Promise.resolve().then(() => {
        if (taskController.signal.aborted) throw new Error();
        return custom
          ? adapters[task.agent](assignment, { cwd, signal: taskController.signal })
          : runProcessAgent(workflow.agents[task.agent], assignment,
            { cwd, signal: taskController.signal });
      });
      const result = await (custom ? awaitCustomAdapter(execution, taskController.signal) : execution);
      if (taskController.signal.aborted) throw new Error();
      if (!object(result) || typeof result.output !== 'string' || !result.output.trim()) {
        failure = 'agent result must contain a nonempty output string';
        throw new Error();
      }
      if (Buffer.byteLength(result.output, 'utf8') > MAX_OUTPUT_BYTES) {
        failure = 'agent output exceeds byte limit';
        throw new Error();
      }
      record.output = result.output;
      terminal(record, 'succeeded');
    } catch (error) {
      const unconfirmed = error instanceof CancellationUnconfirmed ? '; cancellation unconfirmed'
        : !custom && ['process_agent_cleanup_failed', 'process_agent_cleanup_unconfirmed'].includes(error?.code)
          ? '; cleanup unconfirmed' : '';
      if (!custom && error?.code === 'process_agent_socket_exhausted') {
        terminal(record, 'failed', 'process_agent_socket_exhausted');
        resourceExhausted = true;
        stopReason = 'process_agent_socket_exhausted';
        controller.abort();
      } else if (controller.signal.aborted) terminal(record, 'canceled', stopReason + unconfirmed);
      else if (timedOut) terminal(record, 'failed', 'agent timed out' + unconfirmed);
      else terminal(record, 'failed', !custom && PROCESS_ERRORS.has(error?.code) ? error.code : failure);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
    }
  }

  emit({ type: 'run_started', status: 'running' });
  try {
    while ([...records.values()].some((record) => ['pending', 'running'].includes(record.status))) {
      for (const task of workflow.tasks) {
        const record = records.get(task.id);
        if (record.status !== 'pending') continue;
        if (controller.signal.aborted) {
          terminal(record, 'canceled', stopReason);
          continue;
        }
        const dependencies = task.dependsOn.map((id) => records.get(id));
        if (dependencies.some((dependency) => ['failed', 'blocked', 'canceled'].includes(dependency.status))) {
          terminal(record, 'blocked', 'a required task did not succeed');
          continue;
        }
        if (active.size < workflow.maxConcurrency
          && dependencies.every((dependency) => dependency.status === 'succeeded')) {
          const execution = execute(task).finally(() => active.delete(task.id));
          active.set(task.id, execution);
        }
      }
      if (active.size) await Promise.race(active.values());
    }
    const status = resourceExhausted ? 'failed' : controller.signal.aborted ? 'canceled'
      : [...records.values()].every((record) => record.status === 'succeeded') ? 'succeeded' : 'failed';
    const final = records.get(workflow.finalTask);
    const report = {
      schemaVersion: 1,
      status,
      goal: workflow.goal,
      finalTask: workflow.finalTask,
      output: final?.status === 'succeeded' ? final.output : null,
      tasks: workflow.tasks.map((task) => ({ ...records.get(task.id) })),
    };
    emit({ type: 'run_finished', status });
    return report;
  } finally {
    clearTimeout(runTimer);
    signal?.removeEventListener('abort', stop);
  }
}
