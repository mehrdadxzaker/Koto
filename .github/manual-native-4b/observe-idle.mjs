// One explicitly dispatched, auth-free Windows native-terminal diagnosis.
// No model/server, prompt submission, CLI command submission, or acceptance claim.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, lstatSync,
  realpathSync, readdirSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ARCHIVE_SHA = '21cac96abb146b0f6e770680ea7855fc4f354c7966aab39f5be9859b0df1deac';
const RAW_LIMIT = 16 * 1024 ** 2;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const under = (base, file) => {
  const relative = path.relative(base, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
function regular(file, maximum = 8 * 1024 ** 2) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum
    || !same(realpathSync(file), file)) fail('idle_input_file_unsafe');
  return stat;
}
function bytes(file, maximum) { regular(file, maximum); return readFileSync(file); }
function json(file, maximum = 65536) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(file, maximum)));
}
function fileHash(file, maximum = 512 * 1024 ** 2) {
  const expected = regular(file, maximum).size;
  const descriptor = openSync(file, 'r'), digest = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024); let count = 0;
  try {
    for (;;) {
      const amount = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!amount) break;
      count += amount; if (count > maximum) fail('idle_file_hash_bound');
      digest.update(buffer.subarray(0, amount));
    }
  } finally { closeSync(descriptor); }
  if (count !== expected) fail('idle_file_changed');
  return digest.digest('hex');
}
const bindingFile = process.argv[2];
if (!bindingFile || process.argv.length !== 3) fail('idle_binding_file_required');
const bindingBytes = bytes(bindingFile, 65536), binding = JSON.parse(bindingBytes);
const candidate = process.env.OBS_CANDIDATE;
if (process.platform !== 'win32' || process.arch !== 'x64' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.OBS_EXECUTION !== 'windows-actions' || process.env.OBS_OPERATION !== 'idle'
  || !/^[a-z][a-z0-9-]{7,47}$/.test(process.env.OBS_ID ?? '')
  || !/^[a-f0-9]{40}$/.test(candidate ?? '') || binding.candidate !== candidate
  || binding.schemaVersion !== 1 || binding.kind !== 'koto-windows-idle-bindings'
  || binding.approvedForExecution !== true || binding.opencodeArchiveSha256 !== ARCHIVE_SHA
  || !/^[a-f0-9]{64}$/.test(binding.opencodeSha256 ?? '')
  || !/^[a-f0-9]{64}$/.test(binding.nativeConfigSha256 ?? '')) fail('explicit_windows_idle_required');
const mainRoot = path.join(homedir(), '.koto-native-observations-4b', process.env.OBS_ID);
if (!same(mainRoot, process.env.OBS_ROOT ?? '') || !same(realpathSync(mainRoot), mainRoot)) fail('idle_root_changed');
const prepared = json(path.join(mainRoot, 'prepared.json'));
if (prepared.schemaVersion !== 1 || prepared.variant !== 'idle-opencode' || prepared.candidate !== candidate
  || !same(prepared.root ?? '', mainRoot)) fail('idle_preparation_changed');
const installed = path.join(mainRoot, 'install', 'node_modules', '@mehrdadxzaker', 'koto');
const packageBytes = bytes(path.join(mainRoot, 'evidence', 'package.json'), 1024 * 1024);
const packageEvidence = JSON.parse(packageBytes), expectedFiles = new Set();
if (packageEvidence.candidate !== candidate || !/^[a-f0-9]{64}$/.test(packageEvidence.tarSha256 ?? '')
  || !Array.isArray(packageEvidence.payload) || !packageEvidence.payload.length
  || packageEvidence.payload.length > 512) fail('idle_package_evidence_missing');
