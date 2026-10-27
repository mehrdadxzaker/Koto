/** Explicit configuration for an executable worker. Bounds are checked at runtime. */
export interface AgentConfig {
  readonly command: string;
  readonly args?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
}

/** One contribution to a workflow, with handoffs from its direct dependencies. */
export interface Task {
  readonly id: string;
  readonly agent: string;
  readonly prompt: string;
  readonly dependsOn?: readonly string[] | undefined;
}

/** An authored workflow. Validation checks references, cycles and resource bounds. */
export interface Workflow {
  readonly schemaVersion: 1;
  readonly goal: string;
  readonly agents: Readonly<Record<string, AgentConfig>>;
  readonly tasks: readonly Task[];
  /** Omit for independent contributions without a single final text result. */
  readonly finalTask?: string | null | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface NormalizedAgentConfig {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface NormalizedTask {
  id: string;
  agent: string;
  prompt: string;
  dependsOn: string[];
}

/** A detached normalized copy, including all optional input defaults. */
export interface NormalizedWorkflow {
  schemaVersion: 1;
  goal: string;
  agents: Record<string, NormalizedAgentConfig>;
  tasks: NormalizedTask[];
  finalTask: string | null;
  maxConcurrency: number;
  timeoutMs: number;
}

export interface AgentAssignment {
  schemaVersion: 1;
  goal: string;
  task: {
    id: string;
    prompt: string;
  };
  inputs: Record<string, string>;
}

export interface AgentContext {
  cwd?: string | undefined;
  signal: AbortSignal;
}

export interface AgentResult {
  output: string;
}

/** Injected adapters must honor cancellation; the core cannot forcibly stop JS. */
export type AgentAdapter = (
  assignment: AgentAssignment,
  context: AgentContext,
) => AgentResult | PromiseLike<AgentResult>;

export type RunStatus = 'succeeded' | 'failed' | 'canceled';
export type TaskStatus = 'succeeded' | 'failed' | 'blocked' | 'canceled';

/** Frozen metadata only. Prompts, outputs and worker diagnostics are not events. */
export type RunEvent =
  | Readonly<{ type: 'run_started'; status: 'running' }>
  | Readonly<{ type: 'run_finished'; status: RunStatus }>
  | Readonly<{ type: 'task_started'; taskId: string; agent: string; status: 'running' }>
  | Readonly<{ type: 'task_finished'; taskId: string; agent: string; status: TaskStatus }>;

export interface RunOptions {
  cwd?: string | undefined;
  signal?: AbortSignal | undefined;
  /** Return values are ignored. Synchronous and asynchronous failures are contained. */
  onEvent?: ((event: RunEvent) => unknown) | undefined;
  adapters?: Readonly<Record<string, AgentAdapter>> | undefined;
}

export interface SucceededTaskReport {
  id: string;
  agent: string;
  status: 'succeeded';
  output: string;
  error?: never;
}

export interface UnsuccessfulTaskReport {
  id: string;
  agent: string;
  status: 'failed' | 'blocked' | 'canceled';
  error: string;
  output?: never;
}

export type TaskReport = SucceededTaskReport | UnsuccessfulTaskReport;

interface ReportBase {
  schemaVersion: 1;
  goal: string;
  finalTask: string | null;
}

export interface SucceededRunReport extends ReportBase {
  status: 'succeeded';
  output: string | null;
  tasks: SucceededTaskReport[];
}

export interface FailedRunReport extends ReportBase {
  status: 'failed';
  output: null;
  tasks: TaskReport[];
}

export interface CanceledRunReport extends ReportBase {
  status: 'canceled';
  /** A final output may already exist when cancellation is observed. */
  output: string | null;
  tasks: TaskReport[];
}

/** Success establishes completed execution, not semantic correctness. */
export type RunReport = SucceededRunReport | FailedRunReport | CanceledRunReport;

/** Validate untrusted data and return a normalized copy without launching agents. */
export function validateWorkflow(input: unknown): NormalizedWorkflow;

/** Execute an authored or validated workflow, without automatic retry or replay. */
export function runWorkflow(source: Workflow, options?: RunOptions): Promise<RunReport>;

/** A real executable with caller-selected native arguments and permissions. */
export interface ProjectAgentPlan {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly task: string;
  /** Relative paths or directories checked again before integration; not a sandbox. */
  readonly owns: readonly string[];
  readonly timeoutMs?: number | undefined;
  /** closed sends EOF after optional input; pipe permits explicit :send / :eof. */
  readonly inputMode?: 'closed' | 'pipe' | undefined;
  readonly input?: string | undefined;
  readonly unsetEnv?: readonly string[] | undefined;
}

export interface ProjectPlan {
  readonly schemaVersion: 1;
  readonly project: string;
  readonly goal: string;
  readonly agents: readonly ProjectAgentPlan[];
  readonly controlRoot?: string | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface ProjectWorkspace {
  path: string;
  branch: string;
  sessionRoot: string;
}

export interface CommandOutcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  exitCode: number | null;
  signal?: string | undefined;
  error?: string | undefined;
}

export interface ProjectIntegration {
  status: 'integrated' | 'conflicts' | 'unchanged';
  workspace: ProjectWorkspace;
  integration: ProjectWorkspace;
  snapshotCommit: string | null;
  contributionCommit?: string | undefined;
  reviewTree: string;
  integrationCommit: string;
  conflicts: string[];
}

export interface ProjectAgentState extends ProjectAgentPlan {
  workspace: ProjectWorkspace;
  status: 'pending' | 'running' | CommandOutcome['status'];
  result?: CommandOutcome | undefined;
  commandOutcome?: CommandOutcome | undefined;
  setupError?: string | undefined;
  pid?: number | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  integration?: ProjectIntegration | undefined;
}

export interface ProjectSessionState {
  schemaVersion: 1;
  kind: 'koto-project-session';
  sessionId: string;
  createdAt: string;
  sessionRoot: string;
  projectRoot: string;
  baseCommit: string;
  goal: string;
  ownerPid: number;
  active: boolean;
  started: boolean;
  integration: ProjectWorkspace;
  agents: ProjectAgentState[];
  finishedAt?: string | undefined;
  report?: { status: RunStatus; error?: string | undefined } | undefined;
}

export interface ProjectInspection extends ProjectWorkspace {
  agentId: string;
  agentStatus: ProjectAgentState['status'];
  owns: readonly string[];
  outsideOwnership: string[];
  baseCommit: string;
  headCommit: string;
  tree?: string | undefined;
  clean: boolean;
  status: { code: string; path: string; originalPath?: string | undefined }[];
  changedPaths: string[];
  diff: string;
  untracked: { path: string; bytes: number; blob: string; kind: string }[];
  conflicts: string[];
  reviewToken: string | null;
}

/** Unlike workflow metadata, project events include private native stdout/stderr. */
export type ProjectEvent = Readonly<{
  type: string;
  sessionId: string;
  sequence: number;
  time: string;
  agentId?: string | undefined;
  stream?: 'stdout' | 'stderr' | undefined;
  text?: string | undefined;
  status?: string | undefined;
  pid?: number | undefined;
  error?: string | undefined;
  taskId?: string | undefined;
  agent?: string | undefined;
  workspace?: string | undefined;
}>;

export interface ProjectReport {
  status: RunStatus;
  error?: string | undefined;
  sessionRoot: string;
  integration: ProjectWorkspace;
  agents: ProjectAgentState[];
}

export interface ProjectSession {
  readonly sessionRoot: string;
  run(): Promise<ProjectReport>;
  stop(agentId?: string | undefined): void;
  send(agentId: string, text: string): boolean;
  endInput(agentId: string): boolean;
  status(): ProjectSessionState;
  inspect(agentId: string): Promise<ProjectInspection>;
  integrate(agentId: string, options: { approve: string }): Promise<ProjectIntegration>;
}

export function validateProjectPlan(input: unknown): ProjectPlan;
export function createProjectSession(source: ProjectPlan, options?: {
  onEvent?: ((event: ProjectEvent) => unknown) | undefined;
  signal?: AbortSignal | undefined;
}): Promise<ProjectSession>;
export function inspectProjectSession(sessionRoot: string, agentId: string): Promise<ProjectInspection>;
export function integrateProjectSession(sessionRoot: string, agentId: string, options: { approve: string }): Promise<ProjectIntegration>;
