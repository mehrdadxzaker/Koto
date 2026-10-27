const RESOURCE_CODES = new Set(['EADDRNOTAVAIL', 'EMFILE', 'ENFILE']);
const DOWNLOAD_CAUSE_CODES = new Set([
  ...RESOURCE_CODES,
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN',
  'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ENOBUFS',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_ABORTED', 'UND_ERR_DESTROYED', 'UND_ERR_CLOSED',
  'UND_ERR_CONTENT_LENGTH_MISMATCH', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ENOSPC', 'EDQUOT', 'EIO', 'EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR',
  'EISDIR', 'EEXIST', 'ENAMETOOLONG', 'EBUSY', 'ELOOP',
]);

function* boundedErrorGraph(error) {
  const pending = [error], seen = new Set();
  for (let index = 0; index < pending.length && index < 8; index += 1) {
    const current = pending[index];
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    yield current;
    if (current.cause && pending.length < 8) pending.push(current.cause);
    if (Array.isArray(current.errors)) {
      for (let offset = 0; offset < current.errors.length && pending.length < 8; offset += 1) pending.push(current.errors[offset]);
    }
  }
}

/** Return only a fixed local cause code from at most eight error nodes. */
export function safeDownloadCauseCode(error) {
  let first = null;
  try {
    for (const current of boundedErrorGraph(error)) {
      for (const candidate of [current.resourceCode, current.code]) {
        if (RESOURCE_CODES.has(candidate)) return candidate;
        if (first === null && DOWNLOAD_CAUSE_CODES.has(candidate)) first = candidate;
      }
    }
  } catch { /* An opaque error property must not replace the download failure. */ }
  return first;
}

/** Keep finite host-resource failures fatal through setup recovery wrappers.
 * Inspect only a bounded error graph and retain a fixed code, never URLs or
 * server-provided diagnostics from nested errors.
 */
export function throwOnResourceExhaustion(error, code = 'local_socket_exhausted') {
  const message = 'Socket or file-descriptor capacity is unavailable. Stop new requests and inspect system resources before retrying.';
  if (typeof error?.code === 'string' && error.code.endsWith('cleanup_unconfirmed')) throw error;
  if (typeof error?.code === 'string' && error.code.endsWith('_socket_exhausted')) {
    throw error instanceof Error ? error : Object.assign(new Error(message), { code: error.code });
  }
  for (const current of boundedErrorGraph(error)) {
    if (RESOURCE_CODES.has(current.code)) {
      throw Object.assign(new Error(message),
        { code, resourceCode: current.code });
    }
  }
}

/** Bound connection/response headers separately from the caller's whole-transfer
 * deadline. Clearing this timer after headers lets a selected large download
 * finish under its own deadline without adding retries or another HTTP client.
 */
export async function fetchHeaders(url, { signal, headerTimeoutMs = 15_000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('Response headers timed out.'),
    { code: 'ETIMEDOUT' })), headerTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: signal
      ? AbortSignal.any([signal, controller.signal]) : controller.signal });
  } finally { clearTimeout(timer); }
}
