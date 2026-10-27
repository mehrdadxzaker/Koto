import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startCommand } from './command-session.js';
import { startSetupCommand } from './setup-command.js';
import { effectiveMemoryCapacity, readHostMemory } from './host-memory.js';
import { fetchHeaders, safeDownloadCauseCode, throwOnResourceExhaustion } from './bounded-fetch.js';
import { resolveAgentExecutable } from './launch-preflight.js';

const GIB = 1024 ** 3;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const ENDPOINTS = { ollama: 'http://127.0.0.1:11434', llama: 'http://127.0.0.1:18089' };

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw failure('local_invalid_option', `${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
function localEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { /* Report one actionable validation error. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || !['/', '/v1', '/v1/'].includes(url.pathname)) {
    throw failure('local_loopback_required', 'Choose an HTTP(S) loopback endpoint such as http://127.0.0.1:11434; remote providers are not local models.');
  }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}
function kindOf(kind) {
  if (!Object.hasOwn(ENDPOINTS, kind)) throw failure('local_kind_invalid', 'Choose ollama or llama.');
  return kind;
}

async function jsonRequest(url, { signal, timeoutMs = 3000 } = {}) {
  const bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  let response;
  try { response = await fetch(url, { signal: bounded, redirect: 'error' }); }
  catch (error) {
    throwOnResourceExhaustion(error);
    throw failure('local_endpoint_unavailable', 'The selected local server is unavailable. Start the installed runtime, then retry.');
  }
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    let retryAfterMs;
    if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) retryAfterMs = Number(retryAfter) * 1000;
    else if (retryAfter && Number.isFinite(Date.parse(retryAfter))) retryAfterMs = Math.max(0, Date.parse(retryAfter) - Date.now());
    await response.body?.cancel();
    throw Object.assign(failure(response.status === 503 ? 'local_model_loading' : 'local_endpoint_failed',
      response.status === 503 ? 'The selected local server is still loading its model.' : `The selected local server returned HTTP ${response.status}.`),
    { status: response.status, ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}) });
  }
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw failure('local_endpoint_output_limit', 'Local server metadata exceeded its 1 MiB limit.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throwOnResourceExhaustion(error);
    if (error.code?.startsWith('local_')) throw error;
    throw failure('local_endpoint_metadata_invalid', 'The local server did not return bounded, valid JSON metadata.');
  }
}

/** Read local metadata only. Health/model listing does not request inference. */
export async function checkLocalEndpoint({ kind = 'ollama', endpoint = ENDPOINTS[kind], signal } = {}) {
  kindOf(kind);
  endpoint = localEndpoint(endpoint);
  if (kind === 'llama') {
    const health = await jsonRequest(`${endpoint}/health`, { signal });
    if (health.status !== 'ok') throw failure('local_model_loading', 'The llama.cpp server has not reported ready.');
  }
  const data = await jsonRequest(`${endpoint}${kind === 'ollama' ? '/api/tags' : '/v1/models'}`, { signal });
  const records = kind === 'ollama' ? data.models : data.data;
  if (!Array.isArray(records) || records.length > 10_000) {
    throw failure('local_endpoint_metadata_invalid', 'The selected runtime returned an invalid model list.');
  }
  const models = records.map(record => ({ id: kind === 'ollama' ? record.name : record.id,
    ...(Number.isSafeInteger(record.size) ? { bytes: record.size } : {}),
    ...(typeof record.digest === 'string' ? { digest: record.digest } : {}) }));
  if (models.some(model => typeof model.id !== 'string' || !model.id || model.id.length > 4096)) {
    throw failure('local_endpoint_metadata_invalid', 'The selected runtime returned an invalid model identifier.');
  }
  return { kind, endpoint, apiBaseUrl: `${endpoint}/v1`, status: 'ready', models };
}

/** Discover installed commands and already-running servers; never auto-start them. */
export async function discoverLocalModels({ ollamaCommand = 'ollama', llamaCommand = 'llama-server',
  ollamaEndpoint = ENDPOINTS.ollama, llamaEndpoint = ENDPOINTS.llama, signal } = {}) {
  const records = await Promise.all([
    ['ollama', ollamaCommand, ollamaEndpoint], ['llama', llamaCommand, llamaEndpoint],
  ].map(async ([kind, command, selectedEndpoint]) => {
    const endpoint = localEndpoint(selectedEndpoint);
    let executable;
    try { executable = await resolveAgentExecutable(command); } catch { /* Discovery reports missing tools. */ }
    try { return [kind, { executable, ...(await checkLocalEndpoint({ kind, endpoint, signal })), reachable: true }]; }
    catch (error) { return [kind, { kind, executable, endpoint, apiBaseUrl: `${endpoint}/v1`, reachable: false,
      models: [], error: error.code, message: error.message }]; }
  }));
  if (records.some(([, runtime]) => runtime.error === 'local_socket_exhausted')) {
    throw failure('local_socket_exhausted', 'Socket or file-descriptor capacity is unavailable. Stop new requests and inspect system resources before retrying.');
  }
  return Object.fromEntries(records);
}

/** Explicit download through the installed Ollama CLI; native cache/partials stay native. */
export async function pullOllamaModel({ model, command = 'ollama', endpoint = ENDPOINTS.ollama,
  timeoutMs = 3_600_000, signal, onProgress } = {}) {
  if (typeof model !== 'string' || !MODEL.test(model) || /(?:^|[:-])cloud$/i.test(model)) {
    throw failure('local_model_name_invalid', 'Select an explicit local Ollama model name/tag; cloud-only models are unsupported.');
  }
  integer(timeoutMs, 1, 3_600_000, 'timeoutMs');
  endpoint = localEndpoint(endpoint);
  const executable = await resolveAgentExecutable(command);
  await checkLocalEndpoint({ kind: 'ollama', endpoint, signal });
  const handle = startCommand({ id: 'ollamaPull', command: executable, args: ['pull', model],
    env: { ...process.env, OLLAMA_HOST: endpoint }, timeoutMs, signal, onEvent: onProgress });
  handle.endInput();
  const result = await handle.completion;
  if (result.status !== 'succeeded') throw failure(`local_pull_${result.error ?? result.status}`,
    `Ollama pull did not complete (${result.error ?? result.status}). Native downloaded layers are preserved; no fallback provider was used.`);
  const installed = await checkLocalEndpoint({ kind: 'ollama', endpoint, signal });
  const selected = installed.models.find(item => item.id === model || item.id === `${model}:latest`);
  if (!selected) throw failure('local_pull_not_listed', 'Ollama exited successfully but did not list the requested model. Inspect the native Ollama cache before using it.');
  return { ...selected, kind: 'ollama', endpoint, apiBaseUrl: `${endpoint}/v1`, executable };
}

async function availablePort(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      probe.close(() => {});
      try { throwOnResourceExhaustion(error); }
      catch (fatal) { reject(fatal); return; }
      reject(failure('local_port_unavailable', 'The selected loopback port is occupied or unavailable. Choose another port; Koto will not stop an existing server.'));
    });
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(error => error ? reject(error) : resolve()));
  });
}

async function residentBytes(pid, signal) {
  if (process.platform === 'linux') {
    const text = await readFile(`/proc/${pid}/status`, { encoding: 'utf8', signal });
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(text);
    if (!match) throw failure('local_memory_metrics_unavailable', 'The owned server resident-memory metric is unavailable.');
    return Number(match[1]) * 1024;
  }
  let text = '', exceeded = false;
  const controller = new AbortController();
  const windows = process.platform === 'win32';
  const command = windows ? await resolveAgentExecutable('powershell.exe') : '/bin/ps';
  const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; [Console]::Write((Get-Process -Id ' + String(pid) + ' -ErrorAction Stop).WorkingSet64)']
    : ['-o', 'rss=', '-p', String(pid)];
  const processInfo = await startSetupCommand({ id: 'llamaMemory', command, args,
    timeoutMs: 2000, signal: AbortSignal.any([signal, controller.signal]), onEvent(event) {
      if (event.type !== 'output') return;
      if (text.length + event.text.length > 4096) { exceeded = true; controller.abort(); return; }
      text += event.text;
    } });
  processInfo.endInput();
  const result = await processInfo.completion;
  if (result.error === 'cleanup_unconfirmed') {
    throw failure('local_memory_cleanup_unconfirmed', 'Cleanup of the owned memory-metric process could not be confirmed.');
  }
  throwOnResourceExhaustion({ code: result.error });
  if (result.status !== 'succeeded' || exceeded || !/^\s*\d+\s*$/.test(text)) {
    throw failure('local_memory_metrics_unavailable', 'The owned server resident-memory metric could not be read safely.');
  }
  return Number(text.trim()) * (windows ? 1 : 1024);
}

/** Start only an explicit existing GGUF/binary. The returned owner must remain alive.
 * Memory bounds are sampled process RSS and host free memory, not an OS quota or GPU accounting.
 */
export async function startLlamaServer({ modelPath, command = 'llama-server', port = 18089, contextSize = 8192,
  memoryLimitBytes, minimumFreeBytes = GIB,
  gpuLayers = 0, cacheRamMiB = 0, modelId = `koto-local-${randomUUID().slice(0, 8)}`, startupTimeoutMs = 120_000,
  startupMaxRetries = 3, timeoutMs = 1_800_000, signal, onEvent } = {}) {
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
    throw failure('local_memory_guard_unsupported', 'Owned llama-server startup requires a supported native process and memory-monitoring platform.');
  }
  const capacity = effectiveMemoryCapacity();
  if (memoryLimitBytes === undefined) memoryLimitBytes = Math.min(16 * GIB, Math.floor(capacity * 0.7));
  integer(port, 1024, 65535, 'port'); integer(contextSize, 512, 32768, 'contextSize');
  integer(gpuLayers, 0, 1024, 'gpuLayers'); integer(startupTimeoutMs, 1, 600_000, 'startupTimeoutMs');
  integer(cacheRamMiB, 0, 1024, 'cacheRamMiB');
  integer(startupMaxRetries, 0, 30, 'startupMaxRetries');
  integer(timeoutMs, startupTimeoutMs, 3_600_000, 'timeoutMs');
  integer(memoryLimitBytes, 256 * 1024 ** 2, Math.floor(capacity * 0.8), 'memoryLimitBytes');
  integer(minimumFreeBytes, 256 * 1024 ** 2, Math.floor(capacity * 0.5), 'minimumFreeBytes');
  if (typeof modelPath !== 'string' || !path.isAbsolute(modelPath) || modelPath.includes('\0') || !/\.gguf$/i.test(modelPath)) {
    throw failure('local_gguf_required', 'Select the absolute path to an existing GGUF model. Startup never downloads weights.');
  }
  if (typeof modelId !== 'string' || !MODEL.test(modelId)) throw failure('local_model_name_invalid', 'Choose a simple local server model alias.');
  if (process.env.LLAMA_API_KEY) {
    throw failure('local_server_auth_configured', 'LLAMA_API_KEY is configured on this host. Authenticated local-server management is not implemented; preserve that configuration and start the server with its native tools.');
  }
  const executable = await resolveAgentExecutable(command);
  modelPath = await realpath(modelPath);
  const info = await lstat(modelPath);
  if (!info.isFile() || info.size < 4 || info.size > memoryLimitBytes) {
    throw failure('local_model_memory_budget', 'The selected GGUF must be a regular file smaller than the server memory budget. Choose a smaller model or an explicit safe budget.');
  }
  const file = await open(modelPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const header = Buffer.alloc(4);
    if ((await file.read(header, 0, 4, 0)).bytesRead !== 4 || header.toString('ascii') !== 'GGUF') {
      throw failure('local_gguf_invalid', 'The selected file does not have a GGUF header.');
    }
  } finally { await file.close(); }
  const hostMemory = await readHostMemory({ signal });
  const free = hostMemory.availableBytes;
  if (!Number.isSafeInteger(free) || free < minimumFreeBytes) {
    throw failure('local_memory_unavailable', 'Host free-memory metrics are unavailable or below the selected reserve. No server was started.');
  }
  if (signal?.aborted) throw failure('local_cancelled', 'Local server startup was cancelled.');
  await availablePort(port);
  const endpoint = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const joinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^LLAMA_ARG_/i.test(key)));
  const startupDeadline = Date.now() + startupTimeoutMs;
  const validPid = value => Number.isSafeInteger(value) && value > 0;
  let pid, acceptStartedPid;
  const handle = await startSetupCommand({ id: 'llamaServer', command: executable, env, timeoutMs, signal: joinedSignal,
    args: ['--model', modelPath, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', String(contextSize),
      '--parallel', '1', '--alias', modelId, '--n-gpu-layers', String(gpuLayers), '--fit', 'off',
      '--cache-ram', String(cacheRamMiB), '--offline', '--no-warmup', '--no-webui', '--jinja'], onEvent(event) {
      if (event.type === 'started' && validPid(event.pid)) {
        pid = event.pid;
        acceptStartedPid?.(pid);
      }
      return onEvent?.(event);
    } });
  handle.endInput();
  let pidTimer, cancelPidWait;
  try {
    // POSIX exposes its direct workload immediately. Windows exposes a PID
    // only after its helper's verified ready record, never the helper's PID.
    if (!validPid(pid) && validPid(handle.pid)) pid = handle.pid;
    if (!validPid(pid)) pid = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(pidTimer);
        joinedSignal.removeEventListener('abort', cancelPidWait);
        acceptStartedPid = undefined;
        if (error) reject(error); else resolve(value);
      };
      acceptStartedPid = value => finish(undefined, value);
      cancelPidWait = () => finish(failure('local_cancelled', 'Local server startup was cancelled before its workload identity was available.'));
      joinedSignal.addEventListener('abort', cancelPidWait, { once: true });
      pidTimer = setTimeout(() => finish(failure('local_server_pid_unavailable',
        'The owned local server did not report its workload identity before the startup deadline.')),
      Math.min(5000, Math.max(1, startupDeadline - Date.now())));
      handle.completion.then(outcome => {
        if (outcome.error !== 'cleanup_unconfirmed') {
          try { throwOnResourceExhaustion({ code: outcome.error }); }
          catch (fatal) { finish(fatal); return; }
        }
        finish(failure(outcome.error === 'cleanup_unconfirmed' ? 'local_server_cleanup_unconfirmed' : 'local_server_not_ready',
          'The owned local server stopped before reporting its workload identity.'));
      });
      if (joinedSignal.aborted) cancelPidWait();
      else if (validPid(pid)) finish(undefined, pid);
    });
  } catch (error) {
    controller.abort(); handle.stop();
    const outcome = await handle.completion;
    if (outcome.error === 'cleanup_unconfirmed') {
      throw failure('local_server_cleanup_unconfirmed', 'Local server cleanup could not be confirmed after startup failed. Inspect the owned process before retrying.');
    }
    throwOnResourceExhaustion({ code: outcome.error });
    throwOnResourceExhaustion(error);
    throw error;
  } finally {
    clearTimeout(pidTimer);
    if (cancelPidWait) joinedSignal.removeEventListener('abort', cancelPidWait);
    acceptStartedPid = undefined;
  }
  let finished = false, guardError, memory, memoryDiagnostic, confirmInitialMemory;
  const initialMemory = new Promise(resolve => { confirmInitialMemory = resolve; });
  const completion = handle.completion.then(async result => {
    finished = true;
    controller.abort();
    await memory;
    return guardError ? { ...result, status: 'failed',
      error: result.error === 'cleanup_unconfirmed' || guardError.code === 'local_memory_cleanup_unconfirmed'
        ? 'cleanup_unconfirmed' : result.error?.endsWith('_socket_exhausted') ? result.error : guardError.code,
      ...(memoryDiagnostic ? { memoryDiagnostic } : {}) } : result;
  });
  memory = (async () => {
    while (!finished && !joinedSignal.aborted) {
      try {
        const sampleStartedAtMs = Date.now();
        const rss = await residentBytes(pid, joinedSignal);
        const hostMemory = await readHostMemory({ signal: joinedSignal });
        const available = hostMemory.availableBytes;
        if (!Number.isSafeInteger(rss) || rss < 0 || !Number.isSafeInteger(available) || available < 0) {
          throw failure('local_memory_metrics_unavailable', 'Memory monitoring became unavailable; the owned server was stopped.');
        }
        if (rss > memoryLimitBytes || available < minimumFreeBytes) {
          memoryDiagnostic = Object.freeze({ sampleStartedAtMs, sampledAtMs: Date.now(),
            source: hostMemory.source, totalBytes: hostMemory.totalBytes, rawFreeBytes: hostMemory.rawFreeBytes,
            ...(hostMemory.physicalTotalBytes === undefined ? {} : { physicalTotalBytes: hostMemory.physicalTotalBytes }),
            ...(hostMemory.cgroup ? { cgroup: Object.freeze({ ...hostMemory.cgroup }) } : {}), cacheRamMiB,
            availableBytes: available, rssBytes: rss, memoryLimitBytes, minimumFreeBytes,
            rssExceeded: rss > memoryLimitBytes, availableBelowReserve: available < minimumFreeBytes });
          guardError = Object.assign(failure('local_memory_limit',
            'The owned server exceeded its resident-memory budget or host available-memory reserve and was stopped.'), { memoryDiagnostic });
          controller.abort();
          // The error and settled completion retain this sample. Reporting it
          // requires no new observer invocation during owned-process cleanup.
          break;
        }
        confirmInitialMemory(true);
        await delay(1000, undefined, { signal: joinedSignal });
      } catch (error) {
        try { throwOnResourceExhaustion(error); }
        catch (fatal) { error = fatal; }
        if (error.code === 'local_memory_cleanup_unconfirmed') {
          guardError = error; controller.abort(); break;
        }
        if (error.code?.endsWith('_socket_exhausted')) {
          guardError = error; controller.abort(); break;
        }
        if (finished || joinedSignal.aborted) break;
        guardError = error.code?.startsWith('local_') || error.code?.endsWith('_socket_exhausted')
          ? error : failure('local_memory_metrics_unavailable', 'Memory monitoring failed; the owned server was stopped.');
        controller.abort();
        break;
      }
    }
    confirmInitialMemory(false);
  })();
  const ready = (async () => {
    const deadline = startupDeadline;
    // Do not poll a healthy endpoint while the first asynchronous RSS/host
    // sample is pending. Admission must be confirmed before readiness probes.
    const memoryAccepted = await initialMemory;
    let attempts = 0;
    while (memoryAccepted && !finished && !joinedSignal.aborted && Date.now() < deadline && attempts <= startupMaxRetries) {
      attempts += 1;
      try {
        const metadata = await checkLocalEndpoint({ kind: 'llama', endpoint, signal: joinedSignal });
        if (guardError || joinedSignal.aborted || finished) break;
        if (!metadata.models.some(model => model.id === modelId)) {
          throw failure('local_server_identity_mismatch', 'The loopback endpoint did not advertise this owned server\'s model alias.');
        }
        if (guardError || joinedSignal.aborted || finished) break;
        return metadata;
      } catch (error) {
        if (['local_server_identity_mismatch', 'local_socket_exhausted'].includes(error.code)) {
          if (!guardError?.code?.endsWith('cleanup_unconfirmed')) guardError = error;
          controller.abort(); break;
        }
        if (attempts > startupMaxRetries) break;
        const backoff = Math.max(error.retryAfterMs ?? 0,
          Math.min(30_000, 5000 * 2 ** Math.min(attempts - 1, 5)) + Math.floor(Math.random() * 250));
        try { await delay(Math.min(backoff, Math.max(1, deadline - Date.now())), undefined, { signal: joinedSignal }); } catch { break; }
      }
    }
    if (!finished && !joinedSignal.aborted) {
      guardError = failure(attempts > startupMaxRetries ? 'local_server_start_retries_exhausted' : 'local_server_start_timeout',
        attempts > startupMaxRetries ? `The owned local model did not become ready within ${startupMaxRetries + 1} startup probes. Verified assets were retained; no further requests were made.`
          : 'The owned local model did not become ready before its startup deadline.');
      controller.abort();
    }
    const result = await completion;
    if (result.error === 'cleanup_unconfirmed') throw Object.assign(
      failure('local_server_cleanup_unconfirmed', 'Local server cleanup could not be confirmed. Inspect the owned process before retrying.'),
      memoryDiagnostic ? { memoryDiagnostic } : {});
    try { throwOnResourceExhaustion({ code: result.error }); }
    catch (fatal) { if (memoryDiagnostic) fatal.memoryDiagnostic = memoryDiagnostic; throw fatal; }
    if (guardError && memoryDiagnostic) guardError.memoryDiagnostic ??= memoryDiagnostic;
    throw guardError ?? failure('local_server_not_ready', `The owned server stopped before readiness (${result.error ?? result.status}). Inspect its native output.`);
  })();
  ready.catch(() => {}); // An owner may await completion before checking readiness.
  return { endpoint, apiBaseUrl: `${endpoint}/v1`, modelId, modelPath, executable, pid,
    contextSize, memoryLimitBytes, minimumFreeBytes, gpuLayers, cacheRamMiB, startupMaxRetries, ready, completion,
    stop() { controller.abort(); return completion; } };
}

async function progress(callback, event, signal) {
  signal.throwIfAborted();
  if (!callback) return;
  let abort;
  try {
    await Promise.race([Promise.resolve().then(() => callback(event)), new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}

/** Explicit compatible-weight download: HTTPS, caller hash/byte cap, no overwrite. */
export async function downloadGguf({ url, destination, sha256, maxBytes, timeoutMs = 3_600_000, signal, onProgress } = {}) {
  let source;
  try { source = new URL(url); } catch { /* One validation error below. */ }
  if (!source || source.protocol !== 'https:' || source.username || source.password || source.hash
    || typeof destination !== 'string' || !path.isAbsolute(destination) || !/\.gguf$/i.test(destination)
    || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) {
    throw failure('local_download_invalid', 'Provide an explicit HTTPS GGUF URL, absolute .gguf destination, SHA-256 digest and maximum byte count.');
  }
  integer(maxBytes, 4, 128 * GIB, 'maxBytes'); integer(timeoutMs, 1, 3_600_000, 'timeoutMs');
  let stage = 'prepare', bytes = 0, expectedBytes = null, bounded, cleanupFailed = false;
  let primaryFatal, primaryDiagnostic;
  const snapshot = error => Object.freeze({ stage, receivedBytes: bytes, maximumBytes: maxBytes,
    expectedBytes, causeCode: safeDownloadCauseCode(error) });
  try {
    const directory = await realpath(path.dirname(destination));
    destination = path.join(directory, path.basename(destination));
    const info = await lstat(directory);
    if (!info.isDirectory() || process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || process.getuid && info.uid !== process.getuid())) {
      throw failure('local_download_directory_unsafe', 'Choose an existing model directory owned by you and protected from other users writing it.');
    }
    try { await lstat(destination); throw failure('local_download_exists', 'The destination already exists. Preserve it or choose a new model filename.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const partial = path.join(directory, `.koto-${randomUUID()}.gguf.partial`);
    let file, response, prefix = Buffer.alloc(0);
    const hash = createHash('sha256');
    try {
      file = await open(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      stage = 'headers';
      for (let redirects = 0; ; redirects += 1) {
        response = await fetchHeaders(source, { signal: bounded, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects >= 5) throw failure('local_download_redirect', 'The model URL exceeded its redirect limit.');
        source = new URL(location, source);
        if (source.protocol !== 'https:' || source.username || source.password) throw failure('local_download_redirect', 'Model redirects must retain HTTPS without embedded credentials.');
      }
      const length = response.headers.get('content-length');
      const announced = Number(length);
      if (length !== null && /^\d+$/.test(length.trim()) && Number.isSafeInteger(announced) && announced >= 0) expectedBytes = announced;
      if (!response.ok || !response.body) throw failure('local_download_failed', `The model source returned HTTP ${response.status}.`);
      if (announced > maxBytes) throw failure('local_download_byte_limit', 'The model exceeds the selected download byte limit.');
      stage = 'body';
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw failure('local_download_byte_limit', 'The model exceeded the selected download byte limit.');
        if (prefix.length < 4) prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
        hash.update(chunk);
        stage = 'write';
        let offset = 0;
        while (offset < chunk.length) {
          bounded.throwIfAborted();
          const written = (await file.write(chunk, offset, chunk.length - offset)).bytesWritten;
          if (!written) throw failure('local_download_write_failed', 'The model file could not be written completely.');
          offset += written;
        }
        stage = 'progress';
        await progress(onProgress, { type: 'download', bytes, ...(announced > 0 ? { totalBytes: announced } : {}) }, bounded);
        stage = 'body';
      }
      stage = 'verify';
      if (prefix.toString('ascii') !== 'GGUF' || hash.digest('hex') !== sha256.toLowerCase()) {
        throw failure('local_download_integrity', 'The downloaded file did not match its GGUF header and selected SHA-256 digest.');
      }
      stage = 'write';
      await file.sync(); await file.close(); file = undefined;
      stage = 'publish';
      bounded.throwIfAborted();
      await link(partial, destination); // Atomic no-replace publication in the same directory.
      return { path: destination, bytes, sha256: sha256.toLowerCase(), source: source.href };
    } catch (error) {
      const diagnostic = snapshot(error);
      primaryDiagnostic = diagnostic;
      try { throwOnResourceExhaustion(error); }
      catch (fatal) {
        primaryFatal = fatal;
      }
      throw error;
    } finally {
      await response?.body?.cancel().catch(() => {});
      try { await file?.close(); }
      catch (error) { stage = 'write'; cleanupFailed = true; throw error; }
      try { await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      catch (error) { stage = 'write'; cleanupFailed = true; throw error; }
    }
  } catch (error) {
    const escapingDiagnostic = snapshot(error);
    const downloadDiagnostic = primaryDiagnostic ?? escapingDiagnostic;
    const diagnostics = { downloadDiagnostic,
      ...(primaryDiagnostic && cleanupFailed ? { downloadCleanupDiagnostic: escapingDiagnostic } : {}) };
    const detail = ` Download diagnostic: stage=${downloadDiagnostic.stage}, receivedBytes=${downloadDiagnostic.receivedBytes}, expectedBytes=${downloadDiagnostic.expectedBytes ?? 'unknown'}, maximumBytes=${downloadDiagnostic.maximumBytes}, causeCode=${downloadDiagnostic.causeCode ?? 'unknown'}.`;
    const annotate = (value, appendDetail = false) => {
      try {
        if (appendDetail) value.message += detail;
        return Object.assign(value, diagnostics);
      }
      catch { return Object.assign(failure(value?.code ?? 'local_download_failed', `The model download failed.${detail}`), diagnostics); }
    };
    let escapingFatal;
    try { throwOnResourceExhaustion(error); }
    catch (fatal) { escapingFatal = fatal; }
    if (escapingFatal?.code?.endsWith('cleanup_unconfirmed')) throw annotate(escapingFatal);
    if (primaryFatal) throw annotate(primaryFatal);
    if (escapingFatal) throw annotate(escapingFatal);
    if (typeof error?.code === 'string' && error.code.startsWith('local_')) {
      throw annotate(error, error.code === 'local_download_failed');
    }
    if (bounded?.aborted && !cleanupFailed) throw annotate(failure('local_download_cancelled', `The model download was cancelled or reached its deadline. The incomplete Koto download was removed.${detail}`));
    throw annotate(failure('local_download_failed', `The HTTPS model download or file operation failed. Existing model files were preserved.${detail}`));
  }
}
