import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, link, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./native/windows-pty.c', import.meta.url));
const SOURCE_LIMIT = 2 * 1024 * 1024;
const BINARY_LIMIT = 16 * 1024 * 1024;
const RECEIPT_LIMIT = 32 * 1024;
const TOOL_OUTPUT_LIMIT = 128 * 1024;
const RECEIPT_KIND = 'koto-windows-pty-helper-build';
const digest = value => createHash('sha256').update(value).digest('hex');
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

function failure(code, message, diagnostics) {
  const error = new Error(message);
  error.code = code;
  if (diagnostics) error.diagnostics = diagnostics.slice(-16_384);
  return error;
}

function requireWindows() {
  if (process.platform !== 'win32') throw failure('windows_pty_requires_windows', 'Build and use the Windows terminal helper on Windows 10 1809 or newer.');
  const version = release().split('.').map(Number);
  if (version[0] < 10 || version[0] === 10 && (!Number.isFinite(version[2]) || version[2] < 17763)) {
    throw failure('windows_pty_version_unsupported', 'ConPTY requires Windows 10 version 1809 (build 17763) or newer.');
  }
  if (!['x64', 'arm64'].includes(process.arch)) throw failure('windows_pty_arch_unsupported', 'The Windows helper supports x64 and arm64 builds.');
}