for (const item of packageEvidence.payload) {
  if (typeof item.path !== 'string' || item.path.includes('\\') || item.path.split('/').some(p => !p || p === '.' || p === '..')
    || !under(installed, path.join(installed, item.path)) || expectedFiles.has(item.path)
    || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') || !Number.isSafeInteger(item.bytes)
    || item.bytes < 0 || item.bytes > 8 * 1024 ** 2) fail('idle_package_manifest_invalid');
  const value = bytes(path.join(installed, item.path));
  if (value.length !== item.bytes || hash(value) !== item.sha256) fail('idle_installed_payload_changed');
  expectedFiles.add(item.path);
}
let entries = 0;
const actualFiles = [];
function inventory(directory) {
  if (!same(realpathSync(directory), directory) || lstatSync(directory).isSymbolicLink()) fail('idle_package_directory_unsafe');
  for (const name of readdirSync(directory)) {
    if (++entries > 1024) fail('idle_package_inventory_bound');
    const file = path.join(directory, name), stat = lstatSync(file);
    if (stat.isSymbolicLink()) fail('idle_package_link_refused');
    if (stat.isDirectory()) inventory(file);
    else if (stat.isFile()) actualFiles.push(path.relative(installed, file).split(path.sep).join('/'));
    else fail('idle_package_entry_unsafe');
  }
}
inventory(installed);
if (JSON.stringify(actualFiles.sort()) !== JSON.stringify([...expectedFiles].sort())
  || !expectedFiles.has('src/terminal-session.js') || !expectedFiles.has('src/index.js')) fail('idle_package_inventory_changed');
const nativeExecutable = prepared.opencode;
if (typeof nativeExecutable !== 'string' || !under(path.join(mainRoot, 'tools', 'opencode'), nativeExecutable)
  || !nativeExecutable.toLowerCase().endsWith('.exe') || fileHash(nativeExecutable) !== binding.opencodeSha256) fail('idle_native_executable_changed');
const asset = json(path.join(mainRoot, 'evidence', 'asset-opencode.json'));
if (asset.sha256 !== ARCHIVE_SHA || asset.bytes !== 81744966) fail('idle_native_archive_changed');
const configBytes = bytes(path.join(mainRoot, 'host', 'opencode.json'), 65536), config = JSON.parse(configBytes);
const configEvidence = json(path.join(mainRoot, 'evidence', 'native-config.json'));
if (hash(configBytes) !== binding.nativeConfigSha256 || configEvidence.requestedSha256 !== binding.nativeConfigSha256
  || config.autoupdate !== false || config.share !== 'disabled' || JSON.stringify(config.plugin) !== '[]'
  || JSON.stringify(config.mcp) !== '{}' || config.lsp !== false || config.formatter !== false
  || config.compaction?.auto !== false || config.agent?.title?.disable !== true
  || JSON.stringify(config.enabled_providers) !== '["local"]'
  || config.model !== 'local/koto-qwen3-4b' || config.small_model !== config.model
  || config.provider?.local?.options?.baseURL !== 'http://127.0.0.1:18089/v1'
  || config.provider?.local?.npm !== '@ai-sdk/openai-compatible'
  || JSON.stringify(Object.keys(config.provider ?? {})) !== '["local"]') fail('idle_native_config_changed');
// Pinned v1.19.4 packages/opencode/src/index.ts:50-65 declares these native
// diagnostics. They do not submit a prompt; all resulting logs remain private.
const nativeArgs = ['--model', config.model, '--print-logs', '--log-level', 'DEBUG'];

