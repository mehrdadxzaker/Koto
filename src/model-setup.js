import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, writeFile } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import path from 'node:path';
import { defaultStateDirectory } from './preferences.js';
import { resolveAgentExecutable } from './launch-preflight.js';
import { discoverLocalModels, downloadGguf, pullOllamaModel, startLlamaServer } from './local-models.js';
import { buildLlamaRuntime } from './runtime-install.js';
import { localModelCatalog, localStorageCapacity, listRetainedLocalModels } from './model-catalog.js';

const GIB = 1024 ** 3;
export const guidedLlamaCommit = '14310190cd0a0c831fe949ac8cbedd8abdc90695';
const fail = (code, message) => Object.assign(new Error(message), { code });
const cancelled = () => fail('local_setup_cancelled', 'Local-model setup was skipped or cancelled. Existing native assets were preserved.');

async function approveAction(approve, action, signal) {
  signal?.throwIfAborted();
  if (typeof approve !== 'function' || await approve(Object.freeze(action)) !== true) throw cancelled();
  signal?.throwIfAborted();
}

async function storageDirectory(selected) {
  if (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.includes('\0')) {
    throw fail('local_setup_directory_invalid', 'Local-model storage needs an absolute private directory.');
  }
  const directory = path.resolve(selected);
  let current = path.parse(directory).root;
  for (const piece of directory.split(path.sep).filter(Boolean)) {
    current = path.join(current, piece);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    const stickyAncestor = current !== directory && (info.mode & 0o1000) !== 0;
    let gitEntry, gitHead;
    try { gitEntry = await lstat(path.join(current, '.git')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (gitEntry?.isDirectory()) {
      try { gitHead = await lstat(path.join(current, '.git', 'HEAD')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!info.isDirectory() || info.isSymbolicLink() || gitEntry && (!gitEntry.isDirectory() || gitHead)
      || process.platform !== 'win32' && ((info.mode & 0o022) !== 0 && !stickyAncestor
        || process.getuid && info.uid !== process.getuid() && info.uid !== 0)) {
      throw fail('local_setup_directory_unsafe', 'Model storage must remain outside Git worktrees in real directories protected from other users writing them.');
    }
  }
  const info = await lstat(directory);
  if (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || process.getuid && info.uid !== process.getuid())
    || await realpath(directory) !== directory) {
    throw fail('local_setup_directory_unsafe', 'Choose a private model directory owned by your account (mode 700).');
  }
  return directory;
}

async function requireSpace(directory, bytes) {
  const available = await localStorageCapacity(directory);
  if (available === undefined) throw fail('local_setup_space_unknown', 'Free storage could not be measured. Choose a local disk with readable capacity information.');
  if (available < bytes + GIB) throw fail('local_setup_space_low', 'There is not enough free storage for this download and a 1 GiB reserve. Choose a smaller model or free disk space.');
}

/** Resolve one official publisher file to an immutable commit and its LFS SHA-256.
 * This is an explicit setup step; discovery never contacts the publisher.
 */
export async function resolveCatalogGguf({ choiceId, signal } = {}) {
  const choice = localModelCatalog.find(item => item.id === choiceId);
  if (!choice) throw fail('local_setup_choice_invalid', 'Choose one of the displayed local models.');
  const endpoint = `https://huggingface.co/api/models/${choice.publisher}/revision/main?blobs=true`;
  const bounded = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  let response;
  try {
    response = await fetch(endpoint, { redirect: 'error', signal: bounded });
    if (!response.ok || !response.body) throw fail('local_publisher_unavailable', `The official model metadata returned HTTP ${response.status}. No alternate source was tried.`);
    const chunks = []; let metadataBytes = 0;
    for await (const chunk of response.body) {
      metadataBytes += chunk.length;
      if (metadataBytes > 4 * 1024 ** 2) throw fail('local_publisher_metadata_invalid', 'Publisher model metadata exceeded its bounded size.');
      chunks.push(chunk);
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail('local_publisher_metadata_invalid', 'The publisher did not return valid model metadata.'); }
    if (data?.id !== choice.publisher || !/^[0-9a-f]{40}$/i.test(data.sha) || !Array.isArray(data.siblings)) {
      throw fail('local_publisher_metadata_invalid', 'The model metadata did not identify the expected publisher and immutable source revision.');
    }
    const files = data.siblings.filter(item => typeof item?.rfilename === 'string'
      && /^[A-Za-z0-9._-]+\.gguf$/i.test(item.rfilename) && /(?:^|[-_.])Q4_K_M\.gguf$/i.test(item.rfilename));
    if (files.length !== 1) throw fail('local_publisher_model_unavailable', 'The official repository did not identify one complete Q4_K_M GGUF file. Split or ambiguous downloads need the advanced model command.');
    const file = files[0], sha256 = file.lfs?.sha256, bytes = file.lfs?.size ?? file.size;
    if (!/^[0-9a-f]{64}$/i.test(sha256 ?? '') || !Number.isSafeInteger(bytes) || bytes < 4 || bytes > 128 * GIB) {
      throw fail('local_publisher_digest_unavailable', 'The publisher did not provide a SHA-256 digest and bounded file size. No unverified model was downloaded.');
    }
    return Object.freeze({ choiceId, publisher: choice.publisher, revision: data.sha.toLowerCase(),
      filename: file.rfilename, sha256: sha256.toLowerCase(), bytes,
      url: `https://huggingface.co/${choice.publisher}/resolve/${data.sha}/${encodeURIComponent(file.rfilename)}` });
  } catch (error) {
    if (error.code?.startsWith('local_')) throw error;
    if (bounded.aborted) throw fail('local_publisher_cancelled', 'Model metadata retrieval was cancelled or timed out.');
    throw fail('local_publisher_unavailable', 'Official model metadata is unavailable. No alternate source was tried; skip local setup or retry later.');
  } finally { await response?.body?.cancel().catch(() => {}); }
}

async function reuseModel(filename, model, signal) {
  let file;
  try { file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== model.bytes) throw fail('local_setup_existing_model_changed', 'An existing model occupies this versioned filename but has a different size. It was preserved.');
    const hash = createHash('sha256'); let prefix = Buffer.alloc(0);
    for await (const chunk of file.createReadStream({ autoClose: false, signal })) {
      if (prefix.length < 4) prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
      hash.update(chunk);
    }
    const after = await file.stat();
    if (prefix.toString('ascii') !== 'GGUF' || hash.digest('hex') !== model.sha256
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw fail('local_setup_existing_model_changed', 'The retained model does not match its official digest. It was preserved; no overwrite or alternate model was attempted.');
    }
    return true;
  } finally { await file.close(); }
}

async function saveReceipt(directory, receipt) {
  const filename = path.join(directory, `${receipt.sha256}.json`);
  const temporary = path.join(directory, `.model-${randomUUID()}.json`);
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename);
}

/** Guided, explicit asset acquisition. Caller owns a returned llama server and must stop it.
 * Every executable build, download and startup has its own concrete approval.
 * No model inference is requested here; ready means runtime health/model metadata only.
 */
export async function setupLocalModel({ choiceId, route = 'ollama', directory = defaultStateDirectory,
  ollamaCommand = 'ollama', llamaCommand = 'llama-server', approve, onProgress, signal,
  start = true } = {}) {
  const choice = localModelCatalog.find(item => item.id === choiceId);
  if (!choice || !['ollama', 'llama'].includes(route)) throw fail('local_setup_choice_invalid', 'Choose one displayed model and Ollama or llama.cpp.');
  if (totalmem() < choice.minimumMemoryBytes) throw fail('local_setup_memory_low', 'This machine is below the displayed minimum-memory estimate. Choose a smaller model.');
  if (route === 'ollama') {
    const runtimes = await discoverLocalModels({ ollamaCommand, llamaCommand, signal });
    const runtime = runtimes.ollama;
    if (!runtime.executable || !runtime.reachable) {
      throw Object.assign(fail('local_setup_ollama_required', 'Install or open the official Ollama app at https://ollama.com/download, then retry. Setup did not start or install another service.'),
        { installUrl: 'https://ollama.com/download' });
    }
    const existing = runtime.models.find(item => item.id === choice.ollamaModel);
    if (existing) return { route, reused: true, model: existing.id, endpoint: runtime.apiBaseUrl,
      command: runtime.executable, inferenceVerified: false };
    await requireSpace(directory, choice.downloadEstimateBytes);
    await approveAction(approve, { action: 'pull-model', runtime: 'ollama', model: choice.ollamaModel,
      downloadEstimateBytes: choice.downloadEstimateBytes, source: 'https://ollama.com/library/qwen3',
      message: 'Native Ollama downloads and retains the model layers. The displayed size is an estimate; native pull reports actual progress.' }, signal);
    const installed = await pullOllamaModel({ model: choice.ollamaModel, command: runtime.executable,
      signal, onProgress });
    return { route, reused: false, model: installed.id, endpoint: installed.apiBaseUrl,
      command: installed.executable, inferenceVerified: false };
  }
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw fail('local_setup_llama_platform_unsupported', 'Guided llama.cpp source acquisition currently supports macOS and Linux. Use an installed, running Ollama runtime on this platform.');
  }
  const retained = (await listRetainedLocalModels(directory)).filter(item => item.choiceId === choiceId);
  // Prefer the previously approved pinned revision; changing upstream tags do not
  // silently replace retained weights or force a network check on returning users.
  const model = retained.at(-1) ?? await resolveCatalogGguf({ choiceId, signal });
  const modelDirectory = await storageDirectory(path.join(directory, 'models'));
  const filename = path.join(modelDirectory, `${model.sha256.slice(0, 16)}-${model.filename}`);
  let command, runtimeReceipt;
  try { command = await resolveAgentExecutable(llamaCommand); }
  catch {
    await requireSpace(directory, 2 * GIB);
    await approveAction(approve, { action: 'build-runtime', runtime: 'llama.cpp', commit: guidedLlamaCommit,
      source: 'https://github.com/ggml-org/llama.cpp',
      directory: path.join(directory, 'runtimes'),
      message: 'Compile the official pinned source using your installed Git, CMake and C/C++ toolchain. This can take several minutes; Koto does not install compilers.' }, signal);
    runtimeReceipt = await buildLlamaRuntime({ commit: guidedLlamaCommit, installDirectory: path.join(directory, 'runtimes'),
      approveBuild: true, signal, onEvent: onProgress });
    command = runtimeReceipt.path;
  }
  const reused = await reuseModel(filename, model, signal);
  if (!reused) {
    await requireSpace(modelDirectory, model.bytes);
    await approveAction(approve, { action: 'download-model', model: choice.name,
      source: model.url, sha256: model.sha256, downloadBytes: model.bytes, destination: filename,
      message: 'Download the official publisher file at its immutable revision and verify its SHA-256 before use.' }, signal);
    await downloadGguf({ url: model.url, destination: filename, sha256: model.sha256,
      maxBytes: model.bytes, signal, onProgress });
  }
  await saveReceipt(modelDirectory, { schemaVersion: 1, kind: 'koto-publisher-gguf', ...model,
    path: filename, acquiredAt: new Date().toISOString() });
  const result = { route, reused, modelPath: filename, command, publisher: model.publisher,
    sha256: model.sha256, ...(runtimeReceipt ? { runtimeReceipt } : {}), inferenceVerified: false };
  if (!start) return result;
  if (freemem() < choice.estimatedWorkingBytes + GIB) {
    throw fail('local_setup_memory_busy', 'The assets are retained, but available memory is below the displayed working estimate plus reserve. Close other apps, then start the retained model.');
  }
  const modelId = `local-${choice.id}-q4_k_m`;
  await approveAction(approve, { action: 'start-runtime', runtime: 'llama.cpp', model: choice.name,
    modelPath: filename, command, endpoint: 'http://127.0.0.1:18089/v1', contextSize: 8192,
    message: 'Start one owned CPU-only local server with a memory guard. Quit stops this owned server. This does not request model inference.' }, signal);
  const server = await startLlamaServer({ command, modelPath: filename, modelId, signal, onEvent: onProgress });
  const metadata = await server.ready;
  // Verify the selected alias from actual metadata rather than assuming startup succeeded.
  if (!metadata.models.some(item => item.id === modelId)) {
    const stopped = await server.stop();
    throw fail(stopped.error === 'cleanup_unconfirmed' ? 'local_setup_cleanup_unconfirmed' : 'local_setup_model_not_listed',
      'The owned server did not list the selected model alias. Inspect its native output before retrying.');
  }
  return { ...result, model: modelId, endpoint: server.apiBaseUrl, server };
}