async function maybeStat(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Explicit developer-tool invocations only. A failed/expired compiler run is
// never treated as a recognized build and its staging directory is retained.
function runTool(command, args, { env = process.env, cwd, timeoutMs = 10_000, allow = [0] } = {}) {
  return new Promise((resolve, reject) => {
    let child, taskkill, settled = false, error, stdout = [], stderr = [], bytes = 0, timer, forced;
    let childClosed = false, childCode, treeStopPending = false;
    const finish = (code) => {
      if (settled || treeStopPending) return;
      settled = true; clearTimeout(timer); clearTimeout(forced);
      if (error) reject(error);
      else if (!allow.includes(code)) reject(failure('windows_pty_tool_failed',
        `The selected existing developer tool ${path.basename(command)} exited ${code}.`,
        `${Buffer.concat(stdout).toString('utf8')}\n${Buffer.concat(stderr).toString('utf8')}`));
      else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code });
    };
    const stop = (code, message) => {
      if (settled || error) return;
      error = failure(code, message);
      // Keep the compiler parent alive while taskkill discovers its descendants.
      // Killing it first loses the linker/driver process-tree identity on Windows.
      const fallback = () => {
        try { child?.kill(); } catch { /* Retain unconfirmed cleanup. */ }
      };
      if (child?.pid) {
        treeStopPending = true;
        try {
          taskkill = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          taskkill.on('error', () => { fallback(); });
          taskkill.once('close', () => {
            treeStopPending = false;
            if (!childClosed) fallback();
            else finish(childCode);
          });
        } catch { treeStopPending = false; fallback(); }
      }
      forced = setTimeout(() => {
        if (taskkill && taskkill.exitCode === null && taskkill.signalCode === null) {
          try { taskkill.kill(); } catch { /* Cleanup remains unconfirmed. */ }
          taskkill.unref();
        }
        fallback();
        child?.stdout.destroy(); child?.stderr.destroy(); child?.unref();
        treeStopPending = false;
        finish(null);
      }, 1500);
      if (childClosed && !treeStopPending) finish(childCode);
    };
    try { child = spawn(command, args, { cwd, env: { ...env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { reject(failure('windows_pty_tool_unavailable', 'The existing Windows developer tool could not be started.')); return; }
    const consume = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > TOOL_OUTPUT_LIMIT) stop('windows_pty_build_cleanup_unconfirmed', 'Developer-tool output exceeded its bound; inspect the retained staging directory before retrying.');
      else if (!error) target.push(chunk);
    };
    child.stdout.on('data', chunk => consume(stdout, chunk));
    child.stderr.on('data', chunk => consume(stderr, chunk));
    child.stdout.on('error', () => stop('windows_pty_build_cleanup_unconfirmed', 'Developer-tool output failed; inspect the retained staging directory.'));
    child.stderr.on('error', () => stop('windows_pty_build_cleanup_unconfirmed', 'Developer-tool output failed; inspect the retained staging directory.'));
    child.on('error', () => { error ??= failure('windows_pty_tool_unavailable', 'The selected Windows developer tool is unavailable.'); });
    child.once('close', code => { childClosed = true; childCode = code; finish(code); });
    timer = setTimeout(() => stop('windows_pty_build_cleanup_unconfirmed', 'The developer tool exceeded its deadline; inspect the retained staging directory before retrying.'), timeoutMs);
  });
}

async function checkedBytes(filename, limit) {
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > limit
      || !samePath(await realpath(filename), filename)) throw failure('windows_pty_build_unrecognized', 'The helper source or build file is missing, redirected or invalid.');
  const file = await open(filename, constants.O_RDONLY);
  try {
    const info = await file.stat();
    if (info.ino !== before.ino || info.dev !== before.dev || info.size !== before.size) throw failure('windows_pty_build_changed', 'The helper source or build changed while being inspected.');
    const buffer = Buffer.alloc(Math.min(limit + 1, info.size + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size || (await file.stat()).size !== info.size) throw failure('windows_pty_build_changed', 'The helper source or build changed while being inspected.');
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

async function privateDirectory(value, create) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.length > 4096) {
    throw failure('windows_pty_invalid_build_directory', 'Choose an absolute helper directory outside Git worktrees.');
  }
  const directory = path.resolve(value);
  const root = path.parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let info = await maybeStat(current);
    if (!info && create) { await mkdir(current, { mode: 0o700 }); info = await lstat(current); }
    if (!info) throw failure('windows_pty_build_required', 'Run koto terminal build before using Windows agent sessions.');
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(current), current)) {
      throw failure('windows_pty_unsafe_build_directory', 'Helper directories must not use symbolic links or directory junctions.');
    }
    if (await maybeStat(path.join(current, '.git'))) throw failure('windows_pty_build_directory_in_worktree', 'Keep helper storage outside every Git worktree.');
  }
  // Windows mode bits do not establish privacy. Check the DACL without changing
  // it or printing identity/configuration details. Source and binary files inherit
  // this directory's access policy. The user's current identity, SYSTEM and local
  // Administrators are the only accepted writers. Use .NET directly in Windows
  // PowerShell 5.1: an inherited PowerShell 7 module path can break Get-Acl.
  const script = `$ErrorActionPreference='Stop'
$p=$env:KOTO_NATIVE_DIRECTORY
$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trusted=@($me,'S-1-5-18','S-1-5-32-544')
$danger=([int64][System.Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership') -bor 0x50000000
$ancestorDanger=([int64][System.Security.AccessControl.FileSystemRights]'DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership') -bor 0x10000000
$first=$true
while($p) {
  $acl=[System.IO.Directory]::GetAccessControl($p)
  if($first -and $trusted -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value){'owner_untrusted';exit 3}
  foreach($r in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
    $inheritOnly=($r.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0
    if(!$first -and $inheritOnly){continue}
    if($first -and $inheritOnly -and $r.IdentityReference.Value -eq 'S-1-3-0'){continue}
    if($r.AccessControlType -eq 'Allow' -and $trusted -notcontains $r.IdentityReference.Value -and (([int64]$r.FileSystemRights -band $(if($first){$danger}else{$ancestorDanger})) -ne 0)){'writer_untrusted';exit 3}
  }
  $first=$false
  $parent=[System.IO.Directory]::GetParent($p)
  if($null -eq $parent){break}
  $p=$parent.FullName
}
'ok'`;
  try {
    const tool = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = await runTool(tool, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, KOTO_NATIVE_DIRECTORY: directory }, allow: [0, 3] });
    if (result.exitCode === 3) throw failure('windows_pty_unsafe_build_directory',
      'Helper storage must be owned by this user with no untrusted writers. Use a private directory under the user profile. No permissions were changed.',
      ['owner_untrusted', 'writer_untrusted'].includes(result.stdout.trim()) ? result.stdout.trim() : 'acl_rejected');
    if (result.stdout.trim() !== 'ok') throw new Error('acl');
  } catch (error) {
    if (['windows_pty_build_cleanup_unconfirmed', 'windows_pty_unsafe_build_directory'].includes(error.code)) throw error;
    throw failure('windows_pty_acl_check_failed', 'Windows directory ownership and access could not be inspected. No permissions were changed.', error.diagnostics);
  }
  return directory;
}

function paths(directory, sourceSha256) {
  const name = `windows-pty-${process.arch}-${sourceSha256}`;
  return { binary: path.join(directory, `${name}.exe`), receipt: path.join(directory, `${name}.json`), lock: path.join(directory, `${name}.lock`) };
}

/** Read-only ownership/DACL check for private control storage outside worktrees.
 * Internal orchestration layers reuse the same policy as native-helper builds.
 */
export async function verifyWindowsPrivateDirectory(directory) {
  requireWindows();
  return privateDirectory(directory, false);
}

