import { buildTerminalHelper, resolveTerminalHelper } from '../src/index.js';

const help = `Native terminal support

  koto terminal build [--directory ABS_PATH]
  koto terminal info [--directory ABS_PATH]

build explicitly compiles the versioned helper for this platform with an
already installed compiler and records its source/binary identity. No downloads
or installation hooks run. info only verifies an existing build.
Project agents opt in with transport: "pty" for native interactive terminals.
`;

export async function runTerminalCli(args, { write } = {}) {
  if (!args.length || args[0] === '--help') { write(help); return 0; }
  if (!['build', 'info'].includes(args[0]) || ![1, 3].includes(args.length)
      || (args.length === 3 && args[1] !== '--directory')) { write(help); return 2; }
  const options = args.length === 3 ? { directory: args[2] } : {};
  try {
    const result = args[0] === 'build' ? await buildTerminalHelper(options)
      : { path: await resolveTerminalHelper(options), verified: true, transport: 'pty' };
    write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (!/^(?:darwin_pty|linux_pty|windows_pty|terminal)_[a-z0-9_]+$/.test(error.code ?? '')) throw error;
    // These diagnostics come only from Koto's selected compiler and versioned
    // source, never from an agent transcript or arbitrary model exception.
    write(`${JSON.stringify({ error: error.code, message: error.message,
      ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, null, 2)}\n`);
    return 1;
  }
}
