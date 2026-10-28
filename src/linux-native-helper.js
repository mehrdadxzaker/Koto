import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { defaultStateDirectory } from './preferences.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./native/linux-pty.c', import.meta.url));
const SOURCE_LIMIT = 2 * 1024 * 1024;
const BINARY_LIMIT = 16 * 1024 * 1024;
const RECEIPT_LIMIT = 32 * 1024;
const TOOL_OUTPUT_LIMIT = 128 * 1024;
const RECEIPT_KIND = 'koto-linux-pty-helper-build';
const digest = value => createHash('sha256').update(value).digest('hex');

function failure(code, message, diagnostics) {
  const error = new Error(message);
  error.code = code;
  if (diagnostics) error.diagnostics = diagnostics.slice(-16_384);
  return error;
}

function requireLinux() {
  if (process.platform !== 'linux') {
    throw failure('linux_pty_requires_linux', 'The Linux PTY helper can only be built or used on Linux.');
  }
  if (!['arm64', 'x64'].includes(process.arch)) {
    throw failure('linux_pty_arch_unsupported', 'This helper supports Linux arm64 and x64 builds only.');
  }
}

async function maybeStat(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function own(info) { return typeof process.getuid === 'function' && info.uid === process.getuid(); }

let rootOwner;
async function protectedOwner(info) {
  // Rootless/container mounts can map the immutable system image to a nonzero
  // UID. Its root-directory owner is already trusted for /usr/bin and libc.
  rootOwner ??= (await lstat('/')).uid;
  return own(info) || info.uid === 0 || info.uid === rootOwner;
}

async function privateDirectory(value, create) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.length > 4096) {
    throw failure('linux_pty_invalid_build_directory', 'Choose an absolute private directory outside a Git worktree.');
  }
  const directory = path.resolve(value);
  const parts = directory.split(path.sep).filter(Boolean);
  let current = path.parse(directory).root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info = await maybeStat(current);
    if (!info) {
      if (!create) throw failure('linux_pty_build_required', 'Run `koto terminal build` on this Linux host before selecting PTY transport.');
      try { await mkdir(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = await lstat(current);
    }
    const stickyAncestor = index < parts.length - 1 && (info.mode & 0o1000) !== 0;
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 && !stickyAncestor
      || !await protectedOwner(info)) {
      throw failure('linux_pty_unsafe_build_directory', 'Helper storage must use real directories protected from other users writing them.');
    }
    const gitMarker = path.join(current, '.git');
    const gitInfo = await maybeStat(gitMarker);
    // Some managed workspaces contain an empty read-only .git placeholder.
    // It is not a Git worktree; real markers (including gitdir files) are refused.
    if (gitInfo && (!gitInfo.isDirectory() || gitInfo.isSymbolicLink()
      || (await readdir(gitMarker)).length !== 0)) {
      throw failure('linux_pty_build_directory_in_worktree', 'Keep native helper storage outside every Git worktree.');
    }
  }
  const info = await lstat(directory);
  if (!own(info) || (info.mode & 0o077) !== 0) {
    throw failure('linux_pty_unsafe_build_directory', 'Helper storage must be owned by the current user and private (mode 700).');
  }
  if (await realpath(directory) !== directory) {
    throw failure('linux_pty_unsafe_build_directory', 'Helper storage must not contain redirected or symbolic-link paths.');
  }
  return directory;
}

