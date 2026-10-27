import { createHash, randomUUID } from 'node:crypto';
import { opendir } from 'node:fs/promises';
import path from 'node:path';
import { validateWorkflow } from './core.js';
import { validateProjectPlan, createProjectSession } from './project-session.js';
import { inspectLaunchProject } from './launch-preflight.js';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_RESPONSE = 65_536;
const MAX_PROMPT = 60_000;
const MAX_INVENTORY = 160;
const SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'coverage', '.next', '.cache', '.koto']);

function fail(code, message, responseText) {
  const error = new Error(message);
  error.code = code;
  // A caller may retain this privately when investigating a failed real turn.
  // It must not be treated as an executable plan or published as telemetry.
  if (responseText !== undefined) error.responseText = responseText;
  throw error;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function text(value, maximum = MAX_RESPONSE) {
  return typeof value === 'string' && value.trim().length > 0
    && !value.includes('\0') && Buffer.byteLength(value) <= maximum;
}

function fields(value, names) {
  return object(value) && Object.keys(value).every(name => names.includes(name));
}

function fingerprint(plan, project) {
  return createHash('sha256').update(JSON.stringify({ plan,
    projectRoot: project.projectRoot, baseCommit: project.baseCommit })).digest('hex');
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function parseResponse(source) {
  if (!text(source, MAX_RESPONSE)) {
    fail('coordinator_response_invalid', 'The coordinator returned empty or oversized output. No project agents were started.');
  }
  const candidate = source.trim();
  // Accept a single complete JSON code fence, never arbitrary prose or a
  // recovered substring that could hide another conflicting instruction.
  const fence = candidate.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  try { return JSON.parse(fence ? fence[1] : candidate); }
  catch {
    fail('coordinator_response_invalid', 'The coordinator did not return the required JSON response. No automatic retry or agent launch occurred.', source);
  }
}

async function inventory(root) {
  const entries = [];
  let bytes = 0;
  let truncated = false;
  async function visit(directory, prefix, depth) {
    if (depth > 3 || entries.length >= MAX_INVENTORY || bytes >= 8_000) { truncated = true; return; }
    const stream = await opendir(directory);
    let scanned = 0;
    for await (const entry of stream) {
      if (++scanned > 512 || entries.length >= MAX_INVENTORY || bytes >= 8_000) { truncated = true; break; }
      if (SKIP.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        entries.push(`${relative}/`);
        bytes += Buffer.byteLength(relative) + 1;
        await visit(path.join(directory, entry.name), relative, depth + 1);
      } else if (entry.isFile()) {
        entries.push(relative);
        bytes += Buffer.byteLength(relative);
      }
    }
  }
  await visit(root, '', 0);
  return { paths: entries.sort(), truncated };
}

function workerTemplates(workers, project, goal, timeoutMs) {
  if (!Array.isArray(workers) || workers.length < 1 || workers.length > 8
    || workers.some(worker => !object(worker))) {
    fail('coordinator_workers_invalid', 'Configure one to eight actual coding-agent workers before asking Koto to plan a build.');
  }
  // Only caller-configured execution details reach this validator. The model
  // receives worker IDs/capabilities, never authority to invent a new command.
  const normalized = validateProjectPlan({ schemaVersion: 1, project, goal,
    timeoutMs, agents: workers.map(worker => ({ ...worker, task: goal, owns: ['.'] })) });
  return new Map(normalized.agents.map((worker, index) => {
    const source = workers[index];
    const label = text(source.label, 256) ? source.label : source.id;
    const model = text(source.model, 512) ? source.model : undefined;
    return [worker.id, { execution: worker, label, model }];
  }));
}

function ownershipWarnings(tasks) {
  const warnings = [];
  const overlaps = (left, right) => left === '.' || right === '.' || left === right
    || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  for (let first = 0; first < tasks.length; first += 1) {
    for (let next = first + 1; next < tasks.length; next += 1) {
      if (tasks[first].owns.some(left => tasks[next].owns.some(right => overlaps(left, right)))) {
        warnings.push(`${tasks[first].id} and ${tasks[next].id} declare overlapping ownership; review their contributions for integration conflicts.`);
      }
    }
  }
  if (tasks.some(task => task.dependsOn.length)) {
    warnings.push('Dependencies pass successful task results and read-only workspace references. Code is integrated only after operator review, not automatically copied between worker worktrees.');
  }
  return warnings;
}

/** Revise displayed assignments using only the caller's configured workers.
 * This is a pure plan operation: project freshness is checked again when the
 * revised proposal is prepared, and no model, process or workspace is started.
 */
export function reviseBuildProposal(proposal, { tasks, workers } = {}) {
  if (!object(proposal) || proposal.kind !== 'koto-build-proposal' || proposal.schemaVersion !== 1
    || !object(proposal.project) || !object(proposal.plan) || !text(proposal.summary, 4_096)
    || !text(proposal.project.projectRoot, 4096) || !path.isAbsolute(proposal.project.projectRoot)
    || typeof proposal.project.baseCommit !== 'string' || !/^[a-f0-9]{40,64}$/.test(proposal.project.baseCommit)
    || proposal.project.branch !== undefined && !text(proposal.project.branch, 4096)) {
    fail('coordinator_proposal_invalid', 'Select a complete Koto build proposal before revising assignments.');
  }
  let original;
  try { original = validateProjectPlan(proposal.plan); }
  catch { fail('coordinator_proposal_invalid', 'The original execution plan is invalid. Prepare a new proposal before revising assignments.'); }
  if (original.project !== proposal.project.projectRoot
    || proposal.fingerprint !== fingerprint(original, proposal.project)) {
    fail('coordinator_proposal_changed', 'The original execution plan changed. Prepare and review a new proposal before revising assignments.');
  }
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 8) {
    fail('coordinator_plan_invalid', 'Keep one to eight explicit tasks in the revised plan. No project agents were started.');
  }
  const templates = workerTemplates(workers, original.project, original.goal, original.timeoutMs);
  const revisedTasks = tasks.map(task => {
    // Existing displayed label/model fields are accepted but regenerated from
    // the selected worker; assignments cannot introduce execution settings.
    if (!fields(task, ['id', 'worker', 'task', 'owns', 'dependsOn', 'label', 'model'])
      || typeof task.id !== 'string' || !ID.test(task.id) || !templates.has(task.worker)
      || !text(task.task, 16_384) || !Array.isArray(task.owns) || task.owns.length < 1 || task.owns.length > 64
      || task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || task.dependsOn.length > 8
        || task.dependsOn.some(id => typeof id !== 'string' || !ID.test(id)))) {
      fail('coordinator_plan_invalid', 'Choose valid task IDs, configured workers, assignments, ownership and dependencies. No project agents were started.');
    }
    return { id: task.id, worker: task.worker, task: task.task,
      owns: [...task.owns], dependsOn: [...(task.dependsOn ?? [])] };
  });
  const maxConcurrency = Math.min(original.maxConcurrency, revisedTasks.length);
  let plan;
  try {
    validateWorkflow({ schemaVersion: 1, goal: original.goal,
      agents: Object.fromEntries([...templates.entries()].map(([id, worker]) => [id,
        { command: worker.execution.command, args: worker.execution.args, timeoutMs: worker.execution.timeoutMs }])),
      tasks: revisedTasks.map(task => ({ id: task.id, agent: task.worker,
        prompt: task.task, dependsOn: task.dependsOn })),
      timeoutMs: original.timeoutMs, maxConcurrency });
    plan = validateProjectPlan({ ...original, maxConcurrency,
      agents: revisedTasks.map(task => ({ ...templates.get(task.worker).execution,
        id: task.id, task: task.task, owns: task.owns, dependsOn: task.dependsOn })) });
  } catch {
    fail('coordinator_plan_invalid', 'The revised tasks contain duplicate IDs, invalid paths, dependencies, a cycle or invalid execution settings. No project agents were started.');
  }
  const normalizedTasks = revisedTasks.map((task, index) => ({ ...task,
    owns: [...plan.agents[index].owns], dependsOn: [...plan.agents[index].dependsOn] }));
  const project = { projectRoot: proposal.project.projectRoot, baseCommit: proposal.project.baseCommit,
    ...(proposal.project.branch === undefined ? {} : { branch: proposal.project.branch }) };
  let metadata;
  try {
    if (proposal.coordinatorSessionId !== undefined && !text(proposal.coordinatorSessionId, 4096)) throw new Error('session_metadata');
    const encoded = JSON.stringify({ ...(proposal.coordinatorSessionId === undefined ? {} : { coordinatorSessionId: proposal.coordinatorSessionId }),
      ...(proposal.usage === undefined ? {} : { usage: proposal.usage }) });
    if (Buffer.byteLength(encoded) > MAX_RESPONSE) throw new Error('metadata_limit');
    metadata = JSON.parse(encoded);
  } catch { fail('coordinator_proposal_invalid', 'The original proposal contains invalid source metadata. Prepare a new proposal before revising assignments.'); }
  return freeze({ schemaVersion: 1, kind: 'koto-build-proposal', id: randomUUID(),
    createdAt: new Date().toISOString(), summary: proposal.summary, project, plan,
    fingerprint: fingerprint(plan, project),
    tasks: normalizedTasks.map(task => ({ ...task, label: templates.get(task.worker).label,
      ...(templates.get(task.worker).model ? { model: templates.get(task.worker).model } : {}) })),
    warnings: ownershipWarnings(normalizedTasks), ...metadata });
}

