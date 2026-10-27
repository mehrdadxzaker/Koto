import { freemem, totalmem } from 'node:os';
import { startSetupCommand } from './setup-command.js';
import { throwOnResourceExhaustion } from './bounded-fetch.js';
import { readLinuxMemoryCapacity, readLinuxMemorySnapshot } from './linux-memory.js';

const LIMIT = 4096;
const fail = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });
const unavailable = cause => fail('local_memory_metrics_unavailable',
  'Host available-memory metrics could not be read safely. No raw-free-memory fallback was used; retry after checking the host memory query.', cause);
const cleanupFailure = () => fail('local_memory_cleanup_unconfirmed',
  'Cleanup of the owned memory-query process could not be confirmed. Inspect it before starting another local model.');

/** Synchronous catalog/admission capacity. Linux includes visible cgroup hard
 * limits; other platforms retain their ordinary physical-capacity metric.
 */
export function effectiveMemoryCapacity() {
  const physicalTotalBytes = totalmem();
  if (!Number.isSafeInteger(physicalTotalBytes) || physicalTotalBytes <= 0) throw unavailable();
  return process.platform === 'linux' ? readLinuxMemoryCapacity(physicalTotalBytes) : physicalTotalBytes;
}

/** macOS raw free pages exclude reclaimable memory, so use its read-only
 * system-wide memory-pressure query while retaining the raw metric separately.
 * The same reserve can then be applied to the host's available-memory metric.
 */
export async function readHostMemory({ signal } = {}) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal.');
  if (signal?.aborted) throw unavailable(signal.reason);
  const totalBytes = totalmem(), rawFreeBytes = freemem();
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || !Number.isSafeInteger(rawFreeBytes)
    || rawFreeBytes < 0 || rawFreeBytes > totalBytes) throw unavailable();
  if (process.platform === 'linux') return readLinuxMemorySnapshot(totalBytes, rawFreeBytes);
  if (process.platform !== 'darwin') return { totalBytes, rawFreeBytes, availableBytes: rawFreeBytes, source: 'os-freemem' };

  const controller = new AbortController();
  let handle, stdout = '', bytes = 0, exceeded = false;
  try {
    handle = await startSetupCommand({ id: 'hostMemory', command: '/usr/bin/memory_pressure', args: ['-Q'],
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' }, timeoutMs: 2000,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      onEvent(event) {
        if (event.type !== 'output' || exceeded) return;
        bytes += Buffer.byteLength(event.text);
        if (bytes > LIMIT) { exceeded = true; controller.abort(); return; }
        if (event.stream === 'stdout') stdout += event.text;
      } });
    handle.endInput();
    const outcome = await handle.completion;
    if (outcome.error === 'cleanup_unconfirmed') throw cleanupFailure();
    throwOnResourceExhaustion({ code: outcome.error });
    if (outcome.status !== 'succeeded' || exceeded || signal?.aborted) throw unavailable();
    const matches = [...stdout.matchAll(/^System-wide memory free percentage: ([0-9]{1,3})%\r?$/gm)];
    if (matches.length !== 1) throw unavailable();
    const percentage = Number(matches[0][1]);
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw unavailable();
    return { totalBytes, rawFreeBytes, availableBytes: Math.floor(totalBytes * percentage / 100), source: 'macos-memory-pressure' };
  } catch (error) {
    if (['local_memory_metrics_unavailable', 'local_memory_cleanup_unconfirmed'].includes(error.code)) throw error;
    throwOnResourceExhaustion(error);
    throw unavailable(error);
  } finally {
    if (handle) {
      handle.stop();
      if ((await handle.completion).error === 'cleanup_unconfirmed') throw cleanupFailure();
    }
  }
}
