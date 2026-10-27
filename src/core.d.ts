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

export type NativeAgentKind = 'codex' | 'opencode';
export type ProjectTransport = 'pipe' | 'pty';
export type NativeAgentProtocol = 'jsonl' | 'terminal';
export type CodexReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type CodexSandbox = 'read-only' | 'workspace-write';

/** An explicit adapter declaration; executable names do not imply a protocol. */
export type NativeAgentMetadata = Readonly<{
  kind: 'codex';
  protocol?: NativeAgentProtocol | undefined;
  account?: 'host' | 'chatgpt' | undefined;
  model?: string | undefined;
  effort?: CodexReasoningEffort | undefined;
  sandbox?: CodexSandbox | undefined;
}> | Readonly<{
  kind: 'opencode';
  protocol?: NativeAgentProtocol | undefined;
  account?: 'host' | undefined;
  model?: string | undefined;
  effort?: never;
  sandbox?: never;
}>;

/** Protocol capabilities do not establish authentication or host verification. */
export interface NativeAgentCapabilities {
  readonly structuredEvents: boolean;
  readonly nativeSessionId: boolean;
  readonly completion: boolean;
  readonly usage: boolean;
  readonly resume: boolean;
  readonly interactiveInput: boolean;
  readonly permissionRequests: false;
  readonly permissionDecisions: boolean;
  readonly terminalOutput: boolean;
}

export function describeNativeCapabilities(
  kind: NativeAgentKind | NativeAgentMetadata,
  transport?: ProjectTransport | undefined,
): NativeAgentCapabilities;

export type NativeAgentStatus = 'unobserved' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';

export interface NativeAgentUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  cost: number | null;
}

/** Bounded native lifecycle metadata, separate from process cleanup and correctness. */
export interface NativeAgentState {
  schemaVersion: 1;
  kind: NativeAgentKind;
  protocol: NativeAgentProtocol;
  affinity: string;
  capabilities: NativeAgentCapabilities;
  sessionId: string | null;
  status: NativeAgentStatus;
  ended: boolean;
  /** Resume still requires settled ownership, matching origin and retained native history. */
  resumable: boolean;
  turnsCompleted: number;
  turnsFailed: number;
  stepsCompleted: number;
  permissionsDenied: number;
  diagnostics: number;
  unknownEvents: number;
  usage: NativeAgentUsage;
  protocolError?: string | undefined;
}

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
  /** Defaults to pipe. PTY requires the explicitly built helper for the host platform. */
  readonly transport?: ProjectTransport | undefined;
  readonly native?: NativeAgentMetadata | undefined;
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
  readonly prerequisites?: Readonly<Record<string, ProjectPrerequisite>> | undefined;
}

export interface ProjectPrerequisite {
  readonly configFile?: string | undefined;
  readonly localEndpoint?: string | undefined;
  readonly model?: string | undefined;
}

export interface NativeProjectAgentPlan {
  readonly id: string;
  readonly runtime: NativeAgentKind;
  readonly model: string;
  readonly task: string;
  readonly owns: readonly string[];
  readonly command?: string | undefined;
  /** Native launch presets default to PTY; explicit profiles default to pipe. */
  readonly transport?: ProjectTransport | undefined;
  readonly terminal?: ProjectAgentPlan['terminal'];
  readonly timeoutMs?: number | undefined;
  readonly unsetEnv?: readonly string[] | undefined;
  /** Codex presets require an existing ChatGPT login. */
  readonly auth?: 'chatgpt' | undefined;
  readonly sandbox?: CodexSandbox | undefined;
  /** OpenCode presets require explicitly configured local provider/model settings. */
  readonly localRuntime?: { readonly configFile: string; readonly endpoint: string } | undefined;
}

export interface ProjectLaunchPlan extends Omit<ProjectPlan, 'agents'> {
  readonly agents: readonly (NativeProjectAgentPlan | (ProjectAgentPlan & { readonly runtime: 'command' }))[];
}

