import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, open, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';
import path from 'node:path';
import { startCommand } from './command-session.js';
import { resolveAgentExecutable } from './launch-preflight.js';

const OFFICIAL = 'https://github.com/ggml-org/llama.cpp.git';
const RECEIPT_KIND = 'koto-llama-source-build';
const GIB = 1024 ** 3;
const digest = value => createHash('sha256').update(value).digest('hex');
const own = info => typeof process.getuid === 'function' && info.uid === process.getuid();
const fail = (code, message) => Object.assign(new Error(message), { code });

async function maybeStat(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function privateDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.length > 4096) {
    throw fail('runtime_private_directory_required', 'Choose an absolute private runtime directory outside Git worktrees.');
  }
  const directory = path.resolve(value);
  let current = path.parse(directory).root;
  const parts = directory.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info = await maybeStat(current);
    if (!info) {
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = await lstat(current);
    }
    const stickyAncestor = index < parts.length - 1 && (info.mode & 0o1000) !== 0;
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 && !stickyAncestor
      || !own(info) && info.uid !== 0 || await maybeStat(path.join(current, '.git'))) {
      throw fail('runtime_unsafe_directory', 'Runtime storage must be outside Git worktrees and use real directories protected from other users writing them.');
    }
  }
  const info = await lstat(directory);
  if (!own(info) || (info.mode & 0o077) !== 0 || await realpath(directory) !== directory) {
    throw fail('runtime_unsafe_directory', 'Runtime storage must be owned by you and private (mode 700).');
  }
  return directory;
}

function environment() {
  const stripped = /^(?:GIT_.*|CMAKE_.*|CC|CXX|CFLAGS|CPPFLAGS|CXXFLAGS|LDFLAGS|CPATH|C_INCLUDE_PATH|CPLUS_INCLUDE_PATH|LIBRARY_PATH|COMPILER_PATH|GCC_EXEC_PREFIX|MAKEFLAGS|MFLAGS)$/i;
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !stripped.test(key))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' };
}

async function hashBinary(filename, { privateFile = false } = {}) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > 512 * 1024 ** 2
      || (info.mode & 0o111) === 0 || privateFile && (!own(info) || (info.mode & 0o077) !== 0)) {
      throw fail('runtime_binary_unrecognized', 'The runtime/compiler must be an existing executable regular file; installed runtimes must remain private and owned by you.');
    }
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw fail('runtime_binary_changed', 'An executable changed while its identity was being verified.');
    return hash.digest('hex');
  } finally { await file.close(); }
}