async function readOwnedFile(filename, limit, executable = false) {
  let file;
  try {
    try { file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch {
      throw failure('linux_pty_build_unrecognized', 'The existing helper build is unavailable or redirected. Preserve it and choose another build directory.');
    }
    const info = await file.stat();
    if (!info.isFile() || !own(info) || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > limit
      || executable && (info.mode & 0o100) === 0) {
      throw failure('linux_pty_build_unrecognized', 'The existing helper build is not a private, recognized file. Preserve it and choose another build directory.');
    }
    const bytes = await boundedRead(file, Math.min(info.size + 1, limit + 1));
    if (bytes.length !== info.size || (await file.stat()).size !== info.size) {
      throw failure('linux_pty_build_changed', 'The helper build changed while it was being inspected.');
    }
    return bytes;
  } finally { await file?.close(); }
}

async function boundedRead(file, maximum) {
  const buffer = Buffer.alloc(maximum);
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await file.read(buffer, total, buffer.length - total);
    if (!bytesRead) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

async function sourceBytes() {
  let file;
  try {
    try { file = await open(SOURCE, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch { throw failure('linux_pty_source_unavailable', 'Use a complete Koto package containing the Linux helper source.'); }
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > SOURCE_LIMIT) {
      throw failure('linux_pty_source_unavailable', 'Use a complete Koto package containing the Linux helper source.');
    }
    const bytes = await boundedRead(file, Math.min(info.size + 1, SOURCE_LIMIT + 1));
    if (bytes.length !== info.size || (await file.stat()).size !== info.size) {
      throw failure('linux_pty_source_changed', 'The helper source changed; retry from a stable source checkout.');
    }
    return bytes;
  } finally { await file?.close(); }
}

function paths(directory, sourceSha256) {
  const name = `linux-pty-${process.arch}-${sourceSha256}`;
  return { binary: path.join(directory, name), receipt: path.join(directory, `${name}.json`),
    lock: path.join(directory, `${name}.lock`) };
}

function executableImage(bytes) {
  const machine = process.arch === 'arm64' ? 183 : 62;
  return bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    && bytes[4] === 2 && bytes[5] === 1 && bytes[6] === 1
    && [2, 3].includes(bytes.readUInt16LE(16)) && bytes.readUInt16LE(18) === machine;
}

async function recognizedBuild(directory, sourceSha256) {
  const target = paths(directory, sourceSha256);
  const [binaryInfo, receiptInfo] = await Promise.all([maybeStat(target.binary), maybeStat(target.receipt)]);
  if (!binaryInfo && !receiptInfo) return null;
  if (!binaryInfo || !receiptInfo) {
    throw failure('linux_pty_build_unrecognized', 'An incomplete build already exists. Preserve it and choose another build directory.');
  }
  let receipt;
  try { receipt = JSON.parse((await readOwnedFile(target.receipt, RECEIPT_LIMIT)).toString('utf8')); }
  catch (error) {
    if (error.code?.startsWith('linux_pty_')) throw error;
    throw failure('linux_pty_build_unrecognized', 'The existing helper receipt is invalid. Preserve it and choose another build directory.');
  }
  const binary = await readOwnedFile(target.binary, BINARY_LIMIT, true);
  if (!receipt || receipt.kind !== RECEIPT_KIND || receipt.schemaVersion !== 1
    || receipt.helperProtocolVersion !== 1 || receipt.platform !== 'linux' || receipt.arch !== process.arch
    || receipt.path !== target.binary || receipt.sourceSha256 !== sourceSha256
    || receipt.binarySha256 !== digest(binary) || !executableImage(binary)
    || typeof receipt.compiler !== 'string' || !path.isAbsolute(receipt.compiler)
    || typeof receipt.compilerVersion !== 'string') {
    throw failure('linux_pty_build_unrecognized', 'The helper does not match this Koto source and architecture. Preserve it and build in another directory.');
  }
  return receipt;
}

function compilerEnvironment(compiler) {
  const removed = /^(?:LD_.*|DYLD_.*|CC|CFLAGS|CPPFLAGS|LDFLAGS|CPATH|C_INCLUDE_PATH|CPLUS_INCLUDE_PATH|OBJC_INCLUDE_PATH|LIBRARY_PATH|COMPILER_PATH|GCC_EXEC_PREFIX|GCC_SPECS|CCC_.*|CLANG_CONFIG_FILE_.*)$/;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !removed.test(key)));
  env.PATH = `${compiler ? `${path.dirname(compiler)}:` : ''}/usr/bin:/bin`;
  return env;
}

async function selectCompiler() {
  for (const candidate of ['/usr/bin/cc', '/usr/bin/gcc', '/usr/bin/clang']) {
    try {
      const compiler = await realpath(candidate);
      const info = await lstat(compiler);
      if (!info.isFile() || (info.mode & 0o111) === 0 || (info.mode & 0o022) !== 0
        || !await protectedOwner(info)) continue;
      // A protected file under a replaceable ancestor is not a protected tool.
      // Follow system compiler links once, then inspect the canonical ancestry.
      let current = '/', protectedPath = true;
      for (const part of path.dirname(compiler).split('/').filter(Boolean)) {
        current = path.join(current, part);
        const directory = await lstat(current);
        if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o022) !== 0
          || !await protectedOwner(directory)) { protectedPath = false; break; }
      }
      if (protectedPath) return compiler;
    } catch { /* Only inspect existing system toolchain paths. */ }
  }
  throw failure('linux_pty_compiler_required', 'An existing protected system C compiler and libc development headers are required. No compiler or headers were installed.');
}