export interface ProjectPreflight {
  schemaVersion: 1;
  /** No blocking prerequisites; does not establish native agent/model readiness. */
  ok: boolean;
  checks: { id: string; agentId?: string; status: 'ready' | 'blocked' | 'unverified'; message: string }[];
  executables: Record<string, string>;
}

/** Build explicit native argv without executing an agent or changing settings. */
export function buildProjectPlan(source: ProjectLaunchPlan): ProjectPlan;
/** Inspect executable, repository, transport and declared runtime prerequisites. */
export function preflightProjectPlan(source: ProjectPlan): Promise<ProjectPreflight>;

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
  textTruncated?: boolean | undefined;
  sessionId?: string | undefined;
  usage?: Record<string, unknown> | undefined;
}

export interface ProjectStatusEntry {
  code: string;
  path: string;
  originalPath?: string | undefined;
}

export interface ProjectIntegrationResult {
  status: 'integrated' | 'conflicts' | 'unchanged';
  workspace: ProjectWorkspace;
  integration: ProjectWorkspace;
  snapshotCommit: string | null;
  contributionCommit?: string | undefined;
  /** Missing only on receipts retained by an older package. */
  contributionBaseCommit?: string | undefined;
  reviewTree: string;
  integrationCommit: string;
  conflicts: string[];
  statusEntries?: ProjectStatusEntry[] | undefined;
  /** Prior integration HEAD whose conflicts were explicitly resolved and acknowledged. */
  resolvedFromCommit?: string | undefined;
}

/** Compatibility name for the integration receipt. */
export type ProjectIntegration = ProjectIntegrationResult;

export type ContributionResolution = 'record-result' | 'not-applied';

/** Inspection never applies changes or derives a successful result from a ref. */
export interface ProjectContributionAttemptInspection {
  attemptId: string;
  agentId: string;
  operation: 'integrate' | 'resolve';
  phase: 'running' | 'receipt-retained' | 'state-recorded' | 'unresolved';
  ownerPid: number;
  ownerLive: boolean;
  /** Approval binds the retained attempt, session and observed source/target state. */
  reviewToken: string;
  before: {
    sourceHead: string;
    integrationHead: string;
    reviewTree: string;
    contributionBaseCommit: string;
  };
  current: {
    sourceHead: string;
    integrationHead: string;
    sourceTree: string | null;
    integrationTree: string | null;
    sourceStatus: ProjectStatusEntry[];
    integrationStatus: ProjectStatusEntry[];
    cherryPickHead: string | null;
    sourceReviewToken: string | null;
    integrationStateToken: string;
  };
  possibleResolutions: ContributionResolution[];
  observedResult?: ProjectIntegrationResult | undefined;
  evidenceError?: string | undefined;
}

export interface ProjectContributionReconciliation {
  status: 'reconciled';
  attemptId: string;
  resolution: ContributionResolution;
  integration?: ProjectIntegrationResult | undefined;
}

export interface ProjectContributionReconciliationOptions {
  approve: string;
  resolution: ContributionResolution;
  onEvent?: ((event: ProjectEvent) => unknown) | undefined;
}

export interface ProjectAgentAttempt {
  number: number;
  kind: 'initial' | 'resume';
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  result?: CommandOutcome | undefined;
  nativeState?: NativeAgentState | undefined;
}

