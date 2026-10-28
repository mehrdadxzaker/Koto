// One temporary, explicitly dispatched real-product observation. Not a test suite.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, statfsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadSettings, sha256 } from './reviewed-settings.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.OBS_EXECUTION !== 'windows-actions'
  || process.platform !== 'win32' || process.arch !== 'x64' || process.env.OBS_OPERATION !== 'observe') {
  throw new Error('explicit_manual_observation_required');
}
const root = process.env.OBS_ROOT;
if (!root || !path.isAbsolute(root)) throw new Error('observation_root_required');
const prepared = JSON.parse(readFileSync(path.join(root, 'prepared.json'), 'utf8'));
if (prepared.variant !== 'qwen3-4b' || prepared.candidate !== process.env.OBS_CANDIDATE) throw new Error('candidate_changed');
const settings = loadSettings(path.join(root, 'reviewed-settings.json'), process.env.OBS_SETTINGS_SHA, { candidate: prepared.candidate });
if (prepared.reviewedSettingsSha256 !== process.env.OBS_SETTINGS_SHA) throw new Error('prepared_settings_changed');
const raw = path.join(root, 'evidence', 'raw');
mkdirSync(raw, { recursive: true, mode: 0o700 });
let session, run, server, report, failure, runtimeCompletion, runtimeWatch, stoppingServer = false;
const cleanupFailure = code => typeof code === 'string' && code.endsWith('cleanup_unconfirmed');
const resourceFailure = code => typeof code === 'string' && /(?:socket|resource)_exhausted$/.test(code);
function remember(error, fallback = 'native_observation_incomplete') {
  const raw = typeof error === 'string' ? error : error?.code;
  const code = ['EMFILE','ENFILE','EADDRNOTAVAIL','ENOBUFS'].includes(raw) ? 'evidence_resource_exhausted'
    : typeof raw === 'string' && /^[a-z][a-z0-9_]+$/.test(raw) ? raw : fallback;
  const priority = value => cleanupFailure(value) ? 3 : resourceFailure(value) ? 2 : value ? 1 : 0;
  if (priority(code) > priority(failure)) failure = code;
}
function stopSessionSafely() {
  try { session?.stop(); } catch (error) { remember(error, 'session_stop_failed'); }
}
function evidenceFailure(error) {
  remember(error, 'evidence_write_failed');
  controller.abort(); stopSessionSafely();
}
const save = (name, value) => {
  try { writeFileSync(path.join(root, 'evidence', name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); return true; }
  catch (error) { evidenceFailure(error); return false; }
};
let rawBytes = 0;
const appendRaw = (name, value) => {
  try {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value); rawBytes += data.length;
    if (rawBytes > settings.bounds.maxRawBytes) { remember('raw_evidence_bound'); controller.abort(); stopSessionSafely(); return; }
    appendFileSync(path.join(raw, name), data, { mode: 0o600 });
  } catch (error) { evidenceFailure(error); }
};
const privateLog = (name, value) => {
  try { appendRaw(name, `${JSON.stringify(value)}\n`); } catch (error) { evidenceFailure(error); }
};
const hashes = new Map(), bytes = new Map(), screens = new Map(), ready = new Set(), operations = [];
const projectState = () => {
  const git = args => execFileSync('git', ['-C', path.join(root, 'project'), '-c',
    `core.hooksPath=${path.join(root, 'disabled-hooks')}`, ...args],
  { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
  return { head: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1', '--untracked-files=all']) };
};
const projectBefore = projectState();
const time = () => new Date().toISOString();
const note = value => operations.push({ at: time(), ...value });

// This fresh process has no provider credentials. Host-global configuration is
// untouched; only this invocation receives the disposable profile paths.
for (const key of Object.keys(process.env)) {
  if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CREDENTIAL)/i.test(key)) delete process.env[key];
}
process.env.KOTO_STATE_DIR = path.join(root, 'state');
process.env.XDG_CONFIG_HOME = path.join(root, 'host', 'config');
process.env.XDG_DATA_HOME = path.join(root, 'host', 'data');
process.env.XDG_CACHE_HOME = path.join(root, 'host', 'cache');
process.env.XDG_STATE_HOME = path.join(root, 'host', 'state');
process.env.OPENCODE_CONFIG = path.join(root, 'host', 'opencode.json');
delete process.env.OPENCODE_CONFIG_DIR;
delete process.env.OPENCODE_CONFIG_CONTENT;
process.env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
process.env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
process.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
Object.assign(process.env, {
  OPENCODE_PURE: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
  OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
  OPENCODE_EXPERIMENTAL: 'false', OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'false',
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: 'true', npm_config_offline: 'true',
  npm_config_cache: path.join(root, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
});
process.env.TERM = 'xterm-256color';

const api = await import(pathToFileURL(path.join(root, 'install', 'node_modules', '@mehrdadxzaker', 'koto', 'src', 'index.js')));
const controller = new AbortController();
const deadline = setTimeout(() => { failure ??= 'observation_deadline'; controller.abort(); }, settings.bounds.observationTimeoutMs);
const stop = () => {
  remember('external_stop'); controller.abort(); stopSessionSafely();
};
process.once('SIGINT', stop); process.once('SIGTERM', stop);

const onEvent = event => {
  privateLog('events.jsonl', event);
  if (event.type === 'pty_ready') ready.add(event.agentId);
  if (event.type === 'output' && event.agentId) {
    const buffer = Buffer.from(event.text ?? '');
    screens.set(event.agentId, ((screens.get(event.agentId) ?? '') + (event.text ?? '')).slice(-65536));
    if (!hashes.has(event.agentId)) hashes.set(event.agentId, createHash('sha256'));
    hashes.get(event.agentId).update(buffer);
    bytes.set(event.agentId, (bytes.get(event.agentId) ?? 0) + buffer.length);
    appendRaw(`${event.agentId}.vt`, buffer);
  }
};
async function waitUntil(predicate, milliseconds) {
  const end = Date.now() + milliseconds;
  while (!predicate() && Date.now() < end && !controller.signal.aborted) await delay(250);
  return predicate();
}
function admitHost() {
  const rawFreeBytes = freemem();
  let availableBytes = rawFreeBytes, source = 'os-freemem';
  if (process.platform === 'linux') {
    const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'));
    if (!match) throw new Error('memory_admission_unavailable');
    availableBytes = Number(match[1]) * 1024; source = 'linux-MemAvailable';
  }
  const disk = statfsSync(root);
  const admission = { totalBytes: totalmem(), rawFreeBytes, availableBytes, source,
    cpus: availableParallelism(), freeDiskBytes: disk.bavail * disk.bsize };
  save('host-admission-before-start.json', admission);
  if (!Number.isSafeInteger(availableBytes) || availableBytes < settings.bounds.minimumAvailableBytes
    || admission.cpus < settings.bounds.minimumCpus || admission.freeDiskBytes < settings.bounds.freeDiskBeforeStartBytes) throw new Error('four_b_host_admission_failed');
}
async function inspectLoadedTemplate() {
  // One fresh metadata request to the owned server. No inference, redirects,
  // retries, template override or text-to-tool interpretation is performed.
  const url = new URL('/props', server.endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '18089') throw new Error('owned_props_endpoint_changed');
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]);
  const response = await fetch(url, { method: 'GET', redirect: 'error', signal,
    headers: { accept: 'application/json', connection: 'close' } });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('owned_props_body_missing');
  const chunks = []; let count = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      count += next.value.length;
      if (count > 2 * 1024 ** 2) throw new Error('owned_props_size_bound');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body = Buffer.concat(chunks);
  appendRaw('props-response.bin', body);
  privateLog('props-request.jsonl', { at: time(), status: response.status, bytes: count });
  if (!response.ok) throw new Error('owned_props_request_failed');
  const props = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  const selected = typeof props.chat_template_tool_use === 'string' && props.chat_template_tool_use.trim()
    ? props.chat_template_tool_use : props.chat_template;
  const caps = props.chat_template_caps;
  const confirmed = props.model_alias === server.modelId && props.total_slots === 1
    && props.default_generation_settings?.n_ctx === settings.runtime.contextSize && props.is_sleeping === false
    && caps?.supports_tools === true && caps?.supports_tool_calls === true
    && typeof selected === 'string' && selected.trim().length > 0;
  save('template-capabilities.json', { endpoint: url.href, modelAlias: props.model_alias,
    slots: props.total_slots, contextSize: props.default_generation_settings?.n_ctx,
    isSleeping: props.is_sleeping, supportsTools: caps?.supports_tools,
    supportsHistoricalToolCalls: caps?.supports_tool_calls,
    templateSha256: typeof selected === 'string' ? createHash('sha256').update(selected).digest('hex') : null,
    responseSha256: createHash('sha256').update(body).digest('hex'), confirmed,
    meaning: 'Loaded template format capabilities only; no tool execution or contribution has been demonstrated.' });
  if (!confirmed) throw new Error('loaded_tool_template_unconfirmed');
}
try {
  for (const [relative, key] of [['src/local-models.js','localModelsSha256'], ['src/core.d.ts','coreTypesSha256']]) {
    if (sha256(readFileSync(path.join(root, 'install', 'node_modules', '@mehrdadxzaker', 'koto', relative))) !== settings.candidateApi[key]) throw new Error('candidate_api_changed');
  }
  admitHost();
  const helper = await api.buildTerminalHelper({ directory: path.join(root, 'state', 'native') });
  save('helper.json', helper);
  server = await api.startLlamaServer({ command: prepared.llama, modelPath: prepared.model,
    modelId: 'koto-qwen3-4b', port: 18089, contextSize: settings.runtime.contextSize, gpuLayers: 0,
    memoryLimitBytes: settings.runtime.memoryLimitBytes, minimumFreeBytes: settings.runtime.minimumFreeBytes,
    startupTimeoutMs: settings.runtime.startupTimeoutMs, startupMaxRetries: settings.runtime.startupMaxRetries,
    timeoutMs: settings.runtime.timeoutMs, cacheRamMiB: settings.runtime.cacheRamMiB,
    signal: controller.signal, onEvent: event => privateLog('runtime.jsonl', event) });
  server.ready.catch(error => {
    remember(error, 'runtime_not_ready'); controller.abort(); stopSessionSafely();
  });
  runtimeWatch = server.completion.then(completion => {
    runtimeCompletion = completion;
    if (!stoppingServer) {
      remember(completion.error ?? 'runtime_ended_before_observation_finished');
      controller.abort(); stopSessionSafely();
    }
    save('runtime-completion.json', completion);
  }).catch(error => {
    remember(error, 'runtime_completion_or_receipt_failed');
    controller.abort(); stopSessionSafely();
    try { privateLog('failure.jsonl', { code: error.code, message: error.message }); } catch { /* Still await owned cleanup. */ }
  });
  if (server.cacheRamMiB !== settings.runtime.cacheRamMiB) throw new Error('runtime_cache_binding_unconfirmed');
  await server.ready;
  save('runtime.json', { pid: server.pid, endpoint: server.endpoint, modelId: server.modelId,
    contextSize: server.contextSize, memoryLimitBytes: server.memoryLimitBytes, minimumFreeBytes: server.minimumFreeBytes,
    cacheRamMiB: server.cacheRamMiB });
  await inspectLoadedTemplate();
  const agents = ['reader','contributor'].map(id => {
    const agent = api.createAgentProfile({ kind: 'opencode', id, command: prepared.opencode,
      model: 'local/koto-qwen3-4b', transport: 'pty', timeoutMs: settings.bounds.agentTimeoutMs,
      task: settings.tasks[id], owns: [id === 'reader' ? 'docs/NATIVE_SESSIONS.md' : 'docs/WINDOWS_TERMINAL_OPERATOR_NOTE.md'] });
    // Two actual idle TUIs; tasks are sent only at explicitly reviewed times.
    // Native identity is retained; no prompt is submitted through argv.
    agent.args = ['--model', 'local/koto-qwen3-4b'];
    return agent;
  });
  session = await api.createProjectSession({ schemaVersion: 1, project: path.join(root, 'project'),
    goal: 'Improve Koto installation guidance through an explicitly supervised local native-agent session.',
    controlRoot: path.join(root, 'control'), nativeHelperDirectory: path.join(root, 'state', 'native'),
    maxConcurrency: 2, timeoutMs: settings.bounds.projectTimeoutMs, agents }, { onEvent, signal: controller.signal });
  save('session-location.json', { sessionRoot: session.sessionRoot });
  run = session.run();
  // Observe an early lease/runtime rejection immediately; retain and await the
  // same promise in finally so an unhandled rejection cannot skip cleanup.
  run.catch(error => {
    remember(error, 'project_run_failed');
    controller.abort();
    try { privateLog('failure.jsonl', { message: error.message, stack: error.stack }); } catch { /* Retain lifecycle failure. */ }
  });
  if (!await waitUntil(() => ready.size === 2, 90_000)) throw new Error('native_terminals_not_ready');
  note({ action: 'two_native_terminals_ready', state: session.status().agents.map(a => ({ id: a.id, status: a.status, pid: a.pid })) });
  // The pinned native client's real prompt was observed in the accepted idle
  // run. Do not submit tasks to a blank or still-initializing terminal. This
  // routing guard does not establish semantic correctness or acceptance.
  if (!await waitUntil(() => ['reader','contributor'].every(id => screens.get(id)?.includes('Ask anything')), 15000))
    throw new Error('native_input_prompt_not_observed');
  note({ action: 'native_input_prompts_observed', semanticInterpretation: 'readiness_only_requires_operator_review' });
  for (const operation of settings.operations) {
    controller.signal.throwIfAborted();
    if (operation.action === 'wait') {
      note({ action: 'reviewed_observation_interval', milliseconds: operation.ms });
      await delay(operation.ms, undefined, { signal: controller.signal });
      continue;
    }
    const id = operation.agentId;
    const active = session.status().agents.find(a => a.id === id);
    if (active?.status !== 'running') throw new Error('reviewed_operation_target_not_running');
    const beforeBytes = bytes.get(id) ?? 0;
    if (operation.action === 'resize') {
      const accepted = session.resize(id, operation.columns, operation.rows);
      note({ action: 'resize_requested', agentId: id, columns: operation.columns, rows: operation.rows, accepted, beforeBytes });
      if (!accepted) throw new Error('native_resize_rejected');
    } else if (operation.action === 'send') {
      const text = operation.task === true ? settings.tasks[id] : operation.text;
      const accepted = session.send(id, `${text}\r`);
      note({ action: 'input_requested', agentId: id, initialTask: operation.task === true, accepted,
        inputSha256: sha256(text), beforeBytes, semanticInterpretation: 'requires_operator_review' });
      if (!accepted) throw new Error('native_input_rejected');
    } else {
      session.stop(id); note({ action: 'peer_stop_requested', agentId: id });
      const ended = await waitUntil(() => !['pending','running'].includes(session.status().agents.find(a => a.id === id)?.status), 15_000);
      if (!ended || controller.signal.aborted) throw new Error('peer_stop_not_settled');
      const state = session.status().agents.map(a => ({ id: a.id, status: a.status, pid: a.pid, outcome: a.commandOutcome }));
      note({ action: 'state_after_peer_stop', agents: state });
      if (state.find(a => a.id === id)?.outcome?.error === 'cleanup_unconfirmed') throw new Error('peer_cleanup_unconfirmed');
      if (state.find(a => a.id === 'contributor')?.status !== 'running') throw new Error('survivor_not_running');
    }
  }
} catch (error) {
  remember(error, /^[a-z][a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'native_observation_incomplete');
  privateLog('failure.jsonl', { code: error.code, message: error.message, stack: error.stack });
} finally {
  // Logging/receipt failure is recorded but cannot throw past a cleanup stage.
  // Abort joins all owned lifetimes; every subsequent await retains its handle.
  stoppingServer = true;
  controller.abort();
  try {
    stopSessionSafely();
    if (run) {
      try { report = await run; }
      catch (error) { remember(error, 'project_run_failed'); privateLog('failure.jsonl', { code: error.code, message: error.message }); }
    }
  } finally {
    try {
      if (server) {
        try {
          const completion = await server.stop(); runtimeCompletion = completion;
          if (completion.error || !['cancelled','succeeded'].includes(completion.status)) remember(completion.error ?? 'runtime_failed');
          save('runtime-completion.json', completion);
        } catch (error) {
          remember(error, 'runtime_stop_rejected'); privateLog('failure.jsonl', { code: error.code, message: error.message });
        }
      }
    } finally {
      try {
        if (runtimeWatch) await runtimeWatch;
      } catch (error) { remember(error, 'runtime_watch_failed'); }
      finally {
        clearTimeout(deadline);
        process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      }
    }
  }
}
const inspections = {};
if (session) {
  for (const agent of session.status().agents) {
    if (!agent.commandOutcome) remember('native_completion_missing');
    else if (agent.commandOutcome.error || !['cancelled','succeeded'].includes(agent.commandOutcome.status)) remember(agent.commandOutcome.error ?? 'native_worker_failed');
  }
  for (const id of ['reader', 'contributor']) {
    try { inspections[id] = await session.inspect(id); }
    catch (error) { remember(error, 'retained_inspection_failed'); privateLog('failure.jsonl', { id, message: error.message }); }
  }
}
let projectAfter;
try { projectAfter = projectState(); }
catch (error) { remember(error, 'original_project_read_failed'); privateLog('failure.jsonl', { message: error.message }); }
if (JSON.stringify(projectBefore) !== JSON.stringify(projectAfter)) failure ??= 'original_project_changed';
const result = { schemaVersion: 1, variant: prepared.variant, candidate: prepared.candidate, root, platform: process.platform,
  arch: process.arch, reviewedSettingsSha256: prepared.reviewedSettingsSha256, runtimeCompletion, sessionRoot: session?.sessionRoot ?? null, failure: failure ?? null,
  operations, report, inspections, projectBefore, projectAfter,
  output: Object.fromEntries([...hashes].map(([id, hash]) => [id, { bytes: bytes.get(id), sha256: hash.digest('hex') }])),
  nativeInputSemanticsVerified: false, nativeRedrawVerified: false, humanTerminalRestorationVerified: false,
  contributionReviewed: false, integrated: false,
  instruction: 'Inspect encrypted native output and public real diff. Boolean sends/resizes and output activity are not acceptance passes.' };
save('observation.json', result);
if (failure) { process.exitCode = 1; try { process.stderr.write(`${JSON.stringify({ error: failure })}\n`); } catch { /* All owned cleanup has already settled. */ } }
