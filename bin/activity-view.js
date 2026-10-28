import { stripVTControlCharacters } from 'node:util';

const ASCII = process.env.KOTO_ASCII === '1';
const FRAMES = ASCII ? ['|', '/', '-', '\\'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const WORKING = new Set(['starting', 'running', 'working']);
const GLYPHS = ASCII ? { codex: 'C', claude: 'A', local: 'L', opencode: 'O', agent: '*' }
  : { codex: '◇', claude: '✳', local: '◈', opencode: '◒', agent: '○' };
const PHASES = { working: 'working', request: 'awaiting response', responding: 'responding',
  command: 'running command', tool: 'using tool', file_change: 'editing files',
  delegation: 'coordinating agents', thinking: 'thinking' };
const ACTIVE_ACTIVITY = new Set(['started', 'running', 'inProgress']);
const STATES = new Set(['pending', 'idle', 'starting', 'running', 'working',
  'waiting', 'waiting_for_approval', 'blocked', 'succeeded', 'failed', 'cancelled']);
const ALIASES = { completed: 'succeeded', done: 'succeeded', error: 'failed',
  stopped: 'cancelled', waiting_approval: 'waiting_for_approval', waiting_permission: 'waiting_for_approval' };
const LABELS = { pending: 'pending', idle: 'ready', starting: 'starting',
  running: 'working', working: 'working', waiting: 'waiting',
  waiting_for_approval: 'approval needed', blocked: 'blocked',
  succeeded: 'finished', failed: 'failed', cancelled: 'stopped' };
const MAX_AGENTS = 32;
const MAX_QUEUED_BYTES = 64 * 1024;
const MAX_MESSAGE_UNITS = 32 * 1024;
const clean = (value, maximum = 512) => stripVTControlCharacters(String(value ?? ''))
  .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, maximum);

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
  const interactive = enabled === true && stream.isTTY === true && process.env.TERM !== 'dumb';
  const colour = interactive && process.env.NO_COLOR === undefined;
  const motion = interactive && process.env.KOTO_NO_ANIMATION !== '1';
  const ink = (text, code) => colour ? `\x1b[${code}m${text}\x1b[0m` : text;
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
  function presentation(agent) {
    if (agent.uncertainty) return { label: agent.uncertainty === 'cleanup' ? 'cleanup unconfirmed' : 'activity unconfirmed', busy: false };
    if (!WORKING.has(agent.status)) return { label: LABELS[agent.status], busy: false };
    if (agent.phase === 'unknown') return { label: 'activity unconfirmed', busy: false };
    if (agent.phase === 'unobserved' || !agent.phase && agent.transport === 'pty') {
      return { label: 'running · activity unobserved', busy: false };
    }
    if (agent.phase === 'settling') return { label: 'response received', busy: false };
    if (agent.phase === 'native_settling') return { label: 'awaiting process outcome', busy: false };
    return { label: PHASES[agent.phase] ?? LABELS[agent.status], busy: true };
  }
  function row(agent, plain = false) {
    const state = presentation(agent);
    const icon = agent.warning ? '!' : state.busy ? motion ? FRAMES[frame % FRAMES.length] : ASCII ? '*' : '●'
      : agent.status === 'succeeded' ? ASCII ? '+' : '✓' : agent.status === 'failed' ? ASCII ? 'x' : '×'
        : agent.status === 'waiting_for_approval' || agent.status === 'blocked' ? '!'
          : agent.status === 'cancelled' ? ASCII ? '#' : '■' : ASCII ? '.' : '·';
    const name = agent.name === agent.id ? agent.id : `${agent.id} / ${agent.name}`;
    const identity = plain ? name : `  ${GLYPHS[agent.provider] ?? GLYPHS.agent} ${name}`;
    return `${identity}  ${plain ? '' : `${icon} `}${state.label}${agent.model ? ` · ${agent.model}` : ''}${agent.activity || agent.task ? ` — ${agent.activity || agent.task}` : ''}`;
  }
  function paint() {
    const columns = Math.max(12, Math.min(500, Number.isInteger(stream.columns) ? stream.columns - 2 : 78));
    const showHeading = !Number.isInteger(stream.rows) || stream.rows >= 8;
    const capacity = Math.max(1, Math.min(12, Number.isInteger(stream.rows) ? stream.rows - (showHeading ? 5 : 4) : 8));
    const all = [...agents.values()];
    // If space is tight, active workers take precedence over completed rows.
    if (all.length > capacity) all.sort((left, right) => Number(WORKING.has(right.status)) - Number(WORKING.has(left.status)));
    const visible = all.slice(0, all.length > capacity ? Math.max(0, capacity - 1) : capacity);
    const lines = [];
    if (all.length && showHeading) {
      const active = all.filter(agent => presentation(agent).busy).length;
      const waiting = all.filter(agent => ['waiting', 'waiting_for_approval', 'blocked'].includes(agent.status)).length;
      lines.push(ink(clipped(`  AGENTS${active ? `  ${active} active` : ''}${waiting ? `  ${waiting} waiting` : ''}`, columns), '2'));
    }
    for (const agent of visible) {
      const line = clipped(row(agent), columns);
      const tone = agent.warning || agent.status === 'failed' ? '31'
        : ['waiting_for_approval', 'blocked'].includes(agent.status) ? '33'
          : agent.status === 'succeeded' ? '32' : '36';
      // Only the fixed provider glyph is coloured. Content stays ordinary text.
      lines.push(`${line.slice(0, 2)}${ink(line.slice(2, 3), tone)}${line.slice(3)}`);
    }
    if (visible.length < all.length) lines.push(ink(clipped(`  + ${all.length - visible.length} other agent(s)`, columns), '2'));
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
        const line = row(agent, true);
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
    const active = !disposed && !paused && motion && [...agents.values()].some(agent => presentation(agent).busy);
    if (!active) { clearInterval(timer); timer = undefined; return; }
    if (timer) return;
    timer = setInterval(() => { frame += 1; render(); }, 100);
    timer.unref?.();
  }
  function register({ id, name, provider, transport, model, task, status: initialStatus } = {}) {
    if (disposed || typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) return false;
    if (!agents.has(id) && agents.size >= MAX_AGENTS) return false;
    const agent = agents.get(id) ?? { id, name: id, model: '', task: '', activity: '', status: 'pending', warning: false, provider: 'agent', transport: undefined, phase: undefined, uncertainty: undefined };
    if (name !== undefined) agent.name = clean(name, 80) || id;
    if (Object.hasOwn(GLYPHS, provider)) agent.provider = provider;
    if (['pty', 'pipe'].includes(transport)) agent.transport = transport;
    if (model !== undefined) agent.model = clean(model, 160);
    if (task !== undefined) agent.task = clean(task, 512);
    if (status(initialStatus)) {
      agent.status = status(initialStatus);
      agent.phase = undefined;
      agent.uncertainty = undefined;
      agent.warning = false;
      agent.activity = '';
    }
    agents.set(id, agent);
    render();
    animate();
    return true;
  }
  function update(event, metadata = {}) {
    if (disposed || !event || typeof event !== 'object') return false;
    if (['tool_started', 'tool_completed', 'command_started'].includes(event.type)) {
      const complete = event.type === 'tool_completed';
      const failed = Boolean(event.result?.error) || ['failed', 'denied'].includes(event.result?.status);
      event = { ...event, type: 'activity', activity: event.type === 'command_started' ? 'command' : 'tool',
        status: complete ? failed ? 'failed' : 'completed' : 'started',
        description: event.command ? `Command: ${event.command}` : `Tool: ${event.tool ?? 'native tool'}` };
    }
    const id = metadata.agentId ?? event.agentId ?? event.agent ?? event.id;
    if (typeof id !== 'string') return false;
    if (!agents.has(id) && !register({ id, name: metadata.name ?? event.kind, provider: metadata.provider, transport: metadata.transport, model: metadata.model, task: metadata.task })) return false;
    const agent = agents.get(id);
    if (metadata.name !== undefined) agent.name = clean(metadata.name, 80) || id;
    if (Object.hasOwn(GLYPHS, metadata.provider)) agent.provider = metadata.provider;
    if (['pty', 'pipe'].includes(metadata.transport)) agent.transport = metadata.transport;
    if (metadata.model !== undefined) agent.model = clean(metadata.model, 160);
    if (metadata.task !== undefined) agent.task = clean(metadata.task, 512);
    if (event.type === 'agent_status' || event.type === 'task_finished') {
      if (status(event.status)) {
        agent.status = status(event.status);
        agent.phase = undefined;
        if (!WORKING.has(agent.status)) agent.activity = '';
      }
      if (['succeeded', 'cancelled', 'idle', 'running'].includes(agent.status)) agent.warning = false;
      if (event.error) {
        agent.activity = clean(event.error, 512); agent.warning = true;
        if (/(?:^|_)cleanup_unconfirmed$/.test(event.error)) agent.uncertainty = 'cleanup';
      }
    } else if (['started', 'pty_ready', 'session_started', 'task_started'].includes(event.type)) {
      agent.status = 'running';
      agent.phase = agent.transport === 'pty' ? 'unobserved' : undefined;
      agent.warning = false;
    } else if (event.type === 'native_status') {
      if (['unknown', 'unobserved'].includes(event.nativeStatus)) {
        agent.phase = event.nativeStatus;
        if (event.nativeStatus === 'unknown') agent.uncertainty ??= 'activity';
      }
      else if (event.nativeStatus === 'running') agent.phase = 'working';
      else if (['completed', 'failed', 'interrupted'].includes(event.nativeStatus)) {
        agent.phase = 'native_settling';
        agent.activity = `Native ${event.nativeStatus}; awaiting process outcome`;
      } else return false;
    } else if (event.type === 'terminal_cleanup' && event.cleanup === 'unconfirmed') {
      agent.phase = 'unknown';
      agent.uncertainty = 'cleanup';
      agent.warning = true;
      agent.activity = 'Owned process cleanup is unconfirmed';
    } else if (event.type === 'request') {
      agent.status = 'running';
      agent.phase = 'request';
      agent.activity = 'Local model request';
    } else if (event.type === 'activity') {
      const fallback = event.command ?? event.tool ?? (Array.isArray(event.files) ? event.files.join(', ') : event.activity);
      const detail = clean(event.description ?? fallback, 512);
      agent.warning = ['denied', 'failed', 'declined'].includes(event.status);
      if (['permission', 'permission_request'].includes(event.activity) && event.status === 'waiting') {
        agent.status = 'waiting_for_approval';
        agent.phase = undefined;
      } else if (ACTIVE_ACTIVITY.has(event.status)) {
        agent.status = 'running';
        agent.phase = event.activity === 'reasoning' ? 'thinking'
          : Object.hasOwn(PHASES, event.activity) ? event.activity
            : event.command ? 'command' : event.tool ? 'tool' : 'working';
      } else if (event.status === 'unknown') {
        agent.phase = 'unknown';
        agent.uncertainty ??= 'activity';
      }
      else if (['completed', 'approved', 'denied', 'failed', 'declined', 'interrupted'].includes(event.status)) {
        agent.phase = undefined;
      }
      agent.activity = `${detail}${event.status && !ACTIVE_ACTIVITY.has(event.status) ? ` (${clean(event.status, 32)})` : ''}`;
    } else if (event.type === 'assistant_delta' || event.type === 'assistant_message' || event.type === 'response') {
      agent.phase = event.type === 'assistant_delta' ? 'responding' : 'settling';
      agent.activity = event.type === 'assistant_delta' ? 'Receiving response' : 'Response received';
    } else if (event.type === 'permission_required' || event.type === 'approval_required') {
      agent.status = 'waiting_for_approval';
      agent.phase = undefined;
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
