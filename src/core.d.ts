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
  readonly dependsOn?: readonly string[] | undefined;
  readonly nativeKind?: 'codex' | 'claude' | 'local' | undefined;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  readonly account?: string | undefined;
  readonly localEndpoint?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** pipe remains the default. pty currently requires an explicit local Mac helper build. */
  readonly transport?: 'pipe' | 'pty' | undefined;
  readonly terminal?: { readonly columns?: number | undefined; readonly rows?: number | undefined } | undefined;
  /** Defaults to closed for pipe transport and pipe for PTY; closed sends EOF after optional input. */
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
  readonly nativeHelperDirectory?: string | undefined;
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
  errorMessage?: string | undefined;
  text?: string | undefined;
  sessionId?: string | undefined;
  usage?: Record<string, unknown> | undefined;
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
  status: 'pending' | 'running' | 'blocked' | CommandOutcome['status'];
  result?: CommandOutcome | undefined;
  commandOutcome?: CommandOutcome | undefined;
  setupError?: string | undefined;
  pid?: number | undefined;
  terminalSessionId?: number | undefined;
  nativeSessionId?: string | undefined;
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
  terminalSessionId?: number | undefined;
  columns?: number | undefined;
  rows?: number | undefined;
  transport?: 'pipe' | 'pty' | undefined;
  platform?: string | undefined;
  nativeSessionId?: string | undefined;
  activity?: string | undefined;
  description?: string | undefined;
  model?: string | undefined;
  command?: string | undefined;
  tool?: string | undefined;
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
  send(agentId: string, input: string | Uint8Array): boolean;
  endInput(agentId: string): boolean;
  resize(agentId: string, columns: number, rows: number): boolean;
  outputTail(agentId: string): string;
  status(): ProjectSessionState;
  inspect(agentId: string): Promise<ProjectInspection>;
  integrate(agentId: string, options: { approve: string }): Promise<ProjectIntegration>;
}

export function validateProjectPlan(input: unknown): ProjectPlan;
export function createProjectSession(source: ProjectPlan, options?: {
  onEvent?: ((event: ProjectEvent) => unknown) | undefined;
  signal?: AbortSignal | undefined;
  onApproval?: ((request: Record<string, unknown>) => Promise<boolean>) | undefined;
}): Promise<ProjectSession>;
export function inspectProjectSession(sessionRoot: string, agentId: string): Promise<ProjectInspection>;
export function integrateProjectSession(sessionRoot: string, agentId: string, options: { approve: string }): Promise<ProjectIntegration>;

export interface DarwinPtyBuildReceipt {
  path: string;
  platform: string;
  arch: string;
  sourceSha256: string;
  binarySha256: string;
  compiler: string;
  [key: string]: unknown;
}
/** Explicit opt-in local compilation; never downloads or installs toolchains. */
export function buildDarwinPtyHelper(options?: { directory?: string | undefined }): Promise<DarwinPtyBuildReceipt>;
/** Verify existing source/build identity without compiling or launching an agent. */
export function resolveDarwinPtyHelper(options?: { directory?: string | undefined }): Promise<string>;

export interface AgentProfileOptions {
  kind: 'codex' | 'opencode';
  id: string;
  command: string;
  model?: string | undefined;
  effort?: string | undefined;
  task: string;
  owns: readonly string[];
  account?: 'host' | 'chatgpt' | undefined;
  timeoutMs?: number | undefined;
}
export function createAgentProfile(options: AgentProfileOptions): ProjectAgentPlan;
export function describeAgentProfile(kind: 'codex' | 'opencode'): Readonly<{
  kind: 'codex' | 'opencode'; name: string; verifiedCliVersion: string;
  commandMode: string; transport: 'pipe'; inputMode: 'closed'; readonly accountChoices: readonly string[];
}>;
export const AGENT_PROFILE_DEFAULTS: Readonly<{
  codex: Readonly<{ recommendedModel: string; recommendedEffort: string; timeoutMs: number }>;
  opencode: Readonly<{ timeoutMs: number }>;
}>;
export function resolveAgentExecutable(command: string): Promise<string>;
export function inspectLaunchProject(projectPath?: string | undefined): Promise<{
  projectRoot: string; baseCommit: string; branch?: string | undefined;
}>;

