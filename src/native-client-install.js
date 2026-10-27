import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { startSetupCommand } from './setup-command.js';
import { resolveAgentExecutable } from './launch-preflight.js';
import { throwOnResourceExhaustion } from './bounded-fetch.js';

const PACKAGES = Object.freeze({ codex: '@openai/codex', claude: '@anthropic-ai/claude-code' });
const REGISTRY = 'https://registry.npmjs.org';
const METADATA_LIMIT = 256 * 1024;
const INSTALL_TIMEOUT_MS = 300_000;
const OUTPUT_LIMIT = 1024 * 1024;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const fail = (code, message) => Object.assign(new Error(message), { code });
let installing = false;

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function stat(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function jsonFile(filename) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 2 || info.size > METADATA_LIMIT) throw fail('native_client_manifest_invalid', 'The native installation metadata is unavailable or too large.');
    return JSON.parse(await file.readFile({ encoding: 'utf8' }));
  } finally { await file.close(); }
}

async function privateDirectory(requested) {
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0') || requested.length > 4096) {
    throw fail('native_client_directory_required', 'Choose an absolute private native-client directory outside project workspaces.');
  }
  const directory = path.resolve(requested);
  let current = path.parse(directory).root;
  const parts = directory.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info = await stat(current);
    if (!info) {
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = await lstat(current);
    }
    const stickyAncestor = index < parts.length - 1 && (info.mode & 0o1000) !== 0;
    const git = await stat(path.join(current, '.git'));
    if (!info.isDirectory() || info.isSymbolicLink() || git
      || process.platform !== 'win32' && ((info.mode & 0o022) !== 0 && !stickyAncestor
        || process.getuid && info.uid !== process.getuid() && info.uid !== 0)) {
      throw fail('native_client_directory_unsafe', 'Native clients need real, protected directories outside Git workspaces.');
    }
  }
  const info = await lstat(directory);
  if (await realpath(directory) !== directory || process.platform !== 'win32'
    && ((info.mode & 0o077) !== 0 || process.getuid && info.uid !== process.getuid())) {
    throw fail('native_client_directory_unsafe', 'The native-client installation directory must be private and owned by you (mode 700).');
  }
  return directory;
}

async function registryMetadata(npmPackage, signal) {
  const bounded = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
  let response;
  try {
    response = await fetch(`${REGISTRY}/${encodeURIComponent(npmPackage)}/latest`, {
      signal: bounded, redirect: 'error', headers: { accept: 'application/json' },
    });
    if (!response.ok || !response.body) {
      throw fail(response.status === 429 ? 'native_client_registry_rate_limited' : 'native_client_registry_unavailable',
        response.status === 429 ? 'The npm registry asked to slow down. Wait before requesting another installation.' : 'The official npm registry could not provide native-client metadata.');
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > METADATA_LIMIT) throw fail('native_client_registry_metadata_limit', 'The official package metadata exceeded its download limit.');
      chunks.push(chunk);
    }
    const metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (metadata?.name !== npmPackage || typeof metadata.version !== 'string'
      || metadata.version.length > 128 || !SEMVER.test(metadata.version)
      || typeof metadata.dist?.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist.integrity)) {
      throw fail('native_client_registry_metadata_invalid', 'The official registry returned an unrecognized native-client version or integrity record.');
    }
    return { version: metadata.version, integrity: metadata.dist.integrity };
  } catch (error) {
    throwOnResourceExhaustion(error, 'native_client_socket_exhausted');
    if (error.code?.startsWith('native_client_')) throw error;
    throw fail(bounded.aborted ? 'native_client_install_cancelled' : 'native_client_registry_unavailable',
      bounded.aborted ? 'Native-client setup was cancelled or the metadata request reached its deadline.' : 'The official npm registry is unavailable. Check connectivity before retrying; no automatic retry was made.');
  } finally { await response?.body?.cancel().catch(() => {}); }
}

