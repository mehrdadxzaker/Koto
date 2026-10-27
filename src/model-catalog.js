import { freemem, totalmem } from 'node:os';
import { constants } from 'node:fs';
import { lstat, open, readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { defaultStateDirectory } from './preferences.js';
import { discoverLocalModels } from './local-models.js';

const GIB = 1024 ** 3;

/** Curated compatible options, not quality, latency or memory guarantees.
 * Exact publisher download sizes/digests are resolved only after selection.
 */
export const localModelCatalog = Object.freeze([
  { id: 'qwen3-4b', name: 'Qwen3 4B', ggufQuantization: 'Q4_K_M', ollamaModel: 'qwen3:4b',
    publisher: 'Qwen/Qwen3-4B-GGUF', parameters: '4B', downloadEstimateBytes: 3 * GIB,
    minimumMemoryBytes: 8 * GIB, recommendedMemoryBytes: 16 * GIB, estimatedWorkingBytes: 5 * GIB },
  { id: 'qwen3-8b', name: 'Qwen3 8B', ggufQuantization: 'Q4_K_M', ollamaModel: 'qwen3:8b',
    publisher: 'Qwen/Qwen3-8B-GGUF', parameters: '8B', downloadEstimateBytes: 6 * GIB,
    minimumMemoryBytes: 16 * GIB, recommendedMemoryBytes: 24 * GIB, estimatedWorkingBytes: 9 * GIB },
  { id: 'qwen3-14b', name: 'Qwen3 14B', ggufQuantization: 'Q4_K_M', ollamaModel: 'qwen3:14b',
    publisher: 'Qwen/Qwen3-14B-GGUF', parameters: '14B', downloadEstimateBytes: 10 * GIB,
    minimumMemoryBytes: 24 * GIB, recommendedMemoryBytes: 32 * GIB, estimatedWorkingBytes: 14 * GIB },
].map(record => Object.freeze(record)));

/** Inspect space at the nearest existing ancestor without creating directories. */
export async function localStorageCapacity(directory = defaultStateDirectory) {
  let current = path.resolve(directory);
  for (;;) {
    try {
      const info = await statfs(current, { bigint: true });
      const available = info.bavail * info.bsize;
      return available <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(available) : Number.MAX_SAFE_INTEGER;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return undefined;
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

/** Read only Koto's bounded receipts. Startup rehashes a retained GGUF before use. */
export async function listRetainedLocalModels(directory = defaultStateDirectory) {
  const modelsDirectory = path.join(path.resolve(directory), 'models');
  let entries;
  try { entries = await readdir(modelsDirectory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (entries.length > 10_000) throw new Error('The model directory contains too many entries to inspect.');
  const records = [];
  for (const entry of entries.filter(value => /^[0-9a-f]{64}\.json$/.test(value))) {
    let file;
    try {
      file = await open(path.join(modelsDirectory, entry), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await file.stat();
      if (!info.isFile() || info.size > 16 * 1024) continue;
      const buffer = Buffer.alloc(16 * 1024 + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16 * 1024) continue;
      const item = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      const choice = localModelCatalog.find(model => model.id === item.choiceId);
      if (!choice || item.kind !== 'koto-publisher-gguf' || item.schemaVersion !== 1
        || item.publisher !== choice.publisher || !/^[0-9a-f]{40}$/.test(item.revision)
        || !/^[0-9a-f]{64}$/.test(item.sha256) || entry !== `${item.sha256}.json`
        || !/^[A-Za-z0-9._-]+\.gguf$/i.test(item.filename)
        || !Number.isSafeInteger(item.bytes) || item.bytes < 4 || item.bytes > 128 * GIB) continue;
      const filename = path.join(modelsDirectory, `${item.sha256.slice(0, 16)}-${item.filename}`);
      const url = `https://huggingface.co/${choice.publisher}/resolve/${item.revision}/${encodeURIComponent(item.filename)}`;
      if (item.path !== filename || item.url !== url) continue;
      const modelInfo = await lstat(filename);
      if (!modelInfo.isFile() || modelInfo.isSymbolicLink() || modelInfo.size !== item.bytes) continue;
      records.push({ choiceId: choice.id, publisher: choice.publisher, revision: item.revision,
        filename: item.filename, sha256: item.sha256, bytes: item.bytes, url, path: filename });
    } catch (error) {
      if (['EACCES', 'EPERM'].includes(error.code)) throw error;
      // An incomplete, changed or unrelated receipt is not an installed asset.
    } finally { await file?.close(); }
  }
  return records;
}

/** Metadata only: does not start a runtime, download weights or request inference. */
export async function inspectLocalModelSetup({ directory = defaultStateDirectory,
  ollamaCommand = 'ollama', llamaCommand = 'llama-server', signal } = {}) {
  const [runtimes, diskAvailableBytes, retainedModels] = await Promise.all([
    discoverLocalModels({ ollamaCommand, llamaCommand, signal }), localStorageCapacity(directory), listRetainedLocalModels(directory),
  ]);
  const memoryBytes = totalmem(), freeMemoryBytes = freemem();
  const choices = localModelCatalog.map(model => ({ ...model,
    retained: retainedModels.filter(item => item.choiceId === model.id),
    suitability: memoryBytes < model.minimumMemoryBytes ? 'insufficient_memory'
      : freeMemoryBytes < model.estimatedWorkingBytes + GIB ? 'close_other_apps'
        : memoryBytes < model.recommendedMemoryBytes ? 'limited_headroom' : 'suggested',
    storage: diskAvailableBytes === undefined ? 'unknown'
      : diskAvailableBytes < model.downloadEstimateBytes + 2 * GIB ? 'insufficient_space' : 'available',
    installed: Object.values(runtimes).flatMap(runtime => runtime.models
      .filter(item => item.id === model.ollamaModel || item.id.toLowerCase().replace(/[^a-z0-9]/g, '').includes(model.id.replaceAll('-', '')))
      .map(item => ({ ...item, kind: runtime.kind, endpoint: runtime.apiBaseUrl }))),
  }));
  return { machine: { platform: process.platform, arch: process.arch, memoryBytes, freeMemoryBytes,
    ...(diskAvailableBytes === undefined ? {} : { diskAvailableBytes }) }, runtimes, choices, retainedModels,
    estimates: 'Download and working-memory figures are approximate guidance for one 8K-context model. Other apps, runtime overhead and native model settings affect fit; no performance or quality guarantee.',
    optional: true,
    ollamaInstall: { url: 'https://ollama.com/download',
      message: 'Install or open the official native Ollama app, then retry discovery. Koto does not run an unattended shell installer.' },
  };
}
