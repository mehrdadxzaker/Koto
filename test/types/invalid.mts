import { runWorkflow, validateWorkflow } from '@mehrdadxzaker/koto';
import type {
  AgentAdapter,
  AgentAssignment,
  AgentConfig,
  AgentContext,
  RunEvent,
  RunReport,
  RunStatus,
  TaskReport,
  TaskStatus,
  Workflow,
} from '@mehrdadxzaker/koto';

const workflow = {
  schemaVersion: 1,
  goal: 'One checked result',
  agents: { worker: { command: '$node' } },
  tasks: [{ id: 'final', agent: 'worker', prompt: 'Complete the task' }],
  finalTask: 'final',
} as const satisfies Workflow;

// @ts-expect-error Only schema version 1 is supported.
const badVersion: Workflow = { ...workflow, schemaVersion: 2 };
// @ts-expect-error Every agent requires an executable command.
const missingCommand: AgentConfig = {};
// @ts-expect-error Executable arguments must be strings.
const invalidArgs: AgentConfig = { command: '$node', args: [42] };
// @ts-expect-error Concurrency is numeric.
runWorkflow({ ...workflow, maxConcurrency: 'two' });
// @ts-expect-error Options do not introduce a second concurrency setting.
runWorkflow(workflow, { concurrency: 2 });
// @ts-expect-error The working directory is a path string, not a URL.
runWorkflow(workflow, { cwd: new URL('file:///tmp') });
// @ts-expect-error Cancellation requires an actual AbortSignal interface.
runWorkflow(workflow, { signal: { aborted: false } });
// @ts-expect-error Lifecycle observers receive structured events.
runWorkflow(workflow, { onEvent: (_event: string) => {} });

declare const externalData: unknown;
// @ts-expect-error Validate untrusted input before using the typed runner.
runWorkflow(externalData);
runWorkflow(validateWorkflow(externalData));

// @ts-expect-error Every adapter result supplies text, not a number.
const invalidResult: AgentAdapter = () => ({ output: 42 });
// @ts-expect-error The adapter context always supplies its cancellation signal.
const incompleteContext: AgentContext = { cwd: '/work' };
// @ts-expect-error An assignment task requires its prompt.
const incompleteAssignment: AgentAssignment = { schemaVersion: 1, goal: 'Goal', task: { id: 'task' }, inputs: {} };

const checkAssignment: AgentAdapter = (assignment, context) => {
  // @ts-expect-error The core does not inject native tools into assignments.
  const tools = assignment.tools;
  // @ts-expect-error Dependency handoffs contain text outputs.
  assignment.inputs.analysis = 42;
  // @ts-expect-error Context does not provide provider credentials.
  const key = context.apiKey;
  void tools;
  void key;
  return { output: 'completed' };
};

function checkEvent(event: RunEvent): void {
  // @ts-expect-error Metadata events do not contain prompt content.
  const prompt = event.prompt;
  if (event.type === 'run_started') {
    // @ts-expect-error A started run is running, not terminal.
    const status: RunStatus = event.status;
    void status;
  }
  // @ts-expect-error Lifecycle metadata is readonly.
  event.type = 'run_finished';
  void prompt;
}

// @ts-expect-error Task report statuses are terminal.
const pending: TaskStatus = 'running';
// @ts-expect-error Successful runs always provide the final text output.
const missingOutput: RunReport = { schemaVersion: 1, status: 'succeeded', goal: 'Goal', finalTask: 'final', output: null, tasks: [] };

function checkReport(report: RunReport, task: TaskReport): void {
  if (report.status === 'canceled') {
    // @ts-expect-error Cancellation may leave no final output.
    const output: string = report.output;
    void output;
  }
  if (task.status === 'failed') {
    // @ts-expect-error Failed tasks do not have successful output.
    const output: string = task.output;
    void output;
  }
  if (task.status === 'succeeded') {
    // @ts-expect-error Successful tasks do not have a failure diagnostic.
    const error: string = task.error;
    void error;
  }
}

void badVersion;
void missingCommand;
void invalidArgs;
void invalidResult;
void incompleteContext;
void incompleteAssignment;
void checkAssignment;
void checkEvent;
void pending;
void missingOutput;
void checkReport;