async function npmScript() {
  const candidates = [];
  try { candidates.push(await resolveAgentExecutable('npm')); } catch { /* Windows npm.cmd is intentionally not executed. */ }
  if (process.env.npm_execpath && path.isAbsolute(process.env.npm_execpath)) candidates.push(process.env.npm_execpath);
  candidates.push(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  for (const candidate of new Set(candidates)) {
    try {
      const actual = await realpath(candidate);
      if (path.basename(actual) !== 'npm-cli.js' || !(await lstat(actual)).isFile()) continue;
      if ((await jsonFile(path.resolve(path.dirname(actual), '..', 'package.json'))).name === 'npm') return actual;
    } catch { /* Check only npm's known local package entrypoints. */ }
  }
  throw fail('native_client_npm_required', 'Install Node.js with npm, then reopen Koto to install a native client.');
}

async function verifyExecutable(filename, prefix) {
  const command = await realpath(filename);
  if (!within(prefix, command) || !(await lstat(command)).isFile()) throw fail('native_client_executable_invalid', 'The installed native executable is outside its private package directory.');
  await access(command, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
  return command;
}

async function installedCommand(prefix, kind, version) {
  const packageRoot = path.join(prefix, 'node_modules', ...PACKAGES[kind].split('/'));
  const manifest = await jsonFile(path.join(packageRoot, 'package.json'));
  if (manifest.name !== PACKAGES[kind] || manifest.version !== version) throw fail('native_client_manifest_invalid', 'The installed native package does not match the selected official version.');
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[kind];
  if (typeof bin !== 'string' || !bin || /[\x00-\x1f\x7f]/.test(bin) || /^[\\/]|^[A-Za-z]:/.test(bin)
    || bin.split(/[\\/]/).some(part => part === '..')) throw fail('native_client_bin_invalid', 'The installed native package has an unrecognized executable declaration.');
  const entrypoint = await verifyExecutable(path.join(packageRoot, ...bin.split(/[\\/]/)), prefix);
  if (kind !== 'codex') return entrypoint;
  // The official Codex npm entrypoint is JavaScript and selects a published
  // optional native package. Verify that binary too, so npm's successful exit
  // cannot hide a failed optional-dependency download. Windows runs its native
  // executable directly because .cmd and .js shell launchers are unsupported.
  const target = {
    'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
    'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
  }[`${process.platform}-${process.arch}`];
  if (!target) throw fail('native_client_platform_unsupported', 'The official native package does not support this operating system and architecture.');
  const binary = await verifyExecutable(path.join(prefix, 'node_modules', '@openai',
    `codex-${process.platform}-${process.arch}`, 'vendor', target, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'), prefix);
  return process.platform === 'win32' ? binary : entrypoint;
}

/** Explicitly selected private installation of an official native CLI. Registry
 * metadata pins one exact version; npm verifies tarball integrity, and the lock
 * is checked against the selected metadata. It never installs globally, copies
 * native authentication or makes inference requests. Native login is separate.
 */
export async function installNativeClient({ kind, directory, signal, onProgress } = {}) {
  if (!Object.hasOwn(PACKAGES, kind) || signal !== undefined && !(signal instanceof AbortSignal)
    || onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Choose Codex or Claude Code, a private directory and optional cancellation/progress callbacks.');
  if (installing) throw fail('native_client_install_busy', 'Another native-client installation is active. Finish or cancel it before starting another.');
  if (signal?.aborted) throw fail('native_client_install_cancelled', 'Native-client setup was cancelled.');
  installing = true;
  let stage, handle, cleanupConfirmed = true;
  try {
    const npm = await npmScript();
    const metadata = await registryMetadata(PACKAGES[kind], signal);
    const root = await privateDirectory(directory);
    const parent = await privateDirectory(path.join(root, kind));
    const prefix = path.join(parent, metadata.version);
    if (await stat(prefix)) return { kind, command: await installedCommand(prefix, kind, metadata.version), version: metadata.version };
    stage = await mkdtemp(path.join(parent, `.${metadata.version}-`));
    const emptyConfig = path.join(stage, 'koto-npm-userconfig');
    const emptyGlobalConfig = path.join(stage, 'koto-npm-globalconfig');
    await writeFile(emptyConfig, '', { flag: 'wx', mode: 0o600 });
    await writeFile(emptyGlobalConfig, '', { flag: 'wx', mode: 0o600 });
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_.*|NPM_CONFIG_.*|NODE_OPTIONS|NPM_TOKEN|NPM_AUTH_TOKEN|NODE_AUTH_TOKEN|YARN_NPM_AUTH_TOKEN|OPENAI_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE|CODEX_API_KEY|CODEX_ACCESS_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL)$/i.test(key))),
      npm_config_maxsockets: '2', npm_config_fetch_retries: '0', npm_config_registry: REGISTRY,
      npm_config_audit: 'false', npm_config_fund: 'false', npm_config_userconfig: emptyConfig,
      npm_config_globalconfig: emptyGlobalConfig, npm_config_cache: path.join(root, 'npm-cache'),
      // The managed version lives beside future versions and must not upgrade
      // itself in place while a retained Koto session may still be using it.
      DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1',
    };
    let outputBytes = 0;
    const controller = new AbortController();
    handle = await startSetupCommand({ id: 'nativeClientInstall', command: process.execPath,
      args: [npm, 'install', '--prefix', stage, `${PACKAGES[kind]}@${metadata.version}`,
        '--registry', REGISTRY, '--userconfig', emptyConfig, '--globalconfig', emptyGlobalConfig,
        '--cache', path.join(root, 'npm-cache'), '--no-audit', '--no-fund',
        '--save-exact', '--package-lock=true', '--include=optional', '--fetch-retries=0',
        '--fetch-timeout=120000', '--maxsockets=2',
        // Claude's official postinstall links its optional native binary into
        // the declared bin path. Codex needs no installation scripts.
        `--ignore-scripts=${kind === 'codex' ? 'true' : 'false'}`],
      cwd: stage, env, timeoutMs: INSTALL_TIMEOUT_MS,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      onEvent(event) {
        if (event.type !== 'output') return;
        outputBytes += Buffer.byteLength(event.text);
        if (outputBytes > OUTPUT_LIMIT) { controller.abort(); return; }
        return onProgress?.({ ...event, kind, text: stripVTControlCharacters(event.text)
          .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '') });
      } });
    cleanupConfirmed = false;
    handle.endInput();
    const outcome = await handle.completion;
    cleanupConfirmed = outcome.error !== 'cleanup_unconfirmed';
    if (!cleanupConfirmed) throw fail('native_client_cleanup_unconfirmed', 'Native installation cleanup could not be confirmed. Its private staging directory was retained; inspect owned processes before retrying.');
    throwOnResourceExhaustion({ code: outcome.error }, 'native_client_socket_exhausted');
    if (outcome.status !== 'succeeded') throw fail(outcome.status === 'cancelled' ? 'native_client_install_cancelled' : 'native_client_install_failed',
      'The native-client installation did not complete. Existing clients and native accounts were preserved; no automatic retry was made.');
    const lock = await jsonFile(path.join(stage, 'package-lock.json'));
    const packageKey = `node_modules/${PACKAGES[kind]}`;
    if (lock.packages?.[packageKey]?.version !== metadata.version || lock.packages[packageKey].integrity !== metadata.integrity) {
      throw fail('native_client_integrity_mismatch', 'The npm installation lock does not match the selected official package integrity.');
    }
    await installedCommand(stage, kind, metadata.version);
    await writeFile(path.join(stage, 'koto-native-install.json'), JSON.stringify({ schemaVersion: 1,
      kind, package: PACKAGES[kind], version: metadata.version, integrity: metadata.integrity,
      platform: process.platform, architecture: process.arch }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    signal?.throwIfAborted();
    try { await rename(stage, prefix); stage = undefined; }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    return { kind, command: await installedCommand(prefix, kind, metadata.version), version: metadata.version };
  } catch (error) {
    throwOnResourceExhaustion(error, 'native_client_socket_exhausted');
    if (error.code?.startsWith('native_client_') || /^(?:windows_pty_|terminal_|setup_)/.test(error.code ?? '')) throw error;
    throw fail(signal?.aborted ? 'native_client_install_cancelled' : 'native_client_install_failed',
      signal?.aborted ? 'Native-client setup was cancelled.' : 'Native-client installation could not finish. Existing clients and native accounts were preserved.');
  } finally {
    if (handle) {
      handle.stop();
      cleanupConfirmed = (await handle.completion).error !== 'cleanup_unconfirmed';
    }
    try { if (stage && cleanupConfirmed) await rm(stage, { recursive: true, force: true }); }
    finally { installing = false; }
  }
}