// These are selected local developer tools, not arbitrary project commands.
// Each invocation owns its process group and has finite output/deadline bounds.
function runTool(command, args, { env, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(command, args, { env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { reject(failure('linux_pty_tool_unavailable', 'An existing system C compiler could not be started.')); return; }
    const stdout = [], stderr = [];
    let bytes = 0, closed = false, exitCode = null, terminalError, finished = false, cleanupStarted = false, cleanupComplete = false, groupGone = false;
    let deadlineTimer, cleanupTimer, killTimer, groupTimer;
    const exists = () => {
      if (!child.pid || groupGone) return false;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) {
        if (error.code === 'ESRCH') { groupGone = true; return false; }
        terminalError = failure('linux_pty_build_cleanup_unconfirmed', 'Developer-tool cleanup could not be confirmed; inspect its process state before retrying.');
        return true;
      }
    };
    const signal = name => {
      // Once observed gone, this numeric group ID may belong to a later process.
      if (!child.pid || groupGone) return;
      try { process.kill(-child.pid, name); }
      catch (error) {
        if (error.code === 'ESRCH') groupGone = true;
        else terminalError = failure('linux_pty_build_cleanup_unconfirmed', 'Developer-tool cleanup could not be confirmed.');
      }
    };
    const finish = force => {
      if (finished || !force && (!closed || !cleanupComplete)) return;
      finished = true;
      clearTimeout(deadlineTimer); clearTimeout(cleanupTimer); clearTimeout(killTimer); clearInterval(groupTimer);
      if (force) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
      if (terminalError) reject(terminalError);
      else resolve({ exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    };
    const cleanup = () => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      clearTimeout(deadlineTimer);
      const check = () => {
        if (!exists()) { cleanupComplete = true; clearInterval(groupTimer); clearTimeout(killTimer); finish(false); }
      };
      cleanupTimer = setTimeout(() => {
        if (!closed || !cleanupComplete) terminalError = failure('linux_pty_build_cleanup_unconfirmed', 'Developer-tool cleanup could not be confirmed; the private build directory is retained.');
        signal('SIGKILL'); finish(true);
      }, 2_000);
      if (!exists()) { cleanupComplete = true; finish(false); return; }
      signal('SIGTERM');
      killTimer = setTimeout(() => { signal('SIGKILL'); check(); }, 250);
      groupTimer = setInterval(check, 25);
      check();
    };
    const fail = (code, message) => { terminalError ??= failure(code, message); cleanup(); };
    const consume = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > TOOL_OUTPUT_LIMIT) { fail('linux_pty_tool_output_limit', 'The developer tool exceeded its diagnostic-output limit.'); return; }
      if (!terminalError) target.push(chunk);
    };
    child.stdout.on('data', chunk => consume(stdout, chunk));
    child.stderr.on('data', chunk => consume(stderr, chunk));
    child.stdout.on('error', () => fail('linux_pty_tool_output_failed', 'The developer tool output stream failed.'));
    child.stderr.on('error', () => fail('linux_pty_tool_output_failed', 'The developer tool output stream failed.'));
    child.on('error', () => fail('linux_pty_tool_unavailable', 'An existing system C compiler could not be started.'));
    child.once('exit', code => { exitCode = code; cleanup(); });
    child.once('close', code => { closed = true; exitCode = code; cleanup(); finish(false); });
    deadlineTimer = setTimeout(() => fail('linux_pty_tool_timeout', 'The developer tool exceeded its deadline and was stopped.'), timeoutMs);
  });
}