export interface ProjectAgentState extends ProjectAgentPlan {
  workspace: ProjectWorkspace;
  status: 'pending' | 'running' | 'blocked' | CommandOutcome['status'];
  result?: CommandOutcome | undefined;
  commandOutcome?: CommandOutcome | undefined;
  setupError?: string | undefined;
  activity?: Readonly<{ type: string; time: string; activity?: string | undefined;
    description?: string | undefined; status?: string | undefined; tool?: string | undefined;
    command?: string | undefined; model?: string | undefined }> | undefined;
  pid?: number | undefined;
  terminalSessionId?: number | undefined;
  nativeSessionId?: string | undefined;
  nativeOrigin?: string | undefined;
  localSessionId?: string | undefined;
  localContinuation?: LocalConversationState | undefined;
  localContinuationUnavailableReason?: string | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  nativeState?: NativeAgentState | undefined;
  attempts?: ProjectAgentAttempt[] | undefined;
  integration?: ProjectIntegrationResult | undefined;
  lastSuccessfulIntegration?: (ProjectIntegrationResult & { status: 'integrated' }) | undefined;
  /** Correlates a retained integration receipt with its approved attempt. */
  lastContributionAttemptId?: string | undefined;
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
  timeoutMs: number;
  maxConcurrency: number;
  prerequisites?: Readonly<Record<string, ProjectPrerequisite>> | undefined;
  nativeHelperDirectory?: string | undefined;
  ownerPid: number;
  active: boolean;
  started: boolean;
  integration: ProjectWorkspace;
  agents: ProjectAgentState[];
  eventSequence?: number | undefined;
  finishedAt?: string | undefined;
  report?: { status: RunStatus; error?: string | undefined } | undefined;
}

export interface ProjectInspection extends ProjectWorkspace {
  agentId: string;
  agentStatus: ProjectAgentState['status'];
  owns: readonly string[];
  outsideOwnership: string[];
  baseCommit: string;
  /** The preceding integrated snapshot, or the original base for a first contribution. */
  contributionBaseCommit: string;
  headCommit: string;
  tree?: string | undefined;
  clean: boolean;
  status: ProjectStatusEntry[];
  /** Complete contribution since the original session base. */
  changedPaths: string[];
  diff: string;
  /** Only the delta that the next integration would apply. */
  integrationChangedPaths: string[];
  integrationDiff: string;
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
  nativeSessionId?: string | null | undefined;
  nativeStatus?: NativeAgentStatus | undefined;
  columns?: number | undefined;
  rows?: number | undefined;
  transport?: ProjectTransport | undefined;
  platform?: string | undefined;
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
  /** Reviewable invocation; a resumed plan contains the exact continuation argv. */
  readonly launchPlan: ProjectPlan;
  run(): Promise<ProjectReport>;
  stop(agentId?: string | undefined): void;
  send(agentId: string, input: string | Uint8Array): boolean;
  endInput(agentId: string): boolean;
  resize(agentId: string, columns: number, rows: number): boolean;
  outputTail(agentId: string): string;
  status(): ProjectSessionState;
  inspect(agentId: string): Promise<ProjectInspection>;
  integrate(agentId: string, options: { approve: string }): Promise<ProjectIntegrationResult>;
  /** Acknowledge a manually reviewed, committed conflict resolution; does not edit Git content. */
  resolveIntegration(agentId: string, commit: string): Promise<ProjectIntegrationResult>;
  inspectContributionAttempt(): Promise<ProjectContributionAttemptInspection | null>;
  /** Acknowledge an observed outcome without replay, rollback or agent execution. */
  reconcileContributionAttempt(options: Omit<ProjectContributionReconciliationOptions, 'onEvent'>): Promise<ProjectContributionReconciliation>;
}

export interface ProjectSessionOptions {
  onEvent?: ((event: ProjectEvent) => unknown) | undefined;
  signal?: AbortSignal | undefined;
  onApproval?: ((request: Record<string, unknown>) => Promise<boolean>) | undefined;
}

export function validateProjectPlan(input: unknown): ProjectPlan;
export function createProjectSession(source: ProjectPlan, options?: ProjectSessionOptions): Promise<ProjectSession>;
/** Prepare an explicit continuation of the captured native ID; run() launches it once. */
export function resumeProjectSession(sessionRoot: string, agentId: string,
  options: ProjectSessionOptions & { prompt: string }): Promise<ProjectSession>;
