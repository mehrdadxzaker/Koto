import { runWorkflow, validateWorkflow } from '@mehrdadxzaker/koto';
import type {
  AgentAdapter,
  AgentAssignment,
  AgentConfig,
  AgentContext,
  AgentResult,
  NormalizedWorkflow,
  RunEvent,
  RunOptions,
  RunReport,
  RunStatus,
  Task,
  TaskReport,
  TaskStatus,
  Workflow,
} from '@mehrdadxzaker/koto';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type WorkflowIsTyped = Assert<IsAny<Workflow> extends false ? true : false>;
type AssignmentIsTyped = Assert<IsAny<AgentAssignment> extends false ? true : false>;
type EventsAreTyped = Assert<IsAny<RunEvent> extends false ? true : false>;
type FunctionIsTyped = Assert<IsAny<typeof runWorkflow> extends false ? true : false>;
type ResultIsTyped = Assert<IsAny<Awaited<ReturnType<typeof runWorkflow>>> extends false ? true : false>;

const authored = {
  schemaVersion: 1,
  goal: 'Contribute findings and integrate a result',
  agents: {
    worker: { command: '$node', args: ['worker.mjs'] },
    reviewer: { command: '$node', timeoutMs: 5000 },
  },
  tasks: [
    { id: 'analysis', agent: 'worker', prompt: 'Provide a finding' },
    { id: 'final', agent: 'reviewer', prompt: 'Integrate and check', dependsOn: ['analysis'] },
  ],
  finalTask: 'final',
} as const satisfies Workflow;

const config: AgentConfig = authored.agents.worker;
const task: Task = authored.tasks[1];
const normalized: NormalizedWorkflow = validateWorkflow(authored);
const defaultConcurrency: number = normalized.maxConcurrency;
const defaultDeadline: number = normalized.timeoutMs;
const normalizedWorker = normalized.agents.worker;
if (normalizedWorker) {
  const args: string[] = normalizedWorker.args;
  const timeout: number = normalizedWorker.timeoutMs;
  void args;
  void timeout;
}
const normalizedTask = normalized.tasks[0];
if (normalizedTask) {
  const dependencies: string[] = normalizedTask.dependsOn;
  void dependencies;
}

function normalizeExternal(input: unknown): NormalizedWorkflow {
  return validateWorkflow(input);
}

function inspectEvent(event: RunEvent): void {
  switch (event.type) {
    case 'run_started': {
      const status: 'running' = event.status;
      void status;
      return;
    }
    case 'task_started': {
      const status: 'running' = event.status;
      const id: string = event.taskId;
      const agent: string = event.agent;
      void status;
      void id;
      void agent;
      return;
    }
    case 'task_finished': {
      const status: TaskStatus = event.status;
      const id: string = event.taskId;
      void status;
      void id;
      return;
    }
    case 'run_finished': {
      const status: RunStatus = event.status;
      void status;
      return;
    }
    default: {
      const exhaustive: never = event;
      void exhaustive;
    }
  }
}

const synchronous: AgentAdapter = (assignment: AgentAssignment, context: AgentContext): AgentResult => {
  const dependency: string | undefined = assignment.inputs.analysis;
  const cwd: string | undefined = context.cwd;
  const signal: AbortSignal = context.signal;
  void cwd;
  void signal;
  return { output: dependency ?? assignment.task.prompt };
};

const options: RunOptions = {
  signal: new AbortController().signal,
  adapters: {
    worker: synchronous,
    reviewer: async (assignment, context) => {
      context.signal.throwIfAborted();
      return { output: assignment.inputs.analysis ?? assignment.goal };
    },
  },
  onEvent: event => inspectEvent(event),
};

function inspectTask(result: TaskReport): void {
  if (result.status === 'succeeded') {
    const output: string = result.output;
    const error: undefined = result.error;
    void output;
    void error;
  } else {
    const error: string = result.error;
    const output: undefined = result.output;
    void error;
    void output;
  }
}

async function useCore(): Promise<RunReport> {
  const report = await runWorkflow(authored, options);
  if (report.status === 'succeeded') {
    const output: string = report.output;
    void output;
  } else if (report.status === 'failed') {
    const output: null = report.output;
    void output;
  } else {
    const output: string | null = report.output;
    void output;
  }
  report.tasks.forEach(inspectTask);
  await runWorkflow(normalizeExternal(authored), {
    adapters: options.adapters,
    onEvent: async event => inspectEvent(event),
  });
  // An observer's return value is ignored by the runtime, including Array.push.
  const events: RunEvent[] = [];
  await runWorkflow(normalized, { onEvent: event => events.push(event) });
  return report;
}

void config;
void task;
void defaultConcurrency;
void defaultDeadline;
void useCore;
