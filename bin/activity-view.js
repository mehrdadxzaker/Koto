import { stripVTControlCharacters } from 'node:util';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const WORKING = new Set(['starting', 'running', 'working']);
const STATES = new Set(['pending', 'idle', 'starting', 'running', 'working',
  'waiting', 'waiting_for_approval', 'blocked', 'succeeded', 'failed', 'cancelled']);
const ALIASES = { completed: 'succeeded', done: 'succeeded', error: 'failed',
  stopped: 'cancelled', waiting_approval: 'waiting_for_approval' };
const LABELS = { pending: 'pending', idle: 'ready', starting: 'starting',
  running: 'working', working: 'working', waiting: 'waiting',
  waiting_for_approval: 'approval needed', blocked: 'blocked',
  succeeded: 'finished', failed: 'failed', cancelled: 'stopped' };
const MAX_AGENTS = 32;
const MAX_QUEUED_BYTES = 64 * 1024;
const MAX_MESSAGE_UNITS = 32 * 1024;
const clean = (value, maximum = 512) => stripVTControlCharacters(String(value ?? ''))
  .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').trim().slice(0, maximum);

function status(value) {
  const normalized = ALIASES[value] ?? value;
  return STATES.has(normalized) ? normalized : undefined;
}

// Keep the last terminal column unused to prevent automatic line wrapping.
// Combining marks do not occupy a cell; common wide/emoji glyphs occupy two.
function clipped(text, columns) {
  let cells = 0;
  let result = '';
  for (const character of text) {
    const point = character.codePointAt(0);
    const width = /[\p{Mark}\p{Format}]/u.test(character) ? 0
      : /\p{Extended_Pictographic}/u.test(character)
        || point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a
          || point >= 0x2e80 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7a3
          || point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe6f
          || point >= 0xff00 && point <= 0xff60 || point >= 0xffe0 && point <= 0xffe6
          || point >= 0x20000 && point <= 0x3fffd) ? 2 : 1;
    if (cells + width > columns) return `${result}…`;
    result += character;
    cells += width;
  }
  return result;
}

/** Owns a small block immediately above the current cursor, not a full screen.
 * Route other output through message(), or pause() before writing/attaching a
 * PTY. For a live readline prompt, beforeRender must remove that prompt and
 * leave the cursor below this block; afterRender restores the prompt/input.
 * update() never prints assistant text: the caller decides whether a streamed
 * message has already been displayed, then calls message() once as appropriate.
 */
