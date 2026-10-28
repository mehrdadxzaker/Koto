import path from 'node:path';
import { throwOnResourceExhaustion } from './bounded-fetch.js';
import { startCommand } from './command-session.js';
import { defaultStateDirectory } from './preferences.js';
import { resolveTerminalHelper } from './terminal-helper.js';
import { startTerminalCommand } from './terminal-session.js';

/** Private setup-process seam: Windows must retain Job Object ownership, just
 * like project sessions, before installation or account checks can proceed.
 */
export async function startSetupCommand(options) {
  options?.signal?.throwIfAborted();
  if (process.platform !== 'win32') return startCommand(options);
  let helperPath;
  try { helperPath = await resolveTerminalHelper({ directory: path.join(defaultStateDirectory, 'native') }); }
  catch (cause) {
    throwOnResourceExhaustion(cause, 'setup_socket_exhausted');
    throw Object.assign(new Error('Windows setup requires verified Koto terminal support. Run `koto terminal build` using installed developer tools, then reopen setup. No client or runtime was started.', { cause }),
      { code: 'setup_terminal_helper_required' });
  }
  options?.signal?.throwIfAborted();
  return startTerminalCommand({ ...options, helperPath, transport: 'pipe' });
}