/** Read a detached retained state snapshot without launching or resuming a process. */
export function readProjectSession(sessionRoot: string): ProjectSessionState;
export function inspectProjectSession(sessionRoot: string, agentId: string): Promise<ProjectInspection>;
export function integrateProjectSession(sessionRoot: string, agentId: string,
  options: { approve: string; onEvent?: ((event: ProjectEvent) => unknown) | undefined }): Promise<ProjectIntegrationResult>;
/** Retain approval of the exact clean integration commit after manual conflict resolution. */
export function finalizeProjectSessionIntegration(sessionRoot: string, agentId: string, options: {
  approveIntegrationCommit: string;
  onEvent?: ((event: ProjectEvent) => unknown) | undefined;
}): Promise<ProjectIntegrationResult>;
export function inspectProjectContributionAttempt(sessionRoot: string): Promise<ProjectContributionAttemptInspection | null>;
export function reconcileProjectContributionAttempt(sessionRoot: string,
  options: ProjectContributionReconciliationOptions): Promise<ProjectContributionReconciliation>;

export interface NativeHelperBuildOptions {
  directory?: string | undefined;
}

interface NativeHelperBuildReceiptBase {
  schemaVersion: 1;
  helperProtocolVersion: 1;
  path: string;
  arch: 'arm64' | 'x64';
  sourceSha256: string;
  binarySha256: string;
  compiler: string;
  compilerVersion: string;
  builtAt: string;
  sourceBytes: number;
  binaryBytes: number;
}

export interface DarwinPtyBuildReceipt extends NativeHelperBuildReceiptBase {
  kind: 'koto-darwin-pty-helper-build';
  platform: 'darwin';
  sdk: string;
}

export interface LinuxPtyBuildReceipt extends NativeHelperBuildReceiptBase {
  kind: 'koto-linux-pty-helper-build';
  platform: 'linux';
}

export interface WindowsPtyBuildReceipt extends NativeHelperBuildReceiptBase {
  kind: 'koto-windows-pty-helper-build';
  platform: 'win32';
}

export type TerminalHelperBuildReceipt = DarwinPtyBuildReceipt | LinuxPtyBuildReceipt | WindowsPtyBuildReceipt;

/** Explicit opt-in local compilation; never downloads or installs toolchains. */
export function buildDarwinPtyHelper(options?: NativeHelperBuildOptions): Promise<DarwinPtyBuildReceipt>;
/** Verify existing source/build identity without compiling or launching an agent. */
export function resolveDarwinPtyHelper(options?: NativeHelperBuildOptions): Promise<string>;
/** Explicitly build the helper for the current macOS, Linux or Windows host. */
export function buildTerminalHelper(options?: NativeHelperBuildOptions): Promise<TerminalHelperBuildReceipt>;
/** Verify the current host helper without compiling, downloading or starting an agent. */
export function resolveTerminalHelper(options?: NativeHelperBuildOptions): Promise<string>;

export interface AgentProfileOptions {
  kind: NativeAgentKind;
  id: string;
  command: string;
  model?: string | undefined;
  effort?: CodexReasoningEffort | undefined;
  task: string;
  owns: readonly string[];
  account?: 'host' | 'chatgpt' | undefined;
  timeoutMs?: number | undefined;
  transport?: ProjectTransport | undefined;
  sandbox?: CodexSandbox | undefined;
}
export function createAgentProfile(options: AgentProfileOptions): ProjectAgentPlan;
export interface AgentProfileDescription {
  readonly kind: NativeAgentKind;
  readonly name: string;
  readonly verifiedCliVersion: string;
  readonly commandMode: 'exec' | 'run' | 'interactive';
  readonly transport: ProjectTransport;
  readonly inputMode: 'closed' | 'pipe';
  readonly transports: readonly ProjectTransport[];
  readonly capabilities: NativeAgentCapabilities;
  readonly accountChoices: readonly ('host' | 'chatgpt')[];
}
export function describeAgentProfile(kind: NativeAgentKind,
  options?: { transport?: ProjectTransport | undefined }): AgentProfileDescription;