/** Explicit source execution only: no compiler installation, model download or inference. */
export async function buildLlamaRuntime({ sourceDirectory, commit, installDirectory, approveBuild,
  onEvent, signal, jobs = 2, timeoutMs = 1_200_000, minimumFreeBytes = GIB } = {}) {
  if (approveBuild !== true) throw fail('runtime_build_approval_required', 'Source compilation requires explicit approveBuild: true for this selected commit and install directory.');
  if (!['darwin', 'linux'].includes(process.platform)) throw fail('runtime_build_platform_unsupported', 'Managed source builds currently support macOS and Linux; use an existing native llama-server on this platform.');
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw fail('runtime_pinned_commit_required', 'Provide the full 40-character official llama.cpp commit SHA; moving branches and tags are not build inputs.');
  }
  commit = commit.toLowerCase();
  if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 2 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000
    || !Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 256 * 1024 ** 2
    || onEvent !== undefined && typeof onEvent !== 'function') {
    throw fail('runtime_invalid_build_options', 'Choose 1 or 2 build jobs, a deadline between 1 second and 1 hour, and at least 256 MiB of host free-memory reserve.');
  }
  if (signal?.aborted) throw fail('runtime_build_cancelled', 'Source build was cancelled before preparation.');
  const directory = await privateDirectory(installDirectory);
  const controller = new AbortController();
  const bounded = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  let memoryError, cleanupUnconfirmed = false;
  const checkMemory = () => {
    const available = freemem();
    if (!Number.isSafeInteger(available) || available < minimumFreeBytes) {
      memoryError = fail('runtime_memory_reserve', 'Host free-memory metrics are unavailable or below the build reserve. The owned build was stopped.');
      controller.abort();
    }
  };
  checkMemory();
  const monitor = setInterval(checkMemory, 1000);
  const env = environment();
  const run = async (command, args, { cwd, timeout = 30_000, allow = [0], phase = 'build', metadataLimit = 64 * 1024 } = {}) => {
    if (bounded.aborted) throw memoryError ?? fail('runtime_build_cancelled', 'Source build was cancelled or reached its deadline.');
    let stdout = '', stderr = '', metadataExceeded = false;
    const metadata = phase === 'metadata';
    const commandController = new AbortController();
    const handle = startCommand({ id: 'llamaBuild', command, args, cwd, env,
      timeoutMs: Math.min(timeout, timeoutMs), signal: AbortSignal.any([bounded, commandController.signal]),
      onEvent(event) {
        if (event.type === 'output') {
          if (metadata && stdout.length + stderr.length + event.text.length > metadataLimit) {
            metadataExceeded = true; commandController.abort(); return;
          }
          if (metadata) { if (event.stream === 'stdout') stdout += event.text; else stderr += event.text; }
        }
        return onEvent?.({ ...event, phase });
      } });
    handle.endInput();
    const result = await handle.completion;
    if (result.error === 'cleanup_unconfirmed') {
      cleanupUnconfirmed = true;
      throw fail('runtime_cleanup_unconfirmed', 'Owned build-process cleanup could not be confirmed. Its private staging directory was preserved; inspect remaining processes before retrying.');
    }
    if (metadataExceeded) throw fail('runtime_metadata_limit', 'A build tool exceeded its bounded metadata output.');
    if (memoryError) throw memoryError;
    if (result.error && result.error !== 'exit_failed' || !allow.includes(result.exitCode)) {
      const error = fail('runtime_build_failed', `The ${phase} command did not complete (${result.error ?? result.exitCode}). Inspect its native progress output; Koto did not install another tool or runtime.`);
      if (stderr) error.diagnostics = stderr.slice(-4096);
      throw error;
    }
    return stdout.trim();
  };
  const gitArgs = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'protocol.file.allow=never'];
  let stage, lock, lockPath;
  try {
    const tool = async name => {
      try { return await resolveAgentExecutable(name); }
      catch { throw fail('runtime_build_tool_required', `Install ${name} with your normal platform tools before requesting a source build. Koto will not install build tools automatically.`); }
    };
    const git = await tool('git'), cmake = await tool('cmake');
    let compiler, cCompiler, sdk;
    if (process.platform === 'darwin') {
      const developer = await run('/usr/bin/xcode-select', ['-p'], { phase: 'metadata' });
      if (!path.isAbsolute(developer)) throw fail('runtime_apple_tools_required', 'Select an existing Apple developer toolchain before requesting a source build.');
      env.DEVELOPER_DIR = developer;
      compiler = await realpath(await run('/usr/bin/xcrun', ['--find', 'clang++'], { phase: 'metadata' }));
      cCompiler = await realpath(await run('/usr/bin/xcrun', ['--find', 'clang'], { phase: 'metadata' }));
      sdk = await realpath(await run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { phase: 'metadata' }));
      if (!(await lstat(sdk)).isDirectory()) throw fail('runtime_apple_sdk_required', 'The selected Apple developer toolchain must provide an existing macOS SDK.');
    } else { compiler = await tool('c++'); cCompiler = await tool('cc'); }
    let buildTool, generator;
    try { buildTool = await resolveAgentExecutable('ninja'); generator = 'Ninja'; }
    catch { buildTool = await tool('make'); generator = 'Unix Makefiles'; }
    const version = command => run(command, ['--version'], { phase: 'metadata' }).then(text => text.split('\n')[0].slice(0, 1024));
    const compilerVersion = await version(compiler), cCompilerVersion = await version(cCompiler);
    const cmakeVersion = await version(cmake), buildToolVersion = await version(buildTool);
    const compilerSha256 = await hashBinary(compiler), cCompilerSha256 = await hashBinary(cCompiler);
    const cmakeSha256 = await hashBinary(cmake), buildToolSha256 = await hashBinary(buildTool);
    const flags = ['-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DLLAMA_BUILD_TESTS=OFF',
      '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_COMMON=ON', '-DLLAMA_BUILD_TOOLS=ON', '-DLLAMA_BUILD_SERVER=ON',
      '-DLLAMA_BUILD_APP=OFF', '-DLLAMA_BUILD_UI=OFF', '-DLLAMA_USE_PREBUILT_UI=OFF', '-DLLAMA_CONNECT=OFF',
      '-DLLAMA_CURL=OFF', '-DLLAMA_OPENSSL=OFF', '-DGGML_NATIVE=OFF', '-DGGML_CPU=ON', '-DGGML_CPU_ALL_VARIANTS=OFF',
      '-DGGML_CUDA=OFF', '-DGGML_METAL=OFF', '-DGGML_VULKAN=OFF', '-DGGML_OPENCL=OFF', '-DGGML_SYCL=OFF',
      '-DGGML_RPC=OFF', '-DGGML_BLAS=OFF', '-DGGML_ACCELERATE=OFF', '-DGGML_OPENMP=OFF',
      '-DGGML_AVX=OFF', '-DGGML_AVX2=OFF', '-DGGML_AVX512=OFF', '-DGGML_FMA=OFF', '-DGGML_F16C=OFF',
      `-DCMAKE_CXX_COMPILER=${compiler}`, `-DCMAKE_C_COMPILER=${cCompiler}`, `-DCMAKE_MAKE_PROGRAM=${buildTool}`,
      ...(sdk ? [`-DCMAKE_OSX_SYSROOT=${sdk}`] : [])];
    const identity = { schemaVersion: 1, commit, platform: process.platform, arch: process.arch,
      compiler, compilerVersion, compilerSha256, cCompiler, cCompilerVersion, cCompilerSha256,
      cmake, cmakeVersion, cmakeSha256, buildTool, buildToolVersion, buildToolSha256, generator, flags, ...(sdk ? { sdk } : {}) };
    const buildIdentity = digest(JSON.stringify(identity));
    const target = path.join(directory, `llama-server-${process.platform}-${process.arch}-${commit}-${buildIdentity.slice(0, 16)}`);
    const receiptPath = `${target}.json`;
    const existingBinary = await maybeStat(target), existingReceipt = await maybeStat(receiptPath);
    if (existingBinary || existingReceipt) {
      if (!existingBinary || !existingReceipt || !existingReceipt.isFile() || existingReceipt.isSymbolicLink()
        || existingReceipt.size > 64 * 1024 || !own(existingReceipt) || (existingReceipt.mode & 0o077) !== 0) {
        throw fail('runtime_existing_unrecognized', 'An unrecognized or incomplete runtime already occupies this versioned path. Preserve it and choose another private install directory.');
      }
      const file = await open(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      let receipt;
      try {
        const buffer = Buffer.alloc(64 * 1024 + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 64 * 1024) throw new Error('receipt_size');
        receipt = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      } catch { throw fail('runtime_existing_unrecognized', 'The existing runtime receipt is invalid. Preserve it and choose another private install directory.'); }
      finally { await file.close(); }
      if (!receipt || receipt.kind !== RECEIPT_KIND || receipt.buildIdentity !== buildIdentity || receipt.path !== target
        || Object.entries(identity).some(([key, value]) => JSON.stringify(receipt[key]) !== JSON.stringify(value))
        || receipt.source !== OFFICIAL || !/^[0-9a-f]{40}$/.test(receipt.sourceTree)
        || receipt.binarySha256 !== await hashBinary(target, { privateFile: true })) {
        throw fail('runtime_existing_unrecognized', 'The existing runtime does not match its pinned source/toolchain receipt. Preserve it and choose another install directory.');
      }
      return receipt;
    }
    lockPath = `${target}.lock`;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch { throw fail('runtime_build_locked', 'This versioned runtime is already being built or has a retained build lock. Inspect it before retrying.'); }
    stage = await mkdtemp(path.join(directory, '.llama-build-'));
    const gitRun = (args, cwd, phase = 'metadata', allow) => run(git, [...gitArgs, ...args],
      { cwd, phase, allow, timeout: 120_000, metadataLimit: 4 * 1024 ** 2 });
    let source;
    if (sourceDirectory !== undefined) {
      if (typeof sourceDirectory !== 'string' || !path.isAbsolute(sourceDirectory) || sourceDirectory.includes('\0')) {
        throw fail('runtime_source_directory_invalid', 'Choose an absolute existing official llama.cpp checkout.');
      }
      source = await realpath(sourceDirectory);
      const origin = await gitRun(['remote', 'get-url', 'origin'], source);
      if (!['https://github.com/ggml-org/llama.cpp.git', 'https://github.com/ggml-org/llama.cpp', 'git@github.com:ggml-org/llama.cpp.git'].includes(origin)) {
        throw fail('runtime_official_source_required', 'The selected checkout must identify the official ggml-org/llama.cpp repository as origin.');
      }
    } else {
      source = path.join(stage, 'source');
      await mkdir(source, { mode: 0o700 });
      await gitRun(['init', '--quiet'], source, 'source-init');
      await gitRun(['fetch', '--depth', '1', '--no-tags', OFFICIAL, commit], source, 'source-fetch');
      await gitRun(['-c', 'advice.detachedHead=false', 'checkout', '--detach', commit], source, 'source-checkout');
    }
    const verifySource = async () => {
      const custom = await gitRun(['config', '--name-only', '--get-regexp', String.raw`^(filter\..*|merge\..*\.driver)$`], source, 'metadata', [0, 1]);
      if (custom || (await gitRun(['ls-files', '-v', '-z'], source)).split('\0').some(entry => /^[a-zS]/.test(entry))) {
        throw fail('runtime_source_configuration_unsupported', 'Remove custom Git filters/merge drivers or hidden assume-unchanged/skip-worktree entries before building this checkout. Koto will not change that configuration.');
      }
      const actual = await gitRun(['rev-parse', '--verify', 'HEAD^{commit}'], source);
      if (actual !== commit || await gitRun(['status', '--porcelain=v1', '-z', '--untracked-files=all'], source)) {
        throw fail('runtime_source_changed', 'The source checkout must remain clean at the exact selected commit. Koto will not reset, stash or overwrite source changes.');
      }
      return gitRun(['rev-parse', '--verify', 'HEAD^{tree}'], source);
    };
    const sourceTree = await verifySource();
    const build = path.join(stage, 'build');
    await run(cmake, ['-S', source, '-B', build, '-G', generator, ...flags], { cwd: stage, phase: 'configure', timeout: 180_000 });
    await run(cmake, ['--build', build, '--config', 'Release', '--target', 'llama-server', '--parallel', String(jobs)],
      { cwd: stage, phase: 'compile', timeout: timeoutMs });
    if (await verifySource() !== sourceTree) throw fail('runtime_source_changed', 'Source identity changed during compilation. No runtime was installed.');
    const candidate = path.join(build, 'bin', 'llama-server');
    const binary = path.join(stage, 'llama-server');
    await copyFile(candidate, binary, constants.COPYFILE_EXCL);
    await chmod(binary, 0o700);
    const binarySha256 = await hashBinary(binary, { privateFile: true });
    const receipt = { kind: RECEIPT_KIND, ...identity, buildIdentity, path: target, receiptPath,
      source: OFFICIAL, sourceTree, binarySha256, jobs, minimumFreeBytes, builtAt: new Date().toISOString() };
    const stagedReceipt = path.join(stage, 'receipt.json');
    await writeFile(stagedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (bounded.aborted) throw memoryError ?? fail('runtime_build_cancelled', 'Source build was cancelled or reached its deadline before installation.');
    await link(binary, target);
    await link(stagedReceipt, receiptPath);
    return receipt;
  } finally {
    clearInterval(monitor);
    if (stage && !cleanupUnconfirmed) await rm(stage, { recursive: true, force: true });
    if (lock) { await lock.close(); if (!cleanupUnconfirmed) await unlink(lockPath); }
  }
}