// Preserve HOME/USERPROFILE. Only invocation-local state is used; credentials,
// injected Node/config overrides, and inherited OpenCode feature flags are removed.
const baseEnv = { ...process.env };
for (const key of Object.keys(baseEnv)) {
  if (/TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CREDENTIAL/i.test(key)
    || /^(?:OPENCODE_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$|NODE_PATH$|GIT_CONFIG_|(?:HTTP|HTTPS|ALL|NO)_PROXY$)/i.test(key)) delete baseEnv[key];
}
delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
process.env.KOTO_STATE_DIR = path.join(mainRoot, 'state');
const api = await import(pathToFileURL(path.join(installed, 'src', 'index.js')));
const { startTerminalCommand } = await import(pathToFileURL(path.join(installed, 'src', 'terminal-session.js')));
// This resolves and validates the existing source-bound helper, never builds it.
const helperPath = await api.resolveTerminalHelper({ directory: path.join(mainRoot, 'state', 'native') });
const helperSha256 = fileHash(helperPath, 8 * 1024 ** 2);
const root = path.join(mainRoot, 'evidence', 'raw', 'idle');
if (existsSync(root)) fail('idle_fresh_root_required');
mkdirSync(root, { mode: 0o700 });
writeFileSync(path.join(root, 'bindings.json'), bindingBytes, { flag: 'wx', mode: 0o600 });
const clients = ['reader', 'writer'].map(id => {
  const directory = path.join(root, id);
  for (const relative of ['', 'work', 'config', 'data', 'cache', 'state', 'npm-cache'])
    mkdirSync(path.join(directory, relative), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, 'opencode.json'), configBytes, { flag: 'wx', mode: 0o600 });
  return { id, directory, ready: false, ended: false, stopping: false, outputBytes: 0,
    outputDigest: createHash('sha256'), cleanup: null, outcome: null, handle: null };
});
const consoleReadback = { id: 'console-readback', ready: false, ended: false, stopping: false,
  outputBytes: 0, outputDigest: createHash('sha256'), output: '', cleanup: null, outcome: null, handle: null };