/** Resolve a previously built helper. This never compiles, downloads or installs. */
export async function resolveLinuxPtyHelper({ directory = path.join(defaultStateDirectory, 'native') } = {}) {
  requireLinux();
  const bytes = await sourceBytes();
  const location = await privateDirectory(directory, false);
  const receipt = await recognizedBuild(location, digest(bytes));
  if (!receipt) throw failure('linux_pty_build_required', 'Run `koto terminal build` on this Linux host before selecting PTY transport.');
  return receipt.path;
}

/** Explicit opt-in compilation of the versioned Linux helper using existing tools. */
export async function buildLinuxPtyHelper({ directory = path.join(defaultStateDirectory, 'native') } = {}) {
  requireLinux();
  const source = await sourceBytes();
  const sourceSha256 = digest(source);
  const location = await privateDirectory(directory, true);
  const target = paths(location, sourceSha256);
  let lock;
  try { lock = await open(target.lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw failure('linux_pty_build_busy', 'A helper build is active or interrupted. Inspect the private build lock before retrying.');
    throw error;
  }
  let staging, preserveStaging = false;
  try {
    await lock.writeFile(`${process.pid}\n`);
    const existing = await recognizedBuild(location, sourceSha256);
    if (existing) return existing;
    const compiler = await selectCompiler();
    const env = compilerEnvironment(compiler);
    const version = await runTool(compiler, ['--version'], { env });
    if (version.exitCode !== 0 || !version.stdout.trim()) throw failure('linux_pty_compiler_unrecognized', 'The selected C compiler did not report its version.');
    staging = await mkdtemp(path.join(location, '.linux-pty-build-'));
    const snapshot = path.join(staging, 'linux-pty.c');
    const output = path.join(staging, 'linux-pty');
    await writeFile(snapshot, source, { mode: 0o600, flag: 'wx' });
    const args = ['-O2', '-std=c11', '-D_GNU_SOURCE', '-Wall', '-Wextra', '-Werror',
      snapshot, '-o', output, '-lutil'];
    const compiled = await runTool(compiler, args, { env, timeoutMs: 60_000 });
    if (compiled.exitCode !== 0) throw failure('linux_pty_compile_failed', 'The C compiler did not build the Linux helper. Inspect the bounded compiler diagnostics.', compiled.stderr);
    await chmod(output, 0o700);
    const binary = await readOwnedFile(output, BINARY_LIMIT, true);
    if (!executableImage(binary)) throw failure('linux_pty_build_unrecognized', 'The C compiler did not produce the expected Linux executable architecture.');
    const receipt = { kind: RECEIPT_KIND, schemaVersion: 1, helperProtocolVersion: 1, path: target.binary,
      platform: 'linux', arch: process.arch, sourceSha256, binarySha256: digest(binary),
      compiler, compilerVersion: version.stdout.trim().split('\n')[0].slice(0, 1024),
      builtAt: new Date().toISOString(), sourceBytes: source.length, binaryBytes: binary.length };
    const receiptStage = path.join(staging, 'receipt.json');
    await writeFile(receiptStage, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    // Hard links publish complete files atomically and never replace existing files.
    await link(output, target.binary);
    await link(receiptStage, target.receipt);
    const verified = await recognizedBuild(location, sourceSha256);
    if (!verified) throw failure('linux_pty_build_changed', 'The published helper files changed before verification completed.');
    return verified;
  } catch (error) {
    preserveStaging = error.code === 'linux_pty_build_cleanup_unconfirmed';
    throw error;
  } finally {
    await lock.close();
    await unlink(target.lock);
    if (staging && !preserveStaging) await rm(staging, { recursive: true, force: true });
  }
}