export const AGENT_PROFILE_DEFAULTS: Readonly<{
  codex: Readonly<{ recommendedModel: string; recommendedEffort: CodexReasoningEffort; timeoutMs: number }>;
  opencode: Readonly<{ timeoutMs: number }>;
}>;
export function resolveAgentExecutable(command: string, options?: { unsetEnv?: readonly string[] }): Promise<string>;
export function inspectLaunchProject(projectPath?: string | undefined,
  options?: { nativeHelperDirectory?: string | undefined }): Promise<{
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
  continuation?: LocalConversationState | undefined;
  continuationUnavailableReason?: string | undefined;
}
export interface AgentSession {
  readonly sessionId?: string | undefined;
  readonly pid?: number | null | undefined;
  send(text: string, options?: { signal?: AbortSignal | undefined }): Promise<AgentSessionResult>;
  stop(): void;
  close?(): Promise<CommandOutcome | undefined>;
  snapshot?(): LocalConversationState;
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
  unsetEnv?: readonly string[] | undefined;
}
export function createNativeAgentSession(options: NativeAgentOptions): AgentSession;
export interface LocalConversationState {
  schemaVersion: 1; kind: 'koto-local-conversation'; sessionId: string; agentId: string;
  endpoint: string; model: string; cwd: string; mode: 'conversation' | 'coding';
  policy: Readonly<Record<string, unknown>>; history: readonly unknown[];
}
export interface LocalAgentOptions {
  id?: string | undefined; endpoint: string; model: string; cwd: string;
  mode?: 'conversation' | 'coding' | undefined; timeoutMs?: number | undefined;
  maxTurns?: number | undefined; maxOutputTokens?: number | undefined;
  onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined;
  onApproval?: ((request: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>) | undefined;
  resumeState?: LocalConversationState | undefined;
  unsetEnv?: readonly string[] | undefined;
}
export function createLocalAgentSession(options: LocalAgentOptions): AgentSession;
export type CodingAgentOptions = (Omit<NativeAgentOptions, 'account'> & {
  account?: 'chatgpt' | 'subscription' | undefined;
  onApproval?: ((request: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>) | undefined;
}) | (LocalAgentOptions & { kind: 'local' });
export function createCodingAgentSession(options: CodingAgentOptions): AgentSession;
export type NativeControlAgentOptions = Omit<NativeAgentOptions, 'kind' | 'account'> & {
  onApproval?: ((request: Readonly<Record<string, unknown>>) => 'approve' | 'deny' | Promise<'approve' | 'deny'>) | undefined;
};
export function createCodexAppServerSession(options: NativeControlAgentOptions & { account?: 'chatgpt' | undefined }): AgentSession;
export function createClaudeAgentSession(options: NativeControlAgentOptions & { account?: 'subscription' | undefined }): AgentSession;
export function prepareProject(options: {
  directory: string; create?: boolean | undefined; approveCreate?: boolean | undefined;
}): Promise<{ projectRoot: string; baseCommit: string; branch?: string | undefined; created: boolean }>;
export interface BuildTaskInput {
  readonly id: string; readonly worker: string; readonly task: string;
  readonly owns: readonly string[]; readonly dependsOn?: readonly string[] | undefined;
}
export interface BuildProposal {
  readonly schemaVersion: 1; readonly kind: 'koto-build-proposal'; readonly id: string;
  readonly summary: string; readonly fingerprint: string; readonly plan: ProjectPlan;
  readonly createdAt: string; readonly revisionOf?: string | undefined;
  readonly coordinatorSessionId?: string | undefined; readonly usage?: Record<string, unknown> | undefined;
  readonly workers: readonly { readonly id: string; readonly label: string; readonly model?: string | undefined }[];
  readonly project: { readonly projectRoot: string; readonly baseCommit: string; readonly branch?: string | undefined };
  readonly tasks: readonly { readonly id: string; readonly worker: string; readonly task: string;
    readonly owns: readonly string[]; readonly dependsOn: readonly string[]; readonly label: string; readonly model?: string | undefined }[];
  readonly warnings: readonly string[];
}
export function createCoordinator(options: { session: AgentSession }): {
  readonly sessionId?: string | undefined; stop(): void;
  routeMessage(text: string, options?: { signal?: AbortSignal | undefined; context?: string | undefined }): Promise<{
    action: 'chat' | 'build'; message: string; goal?: string | undefined; sessionId?: string | undefined;
    usage?: Record<string, unknown> | undefined;
  }>;
  plan(goal: string, options: { project: string; workers: readonly (Partial<ProjectAgentPlan> & {
    id: string; command: string; args: readonly string[]; label?: string | undefined })[];
    signal?: AbortSignal | undefined; timeoutMs?: number | undefined; maxConcurrency?: number | undefined;
    controlRoot?: string | undefined; nativeHelperDirectory?: string | undefined }): Promise<BuildProposal>;
  /** Locally revise a proposal issued by this coordinator; no model call or workspace launch. */
  revise(proposal: BuildProposal, changes?: { tasks?: readonly BuildTaskInput[] | undefined;
    maxConcurrency?: number | undefined; summary?: string | undefined }): BuildProposal;
  prepare(proposal: BuildProposal, options?: ProjectSessionOptions): Promise<ProjectSession>;
  execute(proposal: BuildProposal, options: ProjectSessionOptions & { approved: true }): Promise<ProjectReport>;
};
export const defaultStateDirectory: string;
export function loadPreferences(options?: { directory?: string | undefined }): Promise<Record<string, unknown>>;
export function savePreferences(preferences: Record<string, unknown>, options?: { directory?: string | undefined }): Promise<void>;
export interface LocalModelMetadata { id: string; bytes?: number | undefined; digest?: string | undefined; }
export interface LocalEndpointMetadata { kind: 'ollama' | 'llama'; endpoint: string; apiBaseUrl: string; status: 'ready'; models: LocalModelMetadata[]; }
export function checkLocalEndpoint(options?: { kind?: 'ollama' | 'llama' | undefined; endpoint?: string | undefined; signal?: AbortSignal | undefined }): Promise<LocalEndpointMetadata>;
export interface LocalRuntimeDiscovery extends Omit<LocalEndpointMetadata, 'status'> {
  reachable: boolean; executable?: string | undefined; status?: 'ready' | undefined;
  error?: string | undefined; message?: string | undefined;
}
export function discoverLocalModels(options?: { ollamaCommand?: string | undefined; llamaCommand?: string | undefined;
  ollamaEndpoint?: string | undefined; llamaEndpoint?: string | undefined; signal?: AbortSignal | undefined;
}): Promise<Record<'ollama' | 'llama', LocalRuntimeDiscovery>>;
export function pullOllamaModel(options: { model: string; command?: string | undefined; endpoint?: string | undefined;
  timeoutMs?: number | undefined; signal?: AbortSignal | undefined; onProgress?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined }): Promise<LocalModelMetadata & { endpoint: string; apiBaseUrl: string; executable: string }>;
export interface OwnedLlamaServer {
  readonly pid: number | null; readonly endpoint: string; readonly apiBaseUrl: string; readonly modelId: string;
  readonly ready: Promise<LocalEndpointMetadata>; readonly completion: Promise<CommandOutcome>;
  stop(): Promise<CommandOutcome>;
}
export function startLlamaServer(options: { modelPath: string; command?: string | undefined; port?: number | undefined;
  contextSize?: number | undefined; memoryLimitBytes?: number | undefined; minimumFreeBytes?: number | undefined;
  gpuLayers?: number | undefined; modelId?: string | undefined; startupTimeoutMs?: number | undefined;
  timeoutMs?: number | undefined; signal?: AbortSignal | undefined; onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined }): Promise<OwnedLlamaServer>;
export function downloadGguf(options: { url: string; destination: string; sha256: string; maxBytes: number;
  timeoutMs?: number | undefined; signal?: AbortSignal | undefined;
  onProgress?: ((event: { type: 'download'; bytes: number; totalBytes?: number | undefined }) => unknown) | undefined }): Promise<{ path: string; bytes: number; sha256: string; source: string }>;
export function buildLlamaRuntime(options: { commit: string; installDirectory: string; sourceDirectory?: string | undefined;
  approveBuild: true; jobs?: number | undefined; timeoutMs?: number | undefined; minimumFreeBytes?: number | undefined;
  signal?: AbortSignal | undefined; onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined }): Promise<{ path: string; receiptPath: string; [key: string]: unknown }>;

export type NativeSubscriptionKind = 'codex' | 'claude';
export interface NativeAccountInspection {
  kind: NativeSubscriptionKind;
  installed: boolean;
  command?: string | undefined;
  version?: string | undefined;
  /** Native status metadata only; null means the CLI could not establish it. */
  signedIn: boolean | null;
  accountType?: 'chatgpt' | 'subscription' | 'api' | undefined;
  status: 'ready' | 'needs_sign_in' | 'needs_attention' | 'not_installed';
  reason: string;
  /** A discovered login does not prove model entitlement or successful inference. */
  access: 'unverified';
  accessVerified: false;
  nativeState?: { writable: boolean; reason?: string | undefined; needsCreation?: boolean | undefined } | undefined;
  install?: { url: string; command: string } | undefined;
}
export function resolveNativeAgentExecutable(kind: NativeSubscriptionKind, explicit?: string | undefined): Promise<string>;
/** Native version/auth metadata and filesystem prerequisites only; never inference. */
export function discoverAgentAccounts(options?: {
  commands?: Partial<Record<NativeSubscriptionKind, string>> | undefined;
  cwd?: string | undefined; signal?: AbortSignal | undefined; nativeHelperDirectory?: string | undefined;
}): Promise<NativeAccountInspection[]>;
interface NativeSignInHandleBase {
  readonly id: 'nativeSignIn'; readonly kind: NativeSubscriptionKind; readonly command: string;
  readonly pid: number | null; readonly completion: Promise<CommandOutcome>;
  endInput(): boolean;
  stop(): void;
}
export interface NativeSignInPipeHandle extends NativeSignInHandleBase {
  readonly transport: 'pipe';
  send(text: string): boolean;
}
export interface NativeSignInTerminalHandle extends NativeSignInHandleBase {
  readonly transport: 'pty';
  send(input: string | Uint8Array): boolean;
  resize(columns: number, rows: number): boolean;
}
export type NativeSignInHandle = NativeSignInPipeHandle | NativeSignInTerminalHandle;
/** Explicit subscription-only native sign-in. Caller owns IO and awaits cleanup. */
export function startNativeSignIn(options: {
  kind: NativeSubscriptionKind; command?: string | undefined; approved: true;
  cwd?: string | undefined; signal?: AbortSignal | undefined; timeoutMs?: number | undefined;
  onEvent?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined;
  helperPath?: string | undefined;
}): Promise<NativeSignInHandle>;

export type LocalCatalogChoiceId = 'qwen3-4b' | 'qwen3-8b' | 'qwen3-14b';
export interface LocalCatalogChoice {
  readonly id: LocalCatalogChoiceId; readonly name: string; readonly ggufQuantization: 'Q4_K_M';
  readonly ollamaModel: string; readonly publisher: string; readonly parameters: string;
  readonly downloadEstimateBytes: number; readonly minimumMemoryBytes: number;
  readonly recommendedMemoryBytes: number; readonly estimatedWorkingBytes: number;
}
/** Approximate one-model guidance; not speed, quality, fit or download guarantees. */
export const localModelCatalog: readonly LocalCatalogChoice[];
export function localStorageCapacity(directory?: string | undefined): Promise<number | undefined>;
export interface CatalogGgufAsset {
  choiceId: LocalCatalogChoiceId; publisher: string; revision: string;
  filename: string; sha256: string; bytes: number; url: string;
}
export interface RetainedCatalogModel extends CatalogGgufAsset { path: string; }
export function listRetainedLocalModels(directory?: string | undefined): Promise<RetainedCatalogModel[]>;
export interface LocalModelSetupInspection {
  machine: { platform: string; arch: string; memoryBytes: number; freeMemoryBytes: number;
    diskAvailableBytes?: number | undefined; };
  runtimes: Record<'ollama' | 'llama', LocalRuntimeDiscovery>;
  choices: (LocalCatalogChoice & {
    retained: RetainedCatalogModel[];
    suitability: 'insufficient_memory' | 'close_other_apps' | 'limited_headroom' | 'suggested';
    storage: 'unknown' | 'insufficient_space' | 'available';
    installed: (LocalModelMetadata & { kind: 'ollama' | 'llama'; endpoint: string })[];
  })[];
  retainedModels: RetainedCatalogModel[];
  estimates: string; optional: true;
  ollamaInstall: { url: string; message: string };
}
/** Runtime/model metadata only; does not start, download or request inference. */
export function inspectLocalModelSetup(options?: { directory?: string | undefined;
  ollamaCommand?: string | undefined; llamaCommand?: string | undefined; signal?: AbortSignal | undefined;
}): Promise<LocalModelSetupInspection>;
export const guidedLlamaCommit: '14310190cd0a0c831fe949ac8cbedd8abdc90695';
/** Contact the official publisher to resolve one immutable Q4_K_M GGUF and digest. */
export function resolveCatalogGguf(options: { choiceId: LocalCatalogChoiceId;
  signal?: AbortSignal | undefined }): Promise<Readonly<CatalogGgufAsset>>;
export type LocalModelSetupApproval = Readonly<{
  action: 'pull-model'; runtime: 'ollama'; model: string; downloadEstimateBytes: number;
  source: string; message: string;
} | {
  action: 'build-runtime'; runtime: 'llama.cpp'; commit: string; source: string;
  directory: string; message: string;
} | {
  action: 'download-model'; model: string; source: string; sha256: string;
  downloadBytes: number; destination: string; message: string;
} | {
  action: 'start-runtime'; runtime: 'llama.cpp'; model: string; modelPath: string; command: string;
  endpoint: string; contextSize: 8192; message: string;
}>;
export interface OllamaModelSetupResult {
  route: 'ollama'; reused: boolean; model: string; endpoint: string; command: string;
  inferenceVerified: false;
}
export interface LlamaModelSetupResult {
  route: 'llama'; reused: boolean; modelPath: string; command: string; publisher: string; sha256: string;
  runtimeReceipt?: Awaited<ReturnType<typeof buildLlamaRuntime>> | undefined;
  inferenceVerified: false;
  /** Present only when setup was asked to start and metadata confirmed the model alias. */
  model?: string | undefined; endpoint?: string | undefined; server?: OwnedLlamaServer | undefined;
}
/** Explicit asset acquisition; the caller must retain and stop a returned owned server. */
export function setupLocalModel(options: {
  choiceId: LocalCatalogChoiceId; route?: 'ollama' | 'llama' | undefined; directory?: string | undefined;
  ollamaCommand?: string | undefined; llamaCommand?: string | undefined;
  approve?: ((action: LocalModelSetupApproval) => boolean | Promise<boolean>) | undefined;
  onProgress?: ((event: Readonly<Record<string, unknown>>) => unknown) | undefined;
  signal?: AbortSignal | undefined; start?: boolean | undefined;
}): Promise<OllamaModelSetupResult | LlamaModelSetupResult>;
