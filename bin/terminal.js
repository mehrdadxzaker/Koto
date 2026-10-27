import { buildDarwinPtyHelper, resolveDarwinPtyHelper } from '../src/index.js';

const help = `Mac interactive terminal support

  koto terminal build [--directory ABS_PATH]
  koto terminal info [--directory ABS_PATH]

build explicitly compiles Koto's versioned Darwin helper with existing Apple
command-line tools and records its source/binary identity. No downloads or
installation hooks run. info only verifies an existing build.
Project agents opt in with transport: "pty". Other systems keep pipe transport.
`;

export async function runTerminalCli(args, { write } = {}) {
  if (!args.length || args[0] === '--help') { write(help); return 0; }
  if (!['build', 'info'].includes(args[0]) || ![1, 3].includes(args.length)
      || (args.length === 3 && args[1] !== '--directory')) { write(help); return 2; }
  const options = args.length === 3 ? { directory: args[2] } : {};
  try {
    const result = args[0] === 'build' ? await buildDarwinPtyHelper(options)
      : { path: await resolveDarwinPtyHelper(options), verified: true, transport: 'pty' };
    write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (!/^darwin_pty_[a-z_]+$/.test(error.code ?? '')) throw error;
    // These diagnostics come only from Koto's selected compiler and versioned
    // source, never from an agent transcript or arbitrary model exception.
    write(`${JSON.stringify({ error: error.code, message: error.message,
      ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, null, 2)}\n`);
    return 1;
  }
}