function executableImage(bytes) {
  if (bytes.length < 256 || bytes.readUInt16LE(0) !== 0x5a4d) return false;
  const offset = bytes.readUInt32LE(0x3c);
  return offset <= bytes.length - 26 && bytes.readUInt32LE(offset) === 0x4550
    && bytes.readUInt16LE(offset + 4) === (process.arch === 'arm64' ? 0xaa64 : 0x8664)
    && bytes.readUInt16LE(offset + 24) === 0x20b;
}

async function recognizedBuild(directory, sourceSha256) {
  const target = paths(directory, sourceSha256);
  const [binaryInfo, receiptInfo] = await Promise.all([maybeStat(target.binary), maybeStat(target.receipt)]);
  if (!binaryInfo && !receiptInfo) return null;
  if (!binaryInfo || !receiptInfo) throw failure('windows_pty_build_unrecognized', 'An incomplete build already exists. Preserve it and select another build directory.');
  let receipt;
  try { receipt = JSON.parse((await checkedBytes(target.receipt, RECEIPT_LIMIT)).toString('utf8')); }
  catch { throw failure('windows_pty_build_unrecognized', 'The existing helper receipt is invalid. Preserve it and select another build directory.'); }
  const binary = await checkedBytes(target.binary, BINARY_LIMIT);
  if (!receipt || receipt.kind !== RECEIPT_KIND || receipt.schemaVersion !== 1 || receipt.helperProtocolVersion !== 1
      || receipt.platform !== 'win32' || receipt.arch !== process.arch
      || typeof receipt.path !== 'string' || !path.isAbsolute(receipt.path) || !samePath(receipt.path, target.binary)
      || receipt.sourceSha256 !== sourceSha256 || receipt.binarySha256 !== digest(binary) || !executableImage(binary)
      || typeof receipt.compiler !== 'string' || !path.isAbsolute(receipt.compiler) || typeof receipt.compilerVersion !== 'string') {
    throw failure('windows_pty_build_unrecognized', 'The helper does not match this Koto source and architecture.');
  }
  return receipt;
}

async function available(filename) {
  try { if (!(await lstat(filename)).isFile()) return undefined; await access(filename, constants.F_OK); return await realpath(filename); }
  catch { return undefined; }
}

function versionOrder(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (b[index] ?? 0) - (a[index] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

async function versions(directory) {
  try { return (await readdir(directory)).filter(value => /^\d+(?:\.\d+){1,4}$/.test(value)).sort(versionOrder); }
  catch { return []; }
}

function compilerEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CL|_CL_|LINK|_LINK_)$/i.test(key)));
}

async function compilerSetup() {
  const env = compilerEnvironment();
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of searchPath.split(path.delimiter).filter(value => path.isAbsolute(value))) {
    const compiler = await available(path.join(directory, 'cl.exe'));
    if (compiler && env.INCLUDE && env.LIB) return { compiler, env };
  }
  const programFiles = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles;
  if (!programFiles || !path.isAbsolute(programFiles)) throw failure('windows_pty_compiler_required', 'Use an existing Visual Studio C++ toolchain and Windows SDK. No compiler was installed.');
  const vswhere = await available(path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'));
  if (!vswhere) throw failure('windows_pty_compiler_required', 'Use an existing Visual Studio C++ toolchain and Windows SDK. No compiler was installed.');
  const component = process.arch === 'arm64' ? 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' : 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64';
  const found = await runTool(vswhere, ['-latest', '-products', '*', '-requires', component, '-property', 'installationPath']);
  const installation = found.stdout.trim();
  if (!path.isAbsolute(installation)) throw failure('windows_pty_compiler_required', 'No existing Visual Studio installation with C++ tools was found.');
  const msvcRoot = path.join(installation, 'VC', 'Tools', 'MSVC');
  const sdkRoot = path.join(programFiles, 'Windows Kits', '10');
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
  for (const version of await versions(msvcRoot)) {
    const msvc = path.join(msvcRoot, version);
    for (const host of process.arch === 'arm64' ? ['Hostarm64', 'Hostx64'] : ['Hostx64']) {
      const compiler = await available(path.join(msvc, 'bin', host, architecture, 'cl.exe'));
      if (!compiler) continue;
      for (const sdkVersion of await versions(path.join(sdkRoot, 'Include'))) {
        const includeRoot = path.join(sdkRoot, 'Include', sdkVersion);
        const libRoot = path.join(sdkRoot, 'Lib', sdkVersion);
        if (!await available(path.join(includeRoot, 'um', 'Windows.h')) || !await available(path.join(libRoot, 'um', architecture, 'kernel32.lib'))) continue;
        const sdkBin = path.join(sdkRoot, 'bin', sdkVersion, host.slice(4).toLowerCase());
        if (!await available(path.join(sdkBin, 'rc.exe')) || !await available(path.join(sdkBin, 'mt.exe'))) continue;
        const selected = { ...env, INCLUDE: [path.join(msvc, 'include'), ...['ucrt', 'shared', 'um', 'winrt'].map(item => path.join(includeRoot, item))].join(';'),
          LIB: [path.join(msvc, 'lib', architecture), path.join(libRoot, 'ucrt', architecture), path.join(libRoot, 'um', architecture)].join(';') };
        // Windows environment names are case-insensitive. Remove any old Path
        // spelling before supplying the selected native toolchain directory.
        for (const key of Object.keys(selected)) if (key.toLowerCase() === 'path') delete selected[key];
        selected.PATH = `${path.dirname(compiler)};${sdkBin};${searchPath}`;
        return { compiler, env: selected };
      }
    }
  }
  throw failure('windows_pty_compiler_required', 'The existing Visual Studio installation must include matching C++ tools and a Windows 10 SDK. Nothing was downloaded.');
}

