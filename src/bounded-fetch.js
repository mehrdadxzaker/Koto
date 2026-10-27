/** Bound connection/response headers separately from the caller's whole-transfer
 * deadline. Clearing this timer after headers lets a selected large download
 * finish under its own deadline without adding retries or another HTTP client.
 */
export async function fetchHeaders(url, { signal, headerTimeoutMs = 15_000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Response headers timed out.')), headerTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: signal
      ? AbortSignal.any([signal, controller.signal]) : controller.signal });
  } finally { clearTimeout(timer); }
}
