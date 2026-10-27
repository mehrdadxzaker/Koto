import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import { startNativeSignIn, resolveTerminalHelper } from '../src/index.js';

/** Only native login owns stdin while attached. The caller suspends readline. */
export async function runNativeLogin({ account, write, signal }) {
  let helperPath;
  try { helperPath = await resolveTerminalHelper(); }
  catch { /* POSIX browser/device login can use owned pipes; Windows reports its requirement. */ }
  const previousRaw = process.stdin.isRaw === true;
  const decoder = new StringDecoder('utf8');
  let handle, terminalTaken = false, outcome;
  const input = bytes => {
    if (Buffer.from(bytes).includes(0x1d)) { handle.stop(); return; }
    if (!handle.send(handle.transport === 'pty' ? bytes : decoder.write(bytes))) handle.stop();
  };
  const ended = () => { handle.endInput(); handle.stop(); };
  const resize = () => handle.resize?.(Math.max(1, Math.min(1000, process.stdout.columns || 80)),
    Math.max(1, Math.min(1000, process.stdout.rows || 24)));
  try {
    handle = await startNativeSignIn({ kind: account.kind, command: account.command,
      approved: true, signal, helperPath,
      onEvent(event) {
        if (event.type === 'output') write(helperPath ? event.text : stripVTControlCharacters(event.text));
      } });
    write(`\nNative subscription sign-in. ${handle.transport === 'pty' ? 'Ctrl-]' : 'Ctrl-], then Enter,'} cancels and returns to Koto.\n`);
    if (handle.transport === 'pty') process.stdin.setRawMode(true);
    terminalTaken = true;
    process.stdin.on('data', input);
    process.stdin.once('end', ended);
    process.stdin.once('error', ended);
    process.stdout.on('resize', resize);
    resize();
    process.stdin.resume();
    outcome = await handle.completion;
  } finally {
    process.stdin.removeListener('data', input);
    process.stdin.removeListener('end', ended);
    process.stdin.removeListener('error', ended);
    process.stdout.removeListener('resize', resize);
    if (handle && !outcome) { handle.stop(); outcome = await handle.completion; }
    if (terminalTaken) {
      if (process.stdin.isTTY) process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      if (handle.transport === 'pty') write('\x1b[0m\x1b[?25h\x1b[?2004l');
    }
  }
  if (outcome?.error === 'cleanup_unconfirmed') throw new Error('Native sign-in cleanup is unconfirmed. Inspect the owned native process before retrying.');
  if (outcome?.status !== 'succeeded') throw new Error(`Native sign-in ${outcome?.status ?? 'failed'}${outcome?.error ? ` (${outcome.error})` : ''}. No login was assumed and no request was replayed.`);
}
