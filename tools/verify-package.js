import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run package verification through npm run test:package.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'koto-package-'));

async function npm(args, cwd = temporary) {
  const result = await execute(process.execPath, [npmCli, ...args,
    '--cache', path.join(temporary, 'cache'), '--no-audit', '--no-fund'], {
    cwd, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout;
}

try {
  const packed = JSON.parse(await npm(['pack', '--json', '--ignore-scripts', '--offline',
    '--pack-destination', temporary], root))[0];
  const files = packed.files.map(file => file.path);
  assert(packed.files.every(file => (file.mode & 0o444) === 0o444),
    'Installed runtime files must be readable when installed by a different user.');
  // Windows launchers use npm shims and ACLs, not POSIX execute bits. Verify the
  // real installed launcher below on every OS; retain the mode check on POSIX.
  if (process.platform !== 'win32') {
    assert((packed.files.find(file => file.path === 'bin/koto.js')?.mode & 0o111) === 0o111,
      'The npm executable must be runnable by all users.');
  }
  assert(files.includes('bin/koto.js'));
  assert(files.includes('src/core.js'));
  assert(files.includes('src/core.d.ts'));
  assert(files.includes('src/process-agent.js'));
  assert(files.includes('examples/fixture-agent.js'));
  assert(files.every(file => ['package.json', 'README.md', 'LICENSE'].includes(file)
    || /^(bin|src|examples)\//.test(file)), 'Package contains only runtime, examples and release metadata.');
  const tarball = path.join(temporary, packed.filename);
  const prefix = path.join(temporary, 'installed');
  await npm(['install', '--global', '--prefix', prefix, '--offline', '--ignore-scripts', tarball]);
  const moduleRoot = process.platform === 'win32' ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules');
  const installed = path.join(moduleRoot, metadata.name);
  const caller = path.join(temporary, 'unrelated-working-directory');
  await mkdir(caller);
  const cli = path.join(installed, 'bin', 'koto.js');
  const version = await execute(process.execPath, [cli, '--version'], { cwd: caller, timeout: 10_000 });
  assert.equal(version.stdout.trim(), metadata.version);
  const npxCli = path.join(path.dirname(npmCli), 'npx-cli.js');
  const globalBin = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
  if (process.platform === 'win32') {
    const shim = await readFile(path.join(globalBin, 'koto.cmd'), 'utf8');
    assert.match(shim, /bin[\\/]koto\.js/i, 'The Windows shim must point to the installed CLI.');
  }
  const launcherEnvironment = { ...process.env };
  const pathKey = Object.keys(launcherEnvironment).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  launcherEnvironment[pathKey] = globalBin + path.delimiter + (launcherEnvironment[pathKey] ?? '');
  const launcher = await execute(process.execPath, [npxCli, '--offline', '--no', '--cache',
    path.join(temporary, 'launcher-cache'), '--call', 'koto --version'], {
    cwd: caller, env: launcherEnvironment, timeout: 30_000,
  });
  assert.equal(launcher.stdout.trim(), metadata.version, 'The npm-installed launcher must execute.');
  const importBase = process.platform === 'win32' ? prefix : path.join(prefix, 'lib');
  const publicApi = await execute(process.execPath, ['--input-type=module', '--eval',
    `import { runWorkflow, validateWorkflow } from ${JSON.stringify(metadata.name)}; console.log(typeof runWorkflow, typeof validateWorkflow);`],
  { cwd: importBase, timeout: 10_000 });
  assert.equal(publicApi.stdout.trim(), 'function function');
  const consumer = path.join(importBase, 'type-consumer');
  await mkdir(consumer);
  for (const file of ['consumer.mts', 'invalid.mts', 'tsconfig.json']) {
    await copyFile(path.join(root, 'test', 'types', file), path.join(consumer, file));
  }
  const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const typeRoots = path.join(root, 'node_modules', '@types');
  const typeArgs = [compiler, '--project', path.join(consumer, 'tsconfig.json'),
    '--typeRoots', typeRoots, '--pretty', 'false'];
  await execute(process.execPath, typeArgs, { cwd: consumer, timeout: 30_000 });
  await execute(process.execPath, [...typeArgs, '--moduleResolution', 'Bundler', '--module', 'ESNext'],
    { cwd: consumer, timeout: 30_000 });
  const demo = await execute(process.execPath, [cli, 'demo'], { cwd: caller, timeout: 15_000 });
  const report = JSON.parse(demo.stdout);
  assert.equal(report.status, 'succeeded');
  assert.equal(report.tasks.length, 3);
  assert.match(report.output, /Checked result: 42/);
  const npx = await execute(process.execPath, [npxCli, '--offline', '--yes', '--cache',
    path.join(temporary, 'npx-cache'), '--package', tarball, 'koto', 'demo'], {
    cwd: caller, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(JSON.parse(npx.stdout).status, 'succeeded');
  process.stdout.write(`Packed ${metadata.name}@${metadata.version}: global install and launcher, public API import, strict TypeScript consumers (NodeNext/Bundler), external-directory demo and npx execution verified.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