export interface AgentSessionResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  text: string;
  sessionId?: string | undefined;
  exitCode?: number | null | undefined;
  signal?: string | undefined;
  error?: string | undefined;
  errorMessage?: string | undefined;
  usage?: Record<string, unknown> | undefined;
}
export interface AgentSession {
  readonly sessionId?: string | undefined;
  readonly pid?: number | null | undefined;
  send(text: string, options?: { signal?: AbortSignal | undefined }): Promise<AgentSessionResult>;
  stop(): void;
  close?(): Promise<CommandOutcome>;
}
export interface NativeAgentOptions {
  kind: 'codex' | 'claude';
  id?: string | undefined;
  command: string;
  cwd: string;
  model?: string | undefined;
  effort?: string | undefined;
  account?: 'host' | 'chatgpt' | 'subscription' | undefined;
  mode?: 'conversation' | 'coding' | undefined;
  timeoutMs?: number | undefined;
  sessionId?: string | undefined;
  onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined;
}
export function createNativeAgentSession(options: NativeAgentOptions): AgentSession;
export function createLocalAgentSession(options: {
  id?: string | undefined; endpoint: string; model: string; cwd: string;
  mode?: 'conversation' | 'coding' | undefined; timeoutMs?: number | undefined;
  maxTurns?: number | undefined; maxOutputTokens?: number | undefined;
  onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined;
  onApproval?: ((request: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>) | undefined;
}): AgentSession;
export function prepareProject(options: {
  directory: string; create?: boolean | undefined; approveCreate?: boolean | undefined;
}): Promise<{ projectRoot: string; baseCommit: string; branch?: string | undefined; created: boolean }>;
export interface BuildProposal {
  readonly schemaVersion: 1; readonly kind: 'koto-build-proposal'; readonly id: string;
  readonly summary: string; readonly fingerprint: string; readonly plan: ProjectPlan;
  readonly project: { readonly projectRoot: string; readonly baseCommit: string; readonly branch?: string | undefined };
  readonly tasks: readonly { readonly id: string; readonly worker: string; readonly task: string;
    readonly owns: readonly string[]; readonly dependsOn: readonly string[]; readonly label: string; readonly model?: string | undefined }[];
  readonly warnings: readonly string[];
}
export function createCoordinator(options: { session: AgentSession }): {
  readonly sessionId?: string | undefined; stop(): void;
  routeMessage(text: string, options?: { signal?: AbortSignal | undefined; context?: string | undefined }): Promise<{
    action: 'chat' | 'build'; message: string; goal?: string | undefined; sessionId?: string | undefined;
  }>;
  plan(goal: string, options: { project: string; workers: readonly (Partial<ProjectAgentPlan> & {
    id: string; command: string; args: readonly string[]; label?: string | undefined })[];
    signal?: AbortSignal | undefined; timeoutMs?: number | undefined; maxConcurrency?: number | undefined;
    controlRoot?: string | undefined; nativeHelperDirectory?: string | undefined }): Promise<BuildProposal>;
  prepare(proposal: BuildProposal, options?: { onEvent?: ((event: ProjectEvent) => unknown) | undefined; signal?: AbortSignal | undefined }): Promise<ProjectSession>;
  execute(proposal: BuildProposal, options: { approved: true; onEvent?: ((event: ProjectEvent) => unknown) | undefined; signal?: AbortSignal | undefined }): Promise<ProjectReport>;
};
export const defaultStateDirectory: string;
export function loadPreferences(options?: { directory?: string | undefined }): Promise<Record<string, unknown>>;
export function savePreferences(preferences: Record<string, unknown>, options?: { directory?: string | undefined }): Promise<void>;
export interface LocalModelMetadata { id: string; bytes?: number | undefined; digest?: string | undefined; }
export interface LocalEndpointMetadata { kind: 'ollama' | 'llama'; endpoint: string; apiBaseUrl: string; status: 'ready'; models: LocalModelMetadata[]; }
export function checkLocalEndpoint(options?: { kind?: 'ollama' | 'llama' | undefined; endpoint?: string | undefined; signal?: AbortSignal | undefined }): Promise<LocalEndpointMetadata>;
export function discoverLocalModels(options?: Record<string, unknown>): Promise<Record<string, Partial<LocalEndpointMetadata> & {
  reachable: boolean; executable?: string | undefined; error?: string | undefined; message?: string | undefined;
}>>;
export function pullOllamaModel(options: { model: string; command?: string | undefined; endpoint?: string | undefined;
  timeoutMs?: number | undefined; signal?: AbortSignal | undefined; onProgress?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined }): Promise<LocalModelMetadata & { endpoint: string; apiBaseUrl: string; executable: string }>;
export function startLlamaServer(options: { modelPath: string; command?: string | undefined; port?: number | undefined;
  contextSize?: number | undefined; memoryLimitBytes?: number | undefined; minimumFreeBytes?: number | undefined;
  gpuLayers?: number | undefined; modelId?: string | undefined; startupTimeoutMs?: number | undefined;
  timeoutMs?: number | undefined; signal?: AbortSignal | undefined; onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined }): Promise<{
    readonly pid: number | null; readonly endpoint: string; readonly apiBaseUrl: string; readonly modelId: string;
    readonly ready: Promise<LocalEndpointMetadata>; readonly completion: Promise<CommandOutcome>;
    stop(): Promise<CommandOutcome>;
  }>;
export function downloadGguf(options: { url: string; destination: string; sha256: string; maxBytes: number;
  timeoutMs?: number | undefined; signal?: AbortSignal | undefined;
  onProgress?: ((event: { type: 'download'; bytes: number; totalBytes?: number | undefined }) => unknown) | undefined }): Promise<{ path: string; bytes: number; sha256: string; source: string }>;
export function buildLlamaRuntime(options: { commit: string; installDirectory: string; sourceDirectory?: string | undefined;
  approveBuild: true; jobs?: number | undefined; timeoutMs?: number | undefined; minimumFreeBytes?: number | undefined;
  signal?: AbortSignal | undefined; onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined }): Promise<{ path: string; receiptPath: string; [key: string]: unknown }>;