/** Real conversational/planning turns, with caller-selected agent authority.
 * The native session is injected so every delivery surface shares this core.
 * No classifier, reply, plan, retry or model fallback is fabricated here.
 */
export function createCoordinator({ session } = {}) {
  if (!session || typeof session.send !== 'function' || typeof session.stop !== 'function') {
    throw new TypeError('A real native-agent session with send() and stop() is required.');
  }
  let busy = false;
  let activeProject;
  let executionController;
  let stoppedAt = 0;

  async function turn(prompt, signal) {
    if (busy) fail('coordinator_busy', 'The coordinator already has an active turn. Wait for it to finish or stop it first.');
    if (signal?.aborted) fail('coordinator_cancelled', 'The coordinator request was cancelled before launch.');
    if (Buffer.byteLength(prompt) > MAX_PROMPT) {
      fail('coordinator_request_too_large', 'The goal and planning context are too large. Shorten the request before sending it.');
    }
    busy = true;
    try {
      const result = await session.send(prompt, { signal });
      if (result?.status !== 'succeeded') {
        if (typeof result?.error === 'string' && /(?:socket_exhausted|cleanup_unconfirmed)$/.test(result.error)) {
          fail(result.error.endsWith('cleanup_unconfirmed') ? 'cleanup_unconfirmed' : 'local_socket_exhausted',
            result.error.endsWith('cleanup_unconfirmed')
              ? 'Coordinator process cleanup could not be confirmed. Inspect its owned process state before continuing.'
              : 'Socket or file-descriptor capacity is unavailable. Stop new requests and inspect system resources before retrying.');
        }
        fail(result?.status === 'cancelled' ? 'coordinator_cancelled' : 'coordinator_turn_failed',
          text(result?.errorMessage, 2048) ? result.errorMessage
            : `The real coordinator ${result?.status === 'cancelled' ? 'was cancelled' : 'did not complete'}${text(result?.error, 256) ? ` (${result.error})` : ''}. No automatic retry or project-agent launch occurred.`,
          typeof result?.text === 'string' ? result.text.slice(0, MAX_RESPONSE) : undefined);
      }
      return { value: parseResponse(result.text), source: result.text,
        sessionId: result.sessionId ?? session.sessionId,
        ...(result.usage === undefined ? {} : { usage: result.usage }) };
    } finally { busy = false; }
  }

  const api = {
    get sessionId() { return session.sessionId; },
    stop() { stoppedAt += 1; session.stop(); executionController?.abort(); activeProject?.stop(); },

    async routeMessage(message, { signal, context } = {}) {
      if (!text(message, 32_768)) fail('coordinator_message_invalid', 'Enter a nonempty message of at most 32 KiB.');
      if (context !== undefined && !text(context, 8_192)) fail('coordinator_context_invalid', 'Conversation context must be bounded text.');
      const prompt = [
        'You are Koto, the user\'s coding coordinator. Respond naturally and concisely to ordinary conversation.',
        'This turn only decides the next conversation action. Do not edit files, run build commands, launch workers or claim code changes have happened.',
        'Return exactly one JSON object, without prose outside it:',
        'For chat: {"schemaVersion":1,"action":"chat","message":"your conversational reply"}',
        'For a build request: {"schemaVersion":1,"action":"build","message":"your conversational reply","goal":"the concrete coding goal"}',
        'Use chat for greetings, questions, explanations, clarifications and discussion. No project directory is needed for chat.',
        'Use build when the user explicitly requests implementing or changing code. Explain briefly that Koto will prepare a plan for approval, and include the actual requested goal.',
        'A build action does not mean work has started. Project selection, worker configuration and plan approval happen in subsequent steps. Never invent installed agents, model availability, progress, completed edits or results.',
        ...(context ? [`Actual application context: ${JSON.stringify(context)}`] : []),
        `User message: ${JSON.stringify(message)}`,
      ].join('\n');
      const result = await turn(prompt, signal);
      const response = result.value;
      if (!fields(response, ['schemaVersion', 'action', 'message', 'goal']) || response.schemaVersion !== 1
        || !['chat', 'build'].includes(response.action) || !text(response.message, 16_384)
        || (response.action === 'build' ? !text(response.goal, 32_768)
          : ![undefined, null, ''].includes(response.goal))) {
        fail('coordinator_route_invalid', 'The coordinator returned an invalid conversation action. No build was started.', result.source);
      }
      return freeze({ action: response.action, message: response.message,
        ...(response.action === 'build' ? { goal: response.goal } : {}),
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        ...(result.usage === undefined ? {} : { usage: result.usage }) });
    },

    async plan(goal, { project, workers, signal, timeoutMs = 300_000,
      maxConcurrency, controlRoot, nativeHelperDirectory } = {}) {
      const stopEpoch = stoppedAt;
      if (!text(goal, 32_768)) fail('coordinator_goal_invalid', 'Provide a nonempty coding goal of at most 32 KiB.');
      const checked = await inspectLaunchProject(project);
      const templates = workerTemplates(workers, checked.projectRoot, goal, timeoutMs);
      const files = await inventory(checked.projectRoot);
      if (stopEpoch !== stoppedAt || signal?.aborted) fail('coordinator_cancelled', 'Planning was cancelled before the coordinator was launched.');
      const workerInfo = [...templates.entries()].map(([id, worker]) => ({ id, label: worker.label,
        ...(worker.model ? { model: worker.model } : {}) }));
      const prompt = [
        'Prepare an implementation plan for Koto\'s real coding-agent workers. Planning is read-only: do not modify files, run builds, install packages or launch other agents.',
        'Return exactly one JSON object with no prose outside it:',
        '{"schemaVersion":1,"summary":"brief implementation approach","tasks":[{"id":"uniqueTaskId","worker":"configuredWorkerId","task":"specific assignment","owns":["literal/project/path"],"dependsOn":[]}]}',
        'Create one to eight concrete coding tasks. Use only the worker IDs listed below. You cannot select executables, CLI flags, model settings, credentials or new providers.',
        'These are executable assignments for a later host-approved launch. Keep this coordinator\'s planning-only instructions and the general Koto plan-approval wait out of worker assignments. Preserve genuinely unresolved task-specific decisions and intentional inspection-only work.',
        'Use independent tasks concurrently when useful. Avoid invented work merely to occupy workers. Assign explicit literal project-relative file/directory ownership; no shell expressions or glob patterns.',
        'Dependencies reference task IDs and must be acyclic. Workers start from separate worktrees of the same clean base. Successful dependency output and read-only workspace references are handed to dependent tasks, but no dependency code is automatically applied into their worktrees.',
        'Specify shared interfaces/contracts in assignments when independent files must fit together. Do not instruct a worker to integrate another task, modify another worktree, write outside its ownership, or change the original checkout.',
        'The operator reviews contributions and performs controlled integration after execution. Do not add or run automated test suites, fixtures or simulated workers. Use real code and direct manual usage appropriate to the requested feature.',
        `Project root: ${JSON.stringify(checked.projectRoot)}`,
        `Base commit: ${checked.baseCommit}`,
        `Actual bounded project inventory: ${JSON.stringify(files)}`,
        `Configured workers: ${JSON.stringify(workerInfo)}`,
        `User goal: ${JSON.stringify(goal)}`,
      ].join('\n');
      const result = await turn(prompt, signal);
      const response = result.value;
      if (!fields(response, ['schemaVersion', 'summary', 'tasks']) || response.schemaVersion !== 1
        || !text(response.summary, 4_096) || !Array.isArray(response.tasks)
        || response.tasks.length < 1 || response.tasks.length > 8) {
        fail('coordinator_plan_invalid', 'The coordinator did not provide a bounded implementation plan. No project agents were started.', result.source);
      }
      const tasks = response.tasks.map(task => {
        if (!fields(task, ['id', 'worker', 'task', 'owns', 'dependsOn']) || !ID.test(task.id)
          || !templates.has(task.worker) || !text(task.task, 16_384) || !Array.isArray(task.owns)
          || task.owns.length < 1 || task.owns.length > 64
          || (task.dependsOn !== undefined && (!Array.isArray(task.dependsOn)
            || task.dependsOn.some(id => typeof id !== 'string' || !ID.test(id))))) {
          fail('coordinator_plan_invalid', 'The coordinator proposed an invalid task, worker, ownership declaration or dependency. No project agents were started.', result.source);
        }
        return { id: task.id, worker: task.worker, task: task.task,
          owns: [...task.owns], dependsOn: [...(task.dependsOn ?? [])] };
      });
      try {
        // Reuse the scheduler's own identifier, reference and cycle checks.
        validateWorkflow({ schemaVersion: 1, goal,
          agents: Object.fromEntries([...templates.entries()].map(([id, worker]) => [id,
            { command: worker.execution.command, args: worker.execution.args, timeoutMs: worker.execution.timeoutMs }])),
          tasks: tasks.map(task => ({ id: task.id, agent: task.worker,
            prompt: task.task, dependsOn: task.dependsOn })),
          timeoutMs, maxConcurrency: maxConcurrency ?? Math.min(templates.size, tasks.length) });
      } catch {
        fail('coordinator_plan_invalid', 'The coordinator proposed duplicate tasks, invalid dependencies, a cycle or an invalid execution budget. No project agents were started.', result.source);
      }
      let plan;
      try {
        plan = validateProjectPlan({ schemaVersion: 1, project: checked.projectRoot, goal,
          agents: tasks.map(task => ({ ...templates.get(task.worker).execution,
            id: task.id, task: task.task, owns: task.owns, dependsOn: task.dependsOn })),
          maxConcurrency: maxConcurrency ?? Math.min(templates.size, tasks.length), timeoutMs,
          ...(controlRoot === undefined ? {} : { controlRoot }),
          ...(nativeHelperDirectory === undefined ? {} : { nativeHelperDirectory }) });
      } catch {
        fail('coordinator_plan_invalid', 'The coordinator proposed invalid project paths, ownership or terminal configuration. No project agents were started.', result.source);
      }
      if (tasks.some(task => task.dependsOn.length
        && JSON.stringify(plan.agents.find(agent => agent.id === task.id)?.dependsOn) !== JSON.stringify(task.dependsOn))) {
        fail('coordinator_dependencies_unsupported', 'This core cannot retain the proposed task dependencies. No project agents were started.');
      }
      return freeze({ schemaVersion: 1, kind: 'koto-build-proposal', id: randomUUID(),
        createdAt: new Date().toISOString(), summary: response.summary,
        project: checked, plan, fingerprint: fingerprint(plan, checked),
        tasks: tasks.map(task => ({ ...task, label: templates.get(task.worker).label,
          ...(templates.get(task.worker).model ? { model: templates.get(task.worker).model } : {}) })),
        warnings: ownershipWarnings(tasks),
        ...(result.sessionId ? { coordinatorSessionId: result.sessionId } : {}),
        ...(result.usage === undefined ? {} : { usage: result.usage }) });
    },

    async prepare(proposal, { onEvent, signal, onApproval } = {}) {
      if (activeProject) fail('coordinator_build_active', 'A project session is already active. Finish or stop it before preparing another build.');
      if (!object(proposal) || proposal.kind !== 'koto-build-proposal' || proposal.schemaVersion !== 1
        || !object(proposal.project) || !object(proposal.plan)) {
        fail('coordinator_proposal_invalid', 'Select a complete Koto build proposal before launching agents.');
      }
      const plan = validateProjectPlan(proposal.plan);
      if (proposal.fingerprint !== fingerprint(plan, proposal.project)) {
        fail('coordinator_proposal_changed', 'The proposed execution plan changed. Review a fresh proposal before launching agents.');
      }
      const checked = await inspectLaunchProject(plan.project);
      if (checked.projectRoot !== proposal.project.projectRoot || checked.baseCommit !== proposal.project.baseCommit) {
        fail('coordinator_project_changed', 'The project base changed after planning. Prepare and review a new plan before launching agents.');
      }
      const prepared = await createProjectSession(plan, { onEvent, signal, onApproval });
      const actual = prepared.status();
      // Workspace preparation independently snapshots HEAD. Verify that final
      // snapshot too, so a commit racing between checks cannot change the base
      // after the operator reviewed the proposal. Retain worktrees on refusal.
      if (actual.projectRoot !== proposal.project.projectRoot || actual.baseCommit !== proposal.project.baseCommit) {
        prepared.stop();
        fail('coordinator_project_changed', 'The project changed while workspaces were being prepared. Prepared worktrees are retained, and no agents were launched. Review a new plan.');
      }
      return prepared;
    },

    async execute(proposal, { approved = false, onEvent, signal, onApproval } = {}) {
      if (!approved) fail('coordinator_approval_required', 'Review the implementation plan and explicitly approve it before agents run.');
      if (executionController) fail('coordinator_build_active', 'A project session is already preparing or active. Finish or stop it first.');
      const controller = new AbortController();
      executionController = controller;
      const executionSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        const project = await api.prepare(proposal, { onEvent, signal: executionSignal, onApproval });
        activeProject = project;
        return await project.run();
      } finally { activeProject = undefined; executionController = undefined; }
    },
  };
  return api;
}