export async function resolveWindowsPtyHelper({ directory = path.join(homedir(), '.koto', 'native') } = {}) {
  requireWindows();
  const source = await checkedBytes(SOURCE, SOURCE_LIMIT);
  const location = await privateDirectory(directory, false);
  const receipt = await recognizedBuild(location, digest(source));
  if (!receipt) throw failure('windows_pty_build_required', 'Run koto terminal build before using Windows agent sessions.');
  return receipt.path;
}

/** Explicit local build using an already installed MSVC toolchain and SDK. */
export async function buildWindowsPtyHelper({ directory = path.join(homedir(), '.koto', 'native') } = {}) {
  requireWindows();
  const source = await checkedBytes(SOURCE, SOURCE_LIMIT);
  const sourceSha256 = digest(source);
  const location = await privateDirectory(directory, true);
  const target = paths(location, sourceSha256);
  let lock;
  try { lock = await open(target.lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw failure('windows_pty_build_busy', 'A helper build is active or interrupted. Inspect the private build lock before retrying.');
    throw error;
  }
  let staging, preserveStaging = false;
  try {
    await lock.writeFile(`${process.pid}\n`);
    const existing = await recognizedBuild(location, sourceSha256);
    if (existing) return existing;
    const { compiler, env } = await compilerSetup();
    const version = await runTool(compiler, [], { env, allow: [0, 2] });
    staging = await mkdtemp(path.join(location, '.windows-pty-build-'));
    const snapshot = path.join(staging, 'windows-pty.c');
    const output = path.join(staging, 'windows-pty.exe');
    await writeFile(snapshot, source, { flag: 'wx', mode: 0o600 });
    const args = ['/nologo', '/W4', '/WX', '/O2', '/std:c11', '/DUNICODE', '/D_UNICODE', '/D_CRT_SECURE_NO_WARNINGS', '/MT',
      `/Fe${output}`, `/Fo${path.join(staging, 'windows-pty.obj')}`, snapshot, '/link', '/INCREMENTAL:NO', '/MANIFEST:EMBED'];
    await runTool(compiler, args, { env, cwd: staging, timeoutMs: 60_000 });
    const binary = await checkedBytes(output, BINARY_LIMIT);
    if (!executableImage(binary)) throw failure('windows_pty_build_unrecognized', 'The compiler did not produce the expected Windows executable architecture.');
    const receipt = { kind: RECEIPT_KIND, schemaVersion: 1, helperProtocolVersion: 1, path: target.binary,
      platform: 'win32', arch: process.arch, sourceSha256, binarySha256: digest(binary), compiler,
      compilerVersion: `${version.stdout}\n${version.stderr}`.trim().split('\n')[0].slice(0, 1024),
      builtAt: new Date().toISOString(), sourceBytes: source.length, binaryBytes: binary.length };
    const receiptStage = path.join(staging, 'receipt.json');
    await writeFile(receiptStage, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await link(output, target.binary);
    await link(receiptStage, target.receipt);
    return await recognizedBuild(location, sourceSha256);
  } catch (error) {
    preserveStaging = error.code === 'windows_pty_build_cleanup_unconfirmed';
    throw error;
  } finally {
    await lock.close();
    await unlink(target.lock);
    if (staging && !preserveStaging) await rm(staging, { recursive: true, force: true });
  }
}
