import { startTerminalCommand } from './terminal-session.js';

/** Compatibility entry point for the original Darwin transport. */
export function startDarwinPtyCommand(options) {
  if (process.platform !== 'darwin') throw new Error('darwin_pty_platform_unsupported');
  return startTerminalCommand({ ...options, transport: 'pty' });
}
