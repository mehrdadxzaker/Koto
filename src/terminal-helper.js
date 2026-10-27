import { buildDarwinPtyHelper, resolveDarwinPtyHelper } from './native-helper.js';
import { buildLinuxPtyHelper, resolveLinuxPtyHelper } from './linux-native-helper.js';
import { buildWindowsPtyHelper, resolveWindowsPtyHelper } from './windows-native-helper.js';

function backend() {
  if (process.platform === 'darwin') return { build: buildDarwinPtyHelper, resolve: resolveDarwinPtyHelper };
  if (process.platform === 'linux') return { build: buildLinuxPtyHelper, resolve: resolveLinuxPtyHelper };
  if (process.platform === 'win32') return { build: buildWindowsPtyHelper, resolve: resolveWindowsPtyHelper };
  throw Object.assign(new Error('Terminal transport requires macOS, Linux or Windows.'), { code: 'terminal_platform_unsupported' });
}

/** Explicit compilation with the host's installed toolchain; no downloads. */
export function buildTerminalHelper(options) { return backend().build(options); }
/** Read-only source and binary identity verification before native launch. */
export function resolveTerminalHelper(options) { return backend().resolve(options); }
