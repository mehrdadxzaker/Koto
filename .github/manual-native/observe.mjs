// One temporary, explicitly dispatched real-product observation. Not a test suite.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, statfsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.OBS_OPERATION !== 'observe') {
  throw new Error('explicit_manual_observation_required');
}
const root = process.env.OBS_ROOT;
if (!root || !path.isAbsolute(root)) throw new Error('observation_root_required');
const prepared = JSON.parse(readFileSync(path.join(root, 'prepared.json'), 'utf8'));
if (prepared.variant !== 'qwen-coder-7b' || prepared.candidate !== process.env.OBS_CANDIDATE) throw new Error('candidate_changed');
const raw = path.join(root, 'evidence', 'raw');
mkdirSync(raw, { recursive: true, mode: 0o700 });
const save = (name, value) => writeFileSync(path.join(root, 'evidence', name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const privateLog = (name, value) => appendFileSync(path.join(raw, name), `${JSON.stringify(value)}\n`, { mode: 0o600 });
const hashes = new Map(), bytes = new Map(), ready = new Set(), operations = [];
let session, run, server, report, failure;
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
const deadline = setTimeout(() => controller.abort(), 1_200_000);
const stop = () => {
  controller.abort(); session?.stop();
  server?.stop().catch(error => privateLog('failure.jsonl', { message: error.message }));
};
process.once('SIGINT', stop); process.once('SIGTERM', stop);

const onEvent = event => {
  privateLog('events.jsonl', event);
  if (event.type === 'pty_ready') ready.add(event.agentId);
  if (event.type === 'output' && event.agentId) {
    const buffer = Buffer.from(event.text ?? '');
    if (!hashes.has(event.agentId)) hashes.set(event.agentId, createHash('sha256'));
    hashes.get(event.agentId).update(buffer);
    bytes.set(event.agentId, (bytes.get(event.agentId) ?? 0) + buffer.length);
    appendFileSync(path.join(raw, `${event.agentId}.vt`), buffer, { mode: 0o600 });
  }
};
async function waitUntil(predicate, milliseconds) {
  const end = Date.now() + milliseconds;
  while (!predicate() && Date.now() < end && !controller.signal.aborted) await delay(250);
  return predicate();
}
async function observeOutput(id, before, milliseconds, reason) {
  const occurred = await waitUntil(() => (bytes.get(id) ?? 0) > before, milliseconds);
  note({ action: reason, agentId: id, beforeBytes: before, afterBytes: bytes.get(id) ?? 0,
    outputOccurred: occurred, semanticInterpretation: 'requires_operator_review' });
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
  if (!Number.isSafeInteger(availableBytes) || availableBytes < 10 * 1024 ** 3
    || admission.cpus < 4 || admission.freeDiskBytes < 3 * 1024 ** 3) throw new Error('seven_b_host_admission_failed');
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
  writeFileSync(path.join(raw, 'props-response.bin'), body, { mode: 0o600 });
  privateLog('props-request.jsonl', { at: time(), status: response.status, bytes: count });
  if (!response.ok) throw new Error('owned_props_request_failed');
  const props = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  const selected = typeof props.chat_template_tool_use === 'string' && props.chat_template_tool_use.trim()
    ? props.chat_template_tool_use : props.chat_template;
  const caps = props.chat_template_caps;
  const confirmed = props.model_alias === server.modelId && props.total_slots === 1
    && props.default_generation_settings?.n_ctx === 8192 && props.is_sleeping === false
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
  admitHost();
  const helper = await api.buildTerminalHelper({ directory: path.join(root, 'state', 'native') });
  save('helper.json', helper);
  server = await api.startLlamaServer({ command: prepared.llama, modelPath: prepared.model,
    modelId: 'koto-qwen-coder-7b', port: 18089, contextSize: 8192, gpuLayers: 0,
    memoryLimitBytes: 8 * 1024 ** 3, minimumFreeBytes: 3 * 1024 ** 3,
    startupTimeoutMs: 120_000, startupMaxRetries: 3, timeoutMs: 1_200_000, signal: controller.signal,
    onEvent: event => privateLog('runtime.jsonl', event) });
  await server.ready;
  save('runtime.json', { pid: server.pid, endpoint: server.endpoint, modelId: server.modelId,
    contextSize: server.contextSize, memoryLimitBytes: server.memoryLimitBytes, minimumFreeBytes: server.minimumFreeBytes });
  await inspectLoadedTemplate();
  const agents = [
    api.createAgentProfile({ kind: 'opencode', id: 'reader', command: prepared.opencode,
      model: 'local/koto-qwen-coder-7b', transport: 'pty', timeoutMs: 900_000,
      task: 'Read docs/NATIVE_SESSIONS.md. Explain in one short paragraph why clean process shutdown does not prove a correct contribution. Do not edit files. Wait for my next input.',
      owns: ['docs/NATIVE_SESSIONS.md'] }),
    api.createAgentProfile({ kind: 'opencode', id: 'contributor', command: prepared.opencode,
      model: 'local/koto-qwen-coder-7b', transport: 'pty', timeoutMs: 900_000,
      task: 'Read docs/INSTALLATION.md. Use your native edit tool to add one concise sentence clarifying that the selected local provider endpoint must match the running local server loopback URL. Change only this file, preserve existing facts, and report the exact sentence. Do not run commands or tests, or claim platform acceptance or model quality. Then wait for my next input.',
      owns: ['docs/INSTALLATION.md'] }),
  ];
  session = await api.createProjectSession({ schemaVersion: 1, project: path.join(root, 'project'),
    goal: 'Improve Koto installation guidance through an explicitly supervised local native-agent session.',
    controlRoot: path.join(root, 'control'), nativeHelperDirectory: path.join(root, 'state', 'native'),
    maxConcurrency: 2, timeoutMs: 960_000, agents }, { onEvent, signal: controller.signal });
  save('session-location.json', { sessionRoot: session.sessionRoot });
  run = session.run();
  // Observe an early lease/runtime rejection immediately; retain and await the
  // same promise in finally so an unhandled rejection cannot skip cleanup.
  run.catch(error => {
    failure ??= 'project_run_failed';
    privateLog('failure.jsonl', { message: error.message, stack: error.stack });
    controller.abort();
  });
  if (!await waitUntil(() => ready.size === 2, 90_000)) throw new Error('native_terminals_not_ready');
  note({ action: 'two_native_terminals_ready', state: session.status().agents.map(a => ({ id: a.id, status: a.status, pid: a.pid })) });
  // Observe a bounded initial interval. Screen text is never classified as a
  // completed turn or an approval request by this driver.
  await delay(300_000, undefined, { signal: controller.signal });
  for (const id of ['reader', 'contributor']) {
    const before = bytes.get(id) ?? 0;
    note({ action: 'resize_requested', agentId: id, columns: 110, rows: 34, accepted: session.resize(id, 110, 34) });
    await observeOutput(id, before, 10_000, 'native_output_after_resize');
  }
  note({ action: 'input_requested', agentId: 'reader', accepted: session.send('reader', 'Explain the cleanup limitation for descendants that detach from the owned session. Keep all files unchanged.\r') });
  await delay(45_000, undefined, { signal: controller.signal });
  session.stop('reader');
  note({ action: 'reader_stop_requested' });
  await waitUntil(() => !['pending', 'running'].includes(session.status().agents.find(a => a.id === 'reader')?.status), 15_000);
  note({ action: 'state_after_reader_stop', agents: session.status().agents.map(a =>
    ({ id: a.id, status: a.status, pid: a.pid, outcome: a.commandOutcome })) });
  const before = bytes.get('contributor') ?? 0;
  const followupStarted = Date.now();
  note({ action: 'input_after_peer_stop', agentId: 'contributor', accepted: session.send('contributor',
    'Read your change and report the exact sentence added and why the endpoint must match the running local server. Do not make further edits or run commands.\r') });
  await observeOutput('contributor', before, 300_000, 'native_output_after_peer_stop_and_followup');
  // Give this one native follow-up the full bounded observation interval even
  // when the first output is merely a TUI redraw. Never treat it as completion.
  await delay(Math.max(1, 300_000 - (Date.now() - followupStarted)), undefined, { signal: controller.signal });
} catch (error) {
  failure = /^[a-z][a-z0-9_]+$/.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'native_observation_incomplete';
  privateLog('failure.jsonl', { code: error.code, message: error.message, stack: error.stack });
} finally {
  session?.stop();
  if (run) { try { report = await run; } catch (error) { failure ??= 'project_run_failed'; privateLog('failure.jsonl', { message: error.message, stack: error.stack }); } }
  if (server) {
    try {
      const completion = await server.stop();
      save('runtime-completion.json', completion);
      if (completion.error || !['cancelled', 'succeeded'].includes(completion.status)) failure ??= 'runtime_cleanup_failed';
    }
    catch (error) { failure ??= 'runtime_cleanup_failed'; privateLog('failure.jsonl', { message: error.message }); }
  }
  clearTimeout(deadline);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
const inspections = {};
if (session) {
  for (const id of ['reader', 'contributor']) {
    try { inspections[id] = await session.inspect(id); }
    catch (error) { failure ??= 'retained_inspection_failed'; privateLog('failure.jsonl', { id, message: error.message }); }
  }
}
let projectAfter;
try { projectAfter = projectState(); }
catch (error) { failure ??= 'original_project_read_failed'; privateLog('failure.jsonl', { message: error.message }); }
if (JSON.stringify(projectBefore) !== JSON.stringify(projectAfter)) failure ??= 'original_project_changed';
const result = { schemaVersion: 1, variant: prepared.variant, candidate: prepared.candidate, root, platform: process.platform,
  arch: process.arch, sessionRoot: session?.sessionRoot ?? null, failure: failure ?? null,
  operations, report, inspections, projectBefore, projectAfter,
  output: Object.fromEntries([...hashes].map(([id, hash]) => [id, { bytes: bytes.get(id), sha256: hash.digest('hex') }])),
  nativeInputSemanticsVerified: false, nativeRedrawVerified: false, humanTerminalRestorationVerified: false,
  contributionReviewed: false, integrated: false,
  instruction: 'Inspect encrypted native output and public real diff. Boolean sends/resizes and output activity are not acceptance passes.' };
save('observation.json', result);
if (failure) process.exitCode = 1;