const owned = [consoleReadback, ...clients];
const startedAt = new Date().toISOString(), started = performance.now();
const controller = new AbortController(); let failure = null, rawBytes = 0, phase = 'prepared';
const actions = [], milestones = [], failures = [];
const stamp = () => ({ at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), phase });
function remember(error, fallback = 'idle_observation_incomplete') {
  const value = typeof error === 'string' ? error : error?.code;
  const code = ['EMFILE', 'ENFILE', 'EADDRNOTAVAIL', 'ENOBUFS'].includes(value) ? 'idle_resource_exhausted'
    : typeof value === 'string' && /^[a-z][a-z0-9_]+$/.test(value) ? value : fallback;
  const priority = v => v?.endsWith('cleanup_unconfirmed') ? 3 : /(?:socket|resource)_exhausted$/.test(v ?? '') ? 2 : v ? 1 : 0;
  if (priority(code) > priority(failure)) failure = code;
  if (failures.length < 64) failures.push({ ...stamp(), code });
}
function stopAll() {
  controller.abort();
  for (const client of owned) {
    client.stopping = true;
    try { client.handle?.stop(); } catch (error) { remember(error, 'idle_stop_failed'); }
  }
}
function append(name, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (rawBytes + data.length > RAW_LIMIT) fail('idle_raw_evidence_bound');
  rawBytes += data.length;
  appendFileSync(path.join(root, name), data, { mode: 0o600 });
}
function note(action, details = {}) {
  const record = { ...stamp(), action, ...details };
  if (actions.length >= 128) fail('idle_action_bound');
  actions.push(record); append('actions.jsonl', JSON.stringify(record) + '\n');
}
function capture(client, event) {
  try {
    append('events.jsonl', JSON.stringify({ ...stamp(), client: client.id, event }) + '\n');
    if (event.type === 'pty_ready') client.ready = true;
    if (event.type === 'terminal_cleanup') client.cleanup = event;
    if (event.type === 'output') {
      const output = Buffer.from(event.text ?? '');
      client.outputBytes += output.length; client.outputDigest.update(output);
      if (client === consoleReadback) {
        if (client.outputBytes > 65536) fail('idle_console_readback_bound');
        client.output += output.toString('utf8');
      }
      append(`${client.id}.vt`, output);
    } else {
      if (milestones.length >= 256) fail('idle_milestone_bound');
      milestones.push({ ...stamp(), client: client.id, event });
    }
  } catch (error) { remember(error, 'idle_evidence_write_failed'); stopAll(); }
}
const pause = milliseconds => delay(milliseconds, undefined, { signal: controller.signal });
async function endpointAbsent() {
  let socket;
  try {
    await new Promise((resolve, reject) => {
      socket = createConnection({ host: '127.0.0.1', port: 18089 }); socket.setTimeout(1000);
      socket.once('connect', () => reject(Object.assign(new Error('endpoint_present'), { code: 'idle_endpoint_present' })));
      socket.once('timeout', () => reject(Object.assign(new Error('endpoint_unknown'), { code: 'idle_endpoint_absence_unknown' })));
      socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    });
  } finally { socket?.destroy(); }
  note('endpoint_absent', { endpoint: '127.0.0.1:18089', evidence: 'ECONNREFUSED', requestBytes: 0 });
}
function nativeEnv(client) {
  return { ...baseEnv, KOTO_STATE_DIR: path.join(mainRoot, 'state'), TERM: 'xterm-256color', COLORTERM: 'truecolor',
    XDG_CONFIG_HOME: path.join(client.directory, 'config'), XDG_DATA_HOME: path.join(client.directory, 'data'),
    XDG_CACHE_HOME: path.join(client.directory, 'cache'), XDG_STATE_HOME: path.join(client.directory, 'state'),
    OPENCODE_CONFIG: path.join(client.directory, 'opencode.json'), OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_PURE: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', OPENCODE_DISABLE_FFF: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true', OPENCODE_EXPERIMENTAL: 'false',
    OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'false', OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: 'true',
    npm_config_offline: 'true', npm_config_cache: path.join(client.directory, 'npm-cache'),
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
}
function send(client, text, action) {
  controller.signal.throwIfAborted();
  if (/[\r\n]/.test(text)) fail('idle_submission_refused');
  const accepted = client.handle.send(text);
  note(action, { client: client.id, accepted, inputSha256: hash(text), inputBytes: Buffer.byteLength(text),
    outputBytesBefore: client.outputBytes, semanticInterpretation: 'requires_manual_review' });
  if (!accepted) fail('idle_input_rejected');
}
async function stopOne(client) {
  client.stopping = true;
  note('stop_requested', { client: client.id, pid: client.handle?.pid ?? null });
  client.handle.stop(); await client.handle.completion;
  note('stop_settled', { client: client.id, outcome: client.outcome, cleanup: client.cleanup });
  if (client.cleanup?.cleanup !== 'confirmed') fail('idle_cleanup_unconfirmed');
  if (client.outcome?.error || !['cancelled', 'succeeded'].includes(client.outcome?.status))
    fail(client.outcome?.error ?? 'idle_stop_failed');
}
const interrupt = () => { remember('idle_external_stop'); stopAll(); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const deadline = setTimeout(() => { remember('idle_observation_deadline'); stopAll(); }, 90000);
try {
  phase = 'endpoint_check'; await endpointAbsent(); controller.signal.throwIfAborted();
  phase = 'console_readback';
  // One real host-Node console inspection, not a fake native client or task.
  // Do not import any extracted script or report these facts as acceptance.
  const consoleSource = "const tty=require('node:tty');console.log(JSON.stringify({stdinIsTTY:process.stdin.isTTY===true,stdoutIsTTY:process.stdout.isTTY===true,stderrIsTTY:process.stderr.isTTY===true,isatty0:tty.isatty(0),isatty1:tty.isatty(1),isatty2:tty.isatty(2),platform:process.platform,arch:process.arch}));";
  note('console_readback_requested', { sourceSha256: hash(consoleSource), timeoutMs: 10000, columns: 240, rows: 30 });
  consoleReadback.handle = startTerminalCommand({ id: consoleReadback.id, command: process.execPath,
    args: ['-e', consoleSource], cwd: root, env: { ...baseEnv, KOTO_STATE_DIR: path.join(mainRoot, 'state'), TERM: 'xterm-256color' },
    transport: 'pty', timeoutMs: 10000, columns: 240, rows: 30, helperPath,
    signal: controller.signal, onEvent: event => capture(consoleReadback, event) });
  consoleReadback.watch = consoleReadback.handle.completion.then(outcome => {
    consoleReadback.ended = true; consoleReadback.outcome = outcome;
  }, error => { consoleReadback.ended = true; remember(error, 'idle_console_completion_rejected'); stopAll(); });
  await consoleReadback.watch;
  note('console_readback_settled', { outcome: consoleReadback.outcome, cleanup: consoleReadback.cleanup });
  if (consoleReadback.cleanup?.cleanup !== 'confirmed') fail('idle_console_cleanup_unconfirmed');
  if (consoleReadback.outcome?.error || consoleReadback.outcome?.status !== 'succeeded')
    fail(consoleReadback.outcome?.error ?? 'idle_console_readback_failed');
  const readbacks = consoleReadback.output.match(/\{"stdinIsTTY":(?:true|false),"stdoutIsTTY":(?:true|false),"stderrIsTTY":(?:true|false),"isatty0":(?:true|false),"isatty1":(?:true|false),"isatty2":(?:true|false),"platform":"win32","arch":"x64"\}/g);
  if (readbacks?.length !== 1) fail('idle_console_readback_unrecognized');
  consoleReadback.facts = JSON.parse(readbacks[0]);
  if (Object.entries(consoleReadback.facts).some(([key, value]) => !['platform', 'arch'].includes(key) && value !== true))
    remember('idle_console_not_tty');
  note('console_facts', { facts: consoleReadback.facts, interpretation: 'Actual OS console readback only.' });
  controller.signal.throwIfAborted();
  phase = 'launch';
  for (const client of clients) {
    note('launch_requested', { client: client.id, transport: 'pty', columns: 100, rows: 30,
      args: nativeArgs, nativeStateFresh: true });
    client.handle = startTerminalCommand({ id: client.id, command: nativeExecutable,
      args: nativeArgs, cwd: path.join(client.directory, 'work'), env: nativeEnv(client),
      transport: 'pty', timeoutMs: 75000, columns: 100, rows: 30, helperPath,
      signal: controller.signal, onEvent: event => capture(client, event) });
    client.watch = client.handle.completion.then(outcome => {
      client.ended = true; client.outcome = outcome;
      if (outcome.error) remember(outcome.error);
      if (!client.stopping) { remember('idle_client_ended_before_stop'); stopAll(); }
    }, error => { client.ended = true; remember(error, 'idle_completion_rejected'); stopAll(); });
  }
  phase = 'waiting_ready';
  const readyDeadline = performance.now() + 20000;
  while (!clients.every(client => client.ready) && performance.now() < readyDeadline) await pause(100);
  if (!clients.every(client => client.ready)) fail('idle_ready_timeout');
  note('both_helpers_ready', { clients: clients.map(c => ({ id: c.id, pid: c.handle.pid })) });
  phase = 'initial_render'; await pause(8000);
  for (const client of clients) {
    phase = `unsent_draft_${client.id}`;
    send(client, 'idle diagnostic draft - do not submit', 'unsent_draft_requested');
    await pause(1000); send(client, '\x15', 'clear_draft_requested');
    const dimensions = client.id === 'reader' ? [92, 28] : [132, 36];
    const accepted = client.handle.resize(...dimensions);
    note('resize_requested', { client: client.id, columns: dimensions[0], rows: dimensions[1], accepted,
      outputBytesBefore: client.outputBytes, nativeRedrawVerified: false });
    if (!accepted) fail('idle_resize_rejected');
  }
  phase = 'resized_render'; await pause(6000);
  phase = 'reader_stop'; await stopOne(clients[0]);
  phase = 'writer_after_reader_stop';
  note('peer_state_after_stop', { readerEnded: clients[0].ended, writerEnded: clients[1].ended,
    writerPid: clients[1].handle.pid, writerOutputBytes: clients[1].outputBytes });
  if (clients[1].ended) fail('idle_peer_ended_with_reader');
  send(clients[1], 'still idle - do not submit', 'peer_unsent_draft_requested');
  await pause(1000); send(clients[1], '\x15', 'peer_clear_draft_requested');
  await pause(3000); phase = 'writer_stop'; await stopOne(clients[1]);
} catch (error) { remember(error, /^[a-z][a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'idle_observation_incomplete'); }
finally {
  phase = 'final_cleanup'; stopAll();
  // Always await both owned lifetimes, including after a failed first stop.
  try {
    await Promise.allSettled(owned.map(async client => {
      if (client.handle) {
        try { await client.handle.completion; await client.watch; }
        catch (error) { remember(error, 'idle_cleanup_wait_failed'); }
        if (!client.ended || client.cleanup?.cleanup !== 'confirmed'
          || client.outcome?.error?.endsWith('cleanup_unconfirmed')) remember('idle_cleanup_unconfirmed');
      }
    }));
  } finally {
    clearTimeout(deadline); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}
for (const client of clients) {
  if (!client.handle || !client.ready) remember('idle_client_not_ready');
  if (!client.outputBytes) remember('idle_client_output_missing');
}
phase = 'receipt';
const receipt = { schemaVersion: 1, kind: 'koto-windows-idle-observation', candidate,
  observationId: process.env.OBS_ID, startedAt, finishedAt: new Date().toISOString(),
  elapsedMs: Math.round(performance.now() - started), bindingSha256: hash(bindingBytes),
  packageEvidenceSha256: hash(packageBytes), packageTarSha256: packageEvidence.tarSha256,
  opencodeArchiveSha256: ARCHIVE_SHA, nativeExecutableSha256: binding.opencodeSha256,
  nativeConfigSha256: hash(configBytes), nativeArgs, helperSha256, helperPath,
  bounds: { clients: 2, consoleReadbackTimeoutMs: 10000, clientTimeoutMs: 75000,
    observationTimeoutMs: 90000, maxCapturedRawBytes: RAW_LIMIT },
  consoleReadback: { ready: consoleReadback.ready, ended: consoleReadback.ended,
    outputBytes: consoleReadback.outputBytes, outputSha256: consoleReadback.outputDigest.digest('hex'),
    facts: consoleReadback.facts ?? null, outcome: consoleReadback.outcome, cleanup: consoleReadback.cleanup },
  clients: clients.map(c => ({ id: c.id, pid: c.handle?.pid ?? null, ready: c.ready, ended: c.ended,
    nativeStateDirectory: c.directory, outputBytes: c.outputBytes, outputSha256: c.outputDigest.digest('hex'),
    outcome: c.outcome, cleanup: c.cleanup })), actions, milestones, rawBytes, failure, failures,
  noModelStarted: true, noTaskPromptSubmitted: true, noInferenceRequestedByDriver: true,
  nativeInputSemanticsVerified: false, nativeRedrawVerified: false, humanTerminalRestorationVerified: false,
  interpretation: 'Idle diagnosis only. Ready, accepted input/resize and output bytes are transport observations, not native semantic or useful-task acceptance. Product cleanup failures remain failures.' };
try { writeFileSync(path.join(root, 'observation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
catch (error) { remember(error, 'idle_receipt_write_failed'); }
process.stdout.write(JSON.stringify({ kind: receipt.kind, candidate, observationId: process.env.OBS_ID,
  receipt: path.join(root, 'observation.json'), failure, semanticReviewRequired: true }) + '\n');
if (failure) process.exitCode = 1;