export function createActivityView({ write, stream = process.stdout,
  enabled = stream.isTTY === true, beforeRender, afterRender, onError } = {}) {
  if (typeof write !== 'function') throw new TypeError('Activity view requires a write function');
  for (const callback of [beforeRender, afterRender, onError]) {
    if (callback !== undefined && typeof callback !== 'function') throw new TypeError('Invalid activity view callback');
  }
  const interactive = enabled === true && stream.isTTY === true;
  const agents = new Map();
  const lastLines = new Map();
  const queue = [];
  let queuedBytes = 0;
  let omitted = false;
  let paused = false;
  let disposed = false;
  let drawnRows = 0;
  let frame = 0;
  let timer;

  function failed(error) {
    clearInterval(timer);
    timer = undefined;
    disposed = true;
    stream.removeListener?.('resize', render);
    try { onError?.(error); } catch { /* The caller owns session cancellation. */ }
  }
  function output(text) {
    if (disposed) return;
    try { write(text); } catch (error) { failed(error); }
  }
  function hook(callback) {
    try { callback?.(); return true; }
    catch (error) { failed(error); return false; }
  }
  function clearOwned() {
    if (!drawnRows) return;
    output(`\x1b[${drawnRows}A\r\x1b[J`);
    drawnRows = 0;
  }
  function row(agent) {
    const icon = agent.warning ? '!' : WORKING.has(agent.status) ? FRAMES[frame % FRAMES.length]
      : agent.status === 'succeeded' ? '✓' : agent.status === 'failed' ? '×'
        : agent.status === 'waiting_for_approval' || agent.status === 'blocked' ? '!'
          : agent.status === 'cancelled' ? '■' : '·';
    const name = agent.name === agent.id ? agent.id : `${agent.id}/${agent.name}`;
    return `${icon} ${name}${agent.model ? ` · ${agent.model}` : ''}  ${LABELS[agent.status]}${agent.activity || agent.task ? ` — ${agent.activity || agent.task}` : ''}`;
  }
  function paint() {
    const columns = Math.max(12, Math.min(500, Number.isInteger(stream.columns) ? stream.columns - 2 : 78));
    const capacity = Math.max(1, Math.min(12, Number.isInteger(stream.rows) ? stream.rows - 4 : 8));
    const all = [...agents.values()];
    // If space is tight, active workers take precedence over completed rows.
    if (all.length > capacity) all.sort((left, right) => Number(WORKING.has(right.status)) - Number(WORKING.has(left.status)));
    const visible = all.slice(0, all.length > capacity ? Math.max(0, capacity - 1) : capacity);
    const lines = visible.map(agent => clipped(row(agent), columns));
    if (visible.length < all.length) lines.push(clipped(`+ ${all.length - visible.length} other agent(s)`, columns));
    if (lines.length) output(`${lines.join('\n')}\n`);
    drawnRows = lines.length;
  }
  function flushMessages() {
    if (omitted) { output('[Koto] Some output queued while the view was paused was omitted.\n'); omitted = false; }
    for (const message of queue.splice(0)) output(message);
    queuedBytes = 0;
  }
  function render() {
    if (disposed || paused) return;
    if (!interactive) {
      flushMessages();
      for (const agent of agents.values()) {
        const line = row(agent).replace(/^[^ ]+ /, '');
        if (lastLines.get(agent.id) === line) continue;
        lastLines.set(agent.id, line);
        output(`[${line}]\n`);
      }
      return;
    }
    if (!hook(beforeRender)) return;
    clearOwned();
    flushMessages();
    paint();
    hook(afterRender);
  }
  function animate() {
    const active = !disposed && !paused && interactive && [...agents.values()].some(agent => WORKING.has(agent.status));
    if (!active) { clearInterval(timer); timer = undefined; return; }
    if (timer) return;
    timer = setInterval(() => { frame += 1; render(); }, 100);
    timer.unref?.();
  }
  function register({ id, name, model, task, status: initialStatus } = {}) {
    if (disposed || typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) return false;
    if (!agents.has(id) && agents.size >= MAX_AGENTS) return false;
    const agent = agents.get(id) ?? { id, name: id, model: '', task: '', activity: '', status: 'pending', warning: false };
    if (name !== undefined) agent.name = clean(name, 80) || id;
    if (model !== undefined) agent.model = clean(model, 160);
    if (task !== undefined) agent.task = clean(task, 512);
    if (status(initialStatus)) agent.status = status(initialStatus);
    agents.set(id, agent);
    render();
    animate();
    return true;
  }
  function update(event, metadata = {}) {
    if (disposed || !event || typeof event !== 'object') return false;
    const id = metadata.agentId ?? event.agentId ?? event.agent ?? event.id;
    if (typeof id !== 'string') return false;
    if (!agents.has(id) && !register({ id, name: metadata.name ?? event.kind, model: metadata.model, task: metadata.task })) return false;
    const agent = agents.get(id);
    if (metadata.name !== undefined) agent.name = clean(metadata.name, 80) || id;
    if (metadata.model !== undefined) agent.model = clean(metadata.model, 160);
    if (metadata.task !== undefined) agent.task = clean(metadata.task, 512);
    if (event.type === 'agent_status' || event.type === 'task_finished') {
      if (status(event.status)) agent.status = status(event.status);
      if (['succeeded', 'cancelled'].includes(agent.status)) agent.warning = false;
      if (event.error) { agent.activity = clean(event.error, 512); agent.warning = true; }
    } else if (['started', 'pty_ready', 'session_started', 'task_started'].includes(event.type)) {
      agent.status = 'running';
      agent.warning = false;
    } else if (event.type === 'activity') {
      const fallback = event.command ?? event.tool ?? (Array.isArray(event.files) ? event.files.join(', ') : event.activity);
      agent.activity = clean(event.description ?? fallback, 512);
      agent.warning = ['denied', 'failed'].includes(event.status);
      if (event.status === 'started') agent.status = 'running';
    } else if (event.type === 'assistant_delta' || event.type === 'assistant_message') {
      agent.activity = event.type === 'assistant_delta' ? 'Responding' : 'Response received';
    } else if (event.type === 'permission_required' || event.type === 'approval_required') {
      agent.status = 'waiting_for_approval';
      agent.activity = clean(event.description ?? 'Native approval requested', 512);
    } else return false;
    render();
    animate();
    return true;
  }
  function message(agentId, text) {
    if (disposed || typeof text !== 'string' || !text) return false;
    const body = stripVTControlCharacters(text.slice(0, MAX_MESSAGE_UNITS))
      .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '  ');
    const prefix = agentId ? `[${clean(agentId, 80)}] ` : '';
    const line = `${prefix}${body}${text.length > MAX_MESSAGE_UNITS ? '\n[message truncated]' : ''}${body.endsWith('\n') ? '' : '\n'}`;
    const bytes = Buffer.byteLength(line);
    queue.push(line);
    queuedBytes += bytes;
    while (queue.length > 256 || queuedBytes > MAX_QUEUED_BYTES) {
      queuedBytes -= Buffer.byteLength(queue.shift());
      omitted = true;
    }
    render();
    return true;
  }
  function pause() {
    if (disposed || paused) return;
    if (interactive && hook(beforeRender)) { clearOwned(); hook(afterRender); }
    paused = true;
    clearInterval(timer);
    timer = undefined;
  }
  function resume() {
    if (disposed) return;
    paused = false;
    render();
    animate();
  }
  function dispose({ clear = false } = {}) {
    if (disposed) return;
    clearInterval(timer);
    timer = undefined;
    if (!paused) {
      if (interactive && clear && hook(beforeRender)) { clearOwned(); flushMessages(); hook(afterRender); }
      else render();
    }
    // Leave final rows as ordinary output and give cursor ownership back.
    drawnRows = 0;
    disposed = true;
    stream.removeListener?.('resize', render);
  }
  stream.on?.('resize', render);
  return { register, update, message, render, pause, resume, stop: dispose, dispose,
    snapshot: () => [...agents.values()].map(agent => ({ ...agent })) };
}
