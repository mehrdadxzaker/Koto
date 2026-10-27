/** Foreground native-terminal rendering is an explicit operator action.
 * Background output stays in the shared session's bounded logs and tails.
 */
export function attachNativeTerminal({ session, agentId, write, onDetach }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('project_attach_requires_terminal');
  }
  const agent = session.status().agents.find(record => record.id === agentId);
  if (!agent || agent.transport !== 'pty') throw new Error('project_attach_requires_pty_agent');
  if (agent.status !== 'running') throw new Error('project_agent_not_running');
  const previousRaw = process.stdin.isRaw === true;
  let detached = false;
  const reset = '\x1b[0m\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l';
  const detach = (reason = 'detached') => {
    if (detached) return;
    detached = true;
    process.stdin.removeListener('data', input);
    process.stdin.removeListener('end', ended);
    process.stdin.removeListener('error', ended);
    process.stdout.removeListener('resize', resize);
    let restorationFailed = false;
    try { process.stdin.setRawMode(previousRaw); } catch { restorationFailed = true; }
    try { write(reset); } catch { restorationFailed = true; }
    try { onDetach?.(reason); } catch { restorationFailed = true; }
    // Losing the operator's terminal must not leave unattended sessions running.
    if (restorationFailed) session.stop();
  };
  const resize = () => {
    const bound = (value, fallback) => Math.max(1, Math.min(1000, Number.isInteger(value) ? value : fallback));
    session.resize(agentId, bound(process.stdout.columns, 80), bound(process.stdout.rows, 24));
  };
  const input = chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const escape = bytes.indexOf(0x1d); // Ctrl-] returns to Koto controls.
    if (escape >= 0) {
      if (escape && !session.send(agentId, bytes.subarray(0, escape))) return detach('input unavailable');
      detach();
      return;
    }
    if (!session.send(agentId, bytes)) detach('input unavailable');
  };
  const ended = () => detach('terminal input closed');
  try {
    process.stdin.setRawMode(true);
    process.stdin.on('data', input);
    process.stdin.once('end', ended);
    process.stdin.once('error', ended);
    process.stdout.on('resize', resize);
    write('\x1b[?1049h\x1b[H\x1b[2J');
    write(session.outputTail(agentId));
    resize();
    process.stdin.resume();
  } catch (error) {
    detach('terminal setup failed');
    throw error;
  }
  return {
    agentId,
    detach,
    output(event) {
      if (detached) return false;
      if (event.agentId === agentId && event.type === 'output') { write(event.text); return true; }
      if (event.agentId === agentId && event.type === 'agent_status' && event.status !== 'running') {
        detach(`agent ${event.status}`);
        return true;
      }
      return false;
    },
  };
}
