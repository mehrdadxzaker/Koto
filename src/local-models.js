import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { freemem, totalmem } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startCommand } from './command-session.js';
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
  catch { throw failure('local_endpoint_unavailable', 'The selected local server is unavailable. Start the installed runtime, then retry; Koto did not install or start it automatically.'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(response.status === 503 ? 'local_model_loading' : 'local_endpoint_failed',
      response.status === 503 ? 'The selected local server is still loading its model.' : `The selected local server returned HTTP ${response.status}.`);
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
  return Object.fromEntries(await Promise.all([
    ['ollama', ollamaCommand, ollamaEndpoint], ['llama', llamaCommand, llamaEndpoint],
  ].map(async ([kind, command, selectedEndpoint]) => {
    const endpoint = localEndpoint(selectedEndpoint);
    let executable;
    try { executable = await resolveAgentExecutable(command); } catch { /* Discovery reports missing tools. */ }
    try { return [kind, { executable, ...(await checkLocalEndpoint({ kind, endpoint, signal })), reachable: true }]; }
    catch (error) { return [kind, { kind, executable, endpoint, apiBaseUrl: `${endpoint}/v1`, reachable: false,
      models: [], error: error.code, message: error.message }]; }
  })));
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
    probe.once('error', () => reject(failure('local_port_unavailable', 'The selected loopback port is occupied or unavailable. Choose another port; Koto will not stop an existing server.')));
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
  const processInfo = startCommand({ id: 'llamaMemory', command: '/bin/ps', args: ['-o', 'rss=', '-p', String(pid)],
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
  if (result.status !== 'succeeded' || exceeded || !/^\s*\d+\s*$/.test(text)) {
    throw failure('local_memory_metrics_unavailable', 'The owned server resident-memory metric could not be read safely.');
  }
  return Number(text.trim()) * 1024;
}

/** Start only an explicit existing GGUF/binary. The returned owner must remain alive.
 * Memory bounds are sampled process RSS and host free memory, not an OS quota or GPU accounting.
 */
export async function startLlamaServer({ modelPath, command = 'llama-server', port = 18089, contextSize = 8192,
  memoryLimitBytes = Math.min(16 * GIB, Math.floor(totalmem() * 0.7)), minimumFreeBytes = GIB,
  gpuLayers = 0, modelId = `koto-local-${randomUUID().slice(0, 8)}`, startupTimeoutMs = 120_000,
  timeoutMs = 1_800_000, signal, onEvent } = {}) {
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw failure('local_memory_guard_unsupported', 'Owned llama-server startup currently requires macOS or Linux memory metrics. Use an already-running local server on this platform.');
  }
  integer(port, 1024, 65535, 'port'); integer(contextSize, 512, 32768, 'contextSize');
  integer(gpuLayers, 0, 1024, 'gpuLayers'); integer(startupTimeoutMs, 1, 600_000, 'startupTimeoutMs');
  integer(timeoutMs, startupTimeoutMs, 3_600_000, 'timeoutMs');
  integer(memoryLimitBytes, 256 * 1024 ** 2, Math.floor(totalmem() * 0.8), 'memoryLimitBytes');
  integer(minimumFreeBytes, 256 * 1024 ** 2, Math.floor(totalmem() * 0.5), 'minimumFreeBytes');
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
  const free = freemem();
  if (!Number.isSafeInteger(free) || free < minimumFreeBytes) {
    throw failure('local_memory_unavailable', 'Host free-memory metrics are unavailable or below the selected reserve. No server was started.');
  }
  if (signal?.aborted) throw failure('local_cancelled', 'Local server startup was cancelled.');
  await availablePort(port);
  const endpoint = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const joinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^LLAMA_ARG_/i.test(key)));
  const handle = startCommand({ id: 'llamaServer', command: executable, env, timeoutMs, signal: joinedSignal,
    args: ['--model', modelPath, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', String(contextSize),
      '--parallel', '1', '--alias', modelId, '--n-gpu-layers', String(gpuLayers), '--fit', 'off',
      '--offline', '--no-warmup', '--no-webui', '--jinja'], onEvent });
  handle.endInput();
  let finished = false, guarded = false, guardError, memory;
  const completion = handle.completion.then(async result => {
    finished = true;
    controller.abort();
    await memory;
    return guardError ? { ...result, status: 'failed',
      error: result.error === 'cleanup_unconfirmed' || guardError.code === 'local_memory_cleanup_unconfirmed'
        ? 'cleanup_unconfirmed' : guardError.code } : result;
  });
  memory = (async () => {
    while (!finished && !joinedSignal.aborted) {
      try {
        const rss = await residentBytes(handle.pid, joinedSignal);
        const available = freemem();
        if (!Number.isSafeInteger(rss) || rss < 0 || !Number.isSafeInteger(available) || available < 0) {
          throw failure('local_memory_metrics_unavailable', 'Memory monitoring became unavailable; the owned server was stopped.');
        }
        if (rss > memoryLimitBytes || available < minimumFreeBytes) {
          throw failure('local_memory_limit', 'The owned server exceeded its resident-memory budget or host free-memory reserve and was stopped.');
        }
        guarded = true;
        await delay(1000, undefined, { signal: joinedSignal });
      } catch (error) {
        if (error.code === 'local_memory_cleanup_unconfirmed') {
          guardError = error; controller.abort(); break;
        }
        if (finished || joinedSignal.aborted) break;
        guardError = error.code?.startsWith('local_') ? error : failure('local_memory_metrics_unavailable', 'Memory monitoring failed; the owned server was stopped.');
        controller.abort();
        break;
      }
    }
  })();
  const ready = (async () => {
    const deadline = Date.now() + startupTimeoutMs;
    while (!finished && !joinedSignal.aborted && Date.now() < deadline) {
      try {
        const metadata = await checkLocalEndpoint({ kind: 'llama', endpoint, signal: joinedSignal });
        if (!metadata.models.some(model => model.id === modelId)) {
          throw failure('local_server_identity_mismatch', 'The loopback endpoint did not advertise this owned server\'s model alias.');
        }
        if (guardError || joinedSignal.aborted || finished) break;
        if (guarded) return metadata;
      } catch (error) {
        if (error.code === 'local_server_identity_mismatch') { guardError = error; controller.abort(); break; }
        try { await delay(250, undefined, { signal: joinedSignal }); } catch { break; }
      }
    }
    if (!finished && !joinedSignal.aborted) {
      guardError = failure('local_server_start_timeout', 'The owned local model did not become ready before its startup deadline.');
      controller.abort();
    }
    const result = await completion;
    if (result.error === 'cleanup_unconfirmed') throw failure('local_server_cleanup_unconfirmed', 'Local server cleanup could not be confirmed. Inspect the owned process before retrying.');
    throw guardError ?? failure('local_server_not_ready', `The owned server stopped before readiness (${result.error ?? result.status}). Inspect its native output.`);
  })();
  ready.catch(() => {}); // An owner may await completion before checking readiness.
  return { endpoint, apiBaseUrl: `${endpoint}/v1`, modelId, modelPath, executable, pid: handle.pid,
    contextSize, memoryLimitBytes, minimumFreeBytes, gpuLayers, ready, completion,
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
  const directory = await realpath(path.dirname(destination));
  destination = path.join(directory, path.basename(destination));
  const info = await lstat(directory);
  if (!info.isDirectory() || process.platform !== 'win32' && ((info.mode & 0o022) !== 0 || process.getuid && info.uid !== process.getuid())) {
    throw failure('local_download_directory_unsafe', 'Choose an existing model directory owned by you and protected from other users writing it.');
  }
  try { await lstat(destination); throw failure('local_download_exists', 'The destination already exists. Preserve it or choose a new model filename.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  const partial = path.join(directory, `.koto-${randomUUID()}.gguf.partial`);
  let file, response, bytes = 0, prefix = Buffer.alloc(0);
  const hash = createHash('sha256');
  try {
    file = await open(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    for (let redirects = 0; ; redirects += 1) {
      response = await fetch(source, { signal: bounded, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects >= 5) throw failure('local_download_redirect', 'The model URL exceeded its redirect limit.');
      source = new URL(location, source);
      if (source.protocol !== 'https:' || source.username || source.password) throw failure('local_download_redirect', 'Model redirects must retain HTTPS without embedded credentials.');
    }
    if (!response.ok || !response.body) throw failure('local_download_failed', `The model source returned HTTP ${response.status}.`);
    const announced = Number(response.headers.get('content-length'));
    if (announced > maxBytes) throw failure('local_download_byte_limit', 'The model exceeds the selected download byte limit.');
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw failure('local_download_byte_limit', 'The model exceeded the selected download byte limit.');
      if (prefix.length < 4) prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        bounded.throwIfAborted();
        const written = (await file.write(chunk, offset, chunk.length - offset)).bytesWritten;
        if (!written) throw failure('local_download_write_failed', 'The model file could not be written completely.');
        offset += written;
      }
      await progress(onProgress, { type: 'download', bytes, ...(announced > 0 ? { totalBytes: announced } : {}) }, bounded);
    }
    if (prefix.toString('ascii') !== 'GGUF' || hash.digest('hex') !== sha256.toLowerCase()) {
      throw failure('local_download_integrity', 'The downloaded file did not match its GGUF header and selected SHA-256 digest.');
    }
    await file.sync(); await file.close(); file = undefined;
    bounded.throwIfAborted();
    await link(partial, destination); // Atomic no-replace publication in the same directory.
    return { path: destination, bytes, sha256: sha256.toLowerCase(), source: source.href };
  } catch (error) {
    if (error.code?.startsWith('local_')) throw error;
    if (bounded.aborted) throw failure('local_download_cancelled', 'The model download was cancelled or reached its deadline. The incomplete Koto download was removed.');
    throw failure('local_download_failed', 'The HTTPS model download or file write failed. The incomplete Koto download was removed; existing model files were preserved.');
  } finally {
    await response?.body?.cancel().catch(() => {});
    await file?.close();
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
