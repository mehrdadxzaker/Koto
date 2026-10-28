import { ownedProcessErrorCode, startOwnedPipe } from './owned-worker-lifetime.js';
import { StringDecoder } from 'node:string_decoder';

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const EVENT_CHUNK_BYTES = 16 * 1024;
// UTF-8 replacement characters can expand malformed native bytes. Limiting
// decoded chunks by code units bounds each event below 16 KiB as UTF-8 too.
const EVENT_TEXT_UNITS = 4096;
const MAX_PENDING_EVENTS = 64;
const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_QUEUED_CONTROL_BYTES = 256 * 1024;
const validString = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0');

/** Start one explicitly configured native command over pipes, without a shell.
 * This preserves the command's own permissions and protocol; it provides no PTY,
 * provider parsing or containment of descendants that leave the owned group.
 * An explicit env replaces the inherited environment, as in child_process.spawn.
 */
export function startCommand({ id, command, args = [], cwd, env, timeoutMs = 900_000,
  onEvent, signal } = {}) {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)
    || !validString(command) || Buffer.byteLength(command) > 4096
    || /\.(?:cmd|bat)$/i.test(command)
    || !Array.isArray(args) || args.length > 128
    || args.some((value) => typeof value !== 'string' || value.includes('\0')
      || Buffer.byteLength(value) > 16_384)
    || (cwd !== undefined && !validString(cwd))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000
    || (onEvent !== undefined && typeof onEvent !== 'function')
    || (signal !== undefined && !(signal instanceof AbortSignal))
    || (env !== undefined && (!env || typeof env !== 'object' || Array.isArray(env)
      || Object.entries(env).some(([key, value]) => !validString(key)
        || typeof value !== 'string' || value.includes('\0'))))) {
    throw new TypeError('Invalid command session configuration');
  }

  let pendingControls = 0;
  let inputEnded = false;
  let outputBytes = 0;
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  const owner = startOwnedPipe({
    command, args: [...args], cwd, env, timeoutMs, signal, onEvent,
    onSpawn(pid) { owner.lifetime.emit({ type: 'started', agentId: id, pid }); },
    onOutput(stream, chunk) {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) { owner.lifetime.fail('output_limit'); return; }
      for (let offset = 0; offset < chunk.length; offset += EVENT_CHUNK_BYTES) {
        const text = decoders[stream].write(chunk.subarray(offset, offset + EVENT_CHUNK_BYTES));
        for (let start = 0; start < text.length;) {
          let end = Math.min(start + EVENT_TEXT_UNITS, text.length);
          // Keep a Unicode pair in one event, so callers can write its text
          // directly without corrupting a character across events.
          if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
          owner.lifetime.emit({ type: 'output', agentId: id, stream, text: text.slice(start, end) });
          start = end;
          if (owner.lifetime.failure || owner.lifetime.cancelled || owner.lifetime.finished) break;
        }
        if (owner.lifetime.failure || owner.lifetime.cancelled || owner.lifetime.finished) break;
      }
    },
    onClose() {
      if (!owner.lifetime.failure && !owner.lifetime.cancelled) {
        for (const stream of ['stdout', 'stderr']) {
          const text = decoders[stream].end();
          if (text) owner.lifetime.emit({ type: 'output', agentId: id, stream, text });
        }
      }
    },
  });
  const writable = () => !owner.lifetime.finished && !owner.lifetime.stopping
    && !inputEnded && owner.child && !owner.child.stdin.destroyed
    && !owner.child.stdin.writableEnded && owner.child.stdin.writable;
  return {
    id,
    get pid() { return owner.child?.pid ?? null; },
    completion: owner.lifetime.completion,
    send(text) {
      if (!writable() || typeof text !== 'string') return false;
      const bytes = Buffer.byteLength(text);
      if (bytes === 0) return true;
      if (bytes > MAX_CONTROL_BYTES || pendingControls >= MAX_PENDING_EVENTS
        || owner.child.stdin.writableLength + bytes > MAX_QUEUED_CONTROL_BYTES) return false;
      try {
        // write(false) still accepts bytes; writableLength bounds the queue.
        pendingControls += 1;
        owner.child.stdin.write(text, error => {
          pendingControls -= 1;
          if (error) owner.lifetime.fail(ownedProcessErrorCode(error, 'stdin_failed'));
        });
        return true;
      } catch (error) { pendingControls -= 1; owner.lifetime.fail(ownedProcessErrorCode(error, 'stdin_failed')); return false; }
    },
    endInput() {
      if (!writable()) return false;
      inputEnded = true;
      try {
        owner.child.stdin.end(error => { if (error) owner.lifetime.fail(ownedProcessErrorCode(error, 'stdin_failed')); });
        return true;
      } catch (error) { owner.lifetime.fail(ownedProcessErrorCode(error, 'stdin_failed')); return false; }
    },
    stop: () => owner.lifetime.cancel(),
  };
}
