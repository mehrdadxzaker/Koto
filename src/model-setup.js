import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, link, lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rename, rm, rmdir, statfs, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { startSetupCommand } from './setup-command.js';
import { downloadGguf } from './local-models.js';
import { resolveAgentExecutable } from './launch-preflight.js';
import { LOCAL_MODEL_CATALOG, LLAMA_RUNTIME_CATALOG } from './model-catalog.js';

const MIB = 1024 ** 2;
const MAX_FILES = 4096;
const MAX_EXTRACTED = 512 * MIB;
const RECEIPT = 'koto-llama-release';
const fail = (code, message) => Object.assign(new Error(message), { code });
const owned = info => typeof process.getuid !== 'function' || info.uid === process.getuid();
const cancelled = signal => signal?.throwIfAborted();
let transferQueue = Promise.resolve();

// All acquisitions in this process share a single transfer slot, including
// model downloads and runtime installation. There are no automatic retries.
async function serialized(operation, signal) {
  const previous = transferQueue;
  let release;
  transferQueue = new Promise(resolve => { release = resolve; });
  try { await previous; cancelled(signal); return await operation(); }
  finally { release(); }
}

async function maybeStat(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function privateDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.length > 4096) {
    throw fail('model_directory_invalid', 'Choose an absolute private directory for Koto model assets.');
  }
  const directory = path.resolve(value);
  let current = path.parse(directory).root;
  const parts = path.relative(current, directory).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info = await maybeStat(current);
    if (!info) {
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = await lstat(current);
    }
    const stickyParent = index < parts.length - 1 && (info.mode & 0o1000) !== 0;
    const git = await maybeStat(path.join(current, '.git'));
    // A directory aggregating checkouts may have a .git without a HEAD.
    const worktree = git && (!git.isDirectory() || await maybeStat(path.join(current, '.git', 'HEAD')));
    if (!info.isDirectory() || info.isSymbolicLink() || worktree || process.platform !== 'win32'
      && (((info.mode & 0o022) !== 0 && !stickyParent) || !owned(info) && info.uid !== 0)) {
      throw fail('model_directory_unsafe', 'Model assets need real directories outside Git worktrees, protected from other users writing them.');
    }
  }
  const info = await lstat(directory);
  if (!owned(info) || process.platform !== 'win32' && (info.mode & 0o077) !== 0 || await realpath(directory) !== directory) {
    throw fail('model_directory_unsafe', 'Choose a private model-assets directory owned by your account (mode 700).');
  }
  return directory;
}

async function reserveDisk(directory, bytes) {
  const info = await statfs(directory, { bigint: true });
  if (info.bavail * info.bsize < BigInt(bytes)) {
    throw fail('model_storage_insufficient', 'There is not enough free storage for this download and installation reserve. Choose a smaller model or free storage, then retry.');
  }
}

async function hashFile(filename, { signal, gguf = false, maxBytes = MAX_EXTRACTED, privateFile = true } = {}) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < (gguf ? 4 : 0) || before.size > maxBytes
      || privateFile && (!owned(before) || process.platform !== 'win32' && (before.mode & 0o077) !== 0)) {
      throw fail('model_existing_invalid', 'An existing asset is not a recognized private regular file. Preserve it and choose another assets directory.');
    }
    if (gguf) {
      const header = Buffer.alloc(4);
      if ((await handle.read(header, 0, 4, 0)).bytesRead !== 4 || header.toString('ascii') !== 'GGUF') {
        throw fail('model_existing_invalid', 'The existing model has no GGUF header. It was preserved.');
      }
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) {
      cancelled(signal); hash.update(chunk);
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) {
      throw fail('model_asset_changed', 'An asset changed during verification. No replacement was attempted.');
    }
    return { sha256: hash.digest('hex'), bytes: before.size, mode: before.mode & 0o777 };
  } finally { await handle.close(); }
}

async function notify(callback, event, signal) {
  cancelled(signal);
  if (!callback) return;
  let abort;
  try {
    await Promise.race([Promise.resolve().then(() => callback(event)), ...(signal ? [new Promise((resolve, reject) => {
      abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })] : [])]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}

/** Acquire one selected immutable GGUF. Existing files are verified, never replaced. */
export async function installLocalModel({ id, directory, signal, onProgress } = {}) {
  const model = LOCAL_MODEL_CATALOG.find(item => item.id === id);
  if (!model) throw fail('model_choice_invalid', 'Choose an available model from the Koto catalog.');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');
  return serialized(async () => {
    directory = await privateDirectory(directory);
    const modelPath = path.join(directory, model.filename);
    if (await maybeStat(modelPath)) {
      await notify(onProgress, { type: 'verify', id, bytes: model.bytes }, signal);
      const existing = await hashFile(modelPath, { signal, gguf: true, maxBytes: model.bytes });
      if (existing.bytes !== model.bytes || existing.sha256 !== model.sha256) {
        throw fail('model_existing_mismatch', 'The existing model does not match its catalog identity. It was preserved; choose another model directory.');
      }
      return { id, modelPath, path: modelPath, ...existing, reused: true, model: { ...model } };
    }
    await reserveDisk(directory, model.bytes + 256 * MIB);
    const lockPath = `${modelPath}.lock`;
    let lock;
    try {
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw fail('model_install_busy', 'This model is being installed by another Koto process. Let it finish before retrying.');
        throw error;
      }
      const result = await downloadGguf({ url: model.url, destination: modelPath, sha256: model.sha256,
        maxBytes: model.bytes, signal, timeoutMs: 3_600_000,
        onProgress: event => onProgress?.({ ...event, id, totalBytes: model.bytes }) });
      if (result.bytes !== model.bytes) throw fail('model_download_size', 'The model did not match its pinned size.');
      return { ...result, id, modelPath, reused: false, model: { ...model } };
    } finally { if (lock) { await lock.close(); await unlink(lockPath); } }
  }, signal);
}

async function downloadArchive(asset, filename, signal, onProgress) {
  let response, file;
  let source = new URL(asset.url), bytes = 0;
  const hash = createHash('sha256');
  try {
    file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    for (let redirects = 0; ; redirects += 1) {
      const headers = new AbortController();
      const timer = setTimeout(() => headers.abort(), 30_000);
      try { response = await fetch(source, { signal: AbortSignal.any([signal, headers.signal]), redirect: 'manual' }); }
      finally { clearTimeout(timer); }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects >= 5) throw fail('runtime_download_redirect', 'The runtime source exceeded its redirect limit.');
      source = new URL(location, source);
      if (source.protocol !== 'https:' || source.username || source.password) throw fail('runtime_download_redirect', 'Runtime redirects must use HTTPS without embedded credentials.');
    }
    if (!response.ok || !response.body) throw fail('runtime_download_failed', `The runtime source returned HTTP ${response.status}. Retry later${response.status === 429 ? ' after the provider rate limit resets' : ''}.`);
    const announced = response.headers.get('content-length');
    if (announced !== null && Number(announced) !== asset.bytes) throw fail('runtime_download_size', 'The runtime source announced a different archive size.');
    for await (const chunk of response.body) {
      cancelled(signal); bytes += chunk.length;
      if (bytes > asset.bytes) throw fail('runtime_download_size', 'The runtime archive exceeded its pinned byte limit.');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        cancelled(signal);
        const written = (await file.write(chunk, offset, chunk.length - offset)).bytesWritten;
        if (!written) throw fail('runtime_download_write', 'The runtime archive could not be written completely.');
        offset += written;
      }
      await notify(onProgress, { type: 'runtime-download', bytes, totalBytes: asset.bytes }, signal);
    }
    if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw fail('runtime_download_integrity', 'The runtime archive did not match its pinned size and SHA-256 digest.');
    await file.sync();
  } finally {
    await response?.body?.cancel().catch(() => {});
    await file?.close();
  }
}

function safeName(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\0-\x1f\\:]/.test(value) || value.startsWith('/')
    || value.split('/').some(part => part === '..')) throw fail('runtime_archive_path', 'The runtime archive contains an unsafe path.');
  const name = path.posix.normalize(value).replace(/\/$/, '');
  return name === '.' ? '' : name;
}

function inside(directory, filename) {
  const relative = path.relative(directory, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function tarNumber(buffer) {
  const text = buffer.toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(text)) throw fail('runtime_archive_format', 'The runtime archive has an unsupported numeric header.');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw fail('runtime_archive_limit', 'The runtime archive has an invalid entry size.');
  return value;
}

function tarText(buffer) { return buffer.toString('utf8').replace(/\0.*$/s, ''); }

function paxValues(buffer) {
  const result = {};
  for (let offset = 0; offset < buffer.length;) {
    const separator = buffer.indexOf(32, offset);
    const count = Number(buffer.subarray(offset, separator).toString('ascii'));
    if (separator < offset || !Number.isSafeInteger(count) || count < 4 || offset + count > buffer.length
      || buffer[offset + count - 1] !== 10) throw fail('runtime_archive_format', 'The runtime archive has invalid extended metadata.');
    const line = buffer.subarray(separator + 1, offset + count - 1).toString('utf8');
    const equal = line.indexOf('=');
    if (equal < 1) throw fail('runtime_archive_format', 'The runtime archive has invalid extended metadata.');
    result[line.slice(0, equal)] = line.slice(equal + 1);
    offset += count;
  }
  return result;
}

// Parse tar entries directly so no platform tool can extract a path before it
// has been checked. Entry payloads stream to private files; symlinks wait until
// all ordinary files/directories exist and may only point to internal files.
async function extractTar(archive, directory, signal) {
  const input = createReadStream(archive, { signal });
  const gunzip = createGunzip();
  const forwardError = error => gunzip.destroy(error);
  input.on('error', forwardError); input.pipe(gunzip);
  const iterator = gunzip[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0), decompressed = 0, count = 0, total = 0;
  const read = async (size, allowEnd = false) => {
    while (pending.length < size) {
      cancelled(signal);
      const next = await iterator.next();
      if (next.done) {
        if (allowEnd && pending.length === 0) return null;
        throw fail('runtime_archive_truncated', 'The runtime archive ended before its entries were complete.');
      }
      decompressed += next.value.length;
      if (decompressed > MAX_EXTRACTED) throw fail('runtime_archive_limit', 'The runtime archive exceeded its extraction byte cap.');
      pending = pending.length ? Buffer.concat([pending, next.value]) : next.value;
    }
    const bytes = pending.subarray(0, size); pending = pending.subarray(size); return bytes;
  };
  const links = [], names = new Set();
  let extended = {}, longName, longLink;
  try {
    for (;;) {
      const header = await read(512, true);
      if (!header || header.every(byte => byte === 0)) break;
      const checksum = tarNumber(header.subarray(148, 156));
      let sum = 0;
      for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 32 : header[index];
      if (sum !== checksum) throw fail('runtime_archive_format', 'The runtime archive has an invalid header checksum.');
      if (++count > MAX_FILES) throw fail('runtime_archive_limit', 'The runtime archive has too many entries.');
      const size = tarNumber(header.subarray(124, 136));
      const type = String.fromCharCode(header[156] || 48);
      if (size > MAX_EXTRACTED || (total += size) > MAX_EXTRACTED) throw fail('runtime_archive_limit', 'The runtime archive exceeded its extraction byte cap.');
      const pad = (512 - size % 512) % 512;
      if (['x', 'g', 'L', 'K'].includes(type)) {
        if (size > 16 * 1024 || type === 'g') throw fail('runtime_archive_format', 'The runtime archive has unsupported extended metadata.');
        const content = await read(size);
        if (type === 'x') extended = paxValues(content);
        else if (type === 'L') longName = tarText(content).replace(/\n$/, '');
        else longLink = tarText(content).replace(/\n$/, '');
        await read(pad); continue;
      }
      const prefix = tarText(header.subarray(345, 500));
      const name = safeName(extended.path ?? longName ?? `${prefix ? `${prefix}/` : ''}${tarText(header.subarray(0, 100))}`);
      const linkName = extended.linkpath ?? longLink ?? tarText(header.subarray(157, 257));
      if (extended.size !== undefined && Number(extended.size) !== size) throw fail('runtime_archive_format', 'The runtime archive has an unsupported extended entry size.');
      extended = {}; longName = undefined; longLink = undefined;
      if (!name) {
        if (type !== '5' || size !== 0) throw fail('runtime_archive_path', 'The runtime archive has an invalid root entry.');
        continue;
      }
      if (names.has(name)) throw fail('runtime_archive_path', 'The runtime archive repeats an entry path.');
      names.add(name);
      const target = path.join(directory, ...name.split('/'));
      if (type === '5') {
        if (size !== 0) throw fail('runtime_archive_format', 'The runtime archive directory contains unexpected data.');
        await mkdir(target, { recursive: true, mode: 0o700 });
      } else if (type === '0') {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const output = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          for (let remaining = size; remaining > 0;) {
            const chunk = await read(Math.min(64 * 1024, remaining));
            let offset = 0;
            while (offset < chunk.length) {
              cancelled(signal);
              const written = (await output.write(chunk, offset, chunk.length - offset)).bytesWritten;
              if (!written) throw fail('runtime_extract_write', 'The runtime could not be extracted completely.');
              offset += written;
            }
            remaining -= chunk.length;
          }
        } finally { await output.close(); }
        if ((tarNumber(header.subarray(100, 108)) & 0o111) !== 0) await chmod(target, 0o700);
      } else if (type === '2' || type === '1') {
        if (size !== 0 || !linkName || /[\0-\x1f\\:]/.test(linkName) || linkName.startsWith('/')) throw fail('runtime_archive_link', 'The runtime archive has an unsafe link.');
        const destination = path.resolve(type === '1' ? directory : path.dirname(target), linkName);
        if (!inside(directory, destination)) throw fail('runtime_archive_link', 'The runtime archive link leaves its installation directory.');
        links.push({ target, linkName, destination, hard: type === '1' });
      } else throw fail('runtime_archive_type', 'The runtime archive contains an unsupported file type.');
      await read(pad);
    }
    for (const item of links) {
      await mkdir(path.dirname(item.target), { recursive: true, mode: 0o700 });
      if (item.hard) {
        const info = await lstat(item.destination);
        if (!info.isFile() || info.isSymbolicLink()) throw fail('runtime_archive_link', 'The runtime archive hard link does not identify an ordinary file.');
        await link(item.destination, item.target);
      } else await symlink(item.linkName, item.target);
    }
    for (const item of links) {
      const resolved = await realpath(item.target);
      if (!inside(directory, resolved) || !(await lstat(resolved)).isFile()) throw fail('runtime_archive_link', 'The runtime archive link does not resolve to an internal regular file.');
    }
  } finally {
    const closed = Promise.allSettled([finished(input), finished(gunzip)]);
    input.unpipe(gunzip); input.destroy(); gunzip.destroy();
    await iterator.return?.().catch(() => {}); await closed;
    input.removeListener('error', forwardError);
  }
}

async function extractZip(archive, directory, signal) {
  // .NET opens individual entries with CreateNew only after validating their
  // paths, Unix file types and cumulative uncompressed sizes. No shell is used.
  const script = String.raw`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($env:KOTO_RUNTIME_ARCHIVE)
$root=[IO.Path]::GetFullPath($env:KOTO_RUNTIME_STAGE)+[IO.Path]::DirectorySeparatorChar
$total=[long]0
try {
 if($zip.Entries.Count -gt 4096){throw 'Too many archive entries'}
 foreach($e in $zip.Entries){
  $name=$e.FullName
  if($name.Length -gt 2048 -or $name -match '[\\:\x00-\x1f]' -or $name.StartsWith('/') -or ($name.Split('/') -contains '..')){throw 'Unsafe archive path'}
  $target=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$name))
  if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive path leaves installation'}
  $kind=($e.ExternalAttributes -shr 16) -band 61440
  if($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384){throw 'Unsupported archive file type'}
  $total+=$e.Length
  if($total -gt 536870912 -or $e.Length -gt 536870912){throw 'Archive byte limit'}
  if($name.EndsWith('/')){[IO.Directory]::CreateDirectory($target)|Out-Null;continue}
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
  $entryStream=$e.Open();$output=$null
  try{
   $output=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
   $buffer=New-Object byte[] 65536;$written=[long]0
   while(($n=$entryStream.Read($buffer,0,$buffer.Length)) -gt 0){$written+=$n;if($written -gt $e.Length){throw 'Archive size mismatch'};$output.Write($buffer,0,$n)}
   if($written -ne $e.Length){throw 'Truncated archive entry'}
  }finally{if($output){$output.Dispose()};$entryStream.Dispose()}
 }
}finally{$zip.Dispose()}`;
  const command = await resolveAgentExecutable('powershell.exe');
  const handle = await startSetupCommand({ id: 'runtimeExtract', command,
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    env: { ...process.env, KOTO_RUNTIME_ARCHIVE: archive, KOTO_RUNTIME_STAGE: directory },
    timeoutMs: 120_000, signal });
  handle.endInput();
  const result = await handle.completion;
  if (result.error === 'cleanup_unconfirmed') throw fail('runtime_cleanup_unconfirmed', 'The owned archive extractor did not confirm cleanup. Its staging files were retained.');
  if (result.status !== 'succeeded') throw fail('runtime_extract_failed', 'The Windows runtime archive could not be extracted safely. Inspect native platform availability before retrying.');
}

async function inventory(directory, signal, prefix = '', result = []) {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    cancelled(signal);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (name === 'koto-runtime.json') continue;
    safeName(name);
    const filename = path.join(directory, ...name.split('/'));
    const info = await lstat(filename);
    if (!owned(info) || process.platform !== 'win32' && (info.mode & 0o077) !== 0 && !info.isSymbolicLink()) throw fail('runtime_existing_invalid', 'Runtime files must remain private and owned by your account.');
    if (entry.isDirectory()) {
      result.push({ name, type: 'directory' });
      if (result.length > MAX_FILES) throw fail('runtime_archive_limit', 'The runtime has too many entries.');
      await inventory(directory, signal, name, result);
    } else if (entry.isSymbolicLink()) {
      const resolved = await realpath(filename);
      if (!inside(directory, resolved) || !(await lstat(resolved)).isFile()) throw fail('runtime_existing_invalid', 'A runtime link does not resolve to an internal file.');
      result.push({ name, type: 'symlink', target: await readlink(filename) });
    } else if (entry.isFile()) {
      if (result.reduce((sum, item) => sum + (item.bytes ?? 0), info.size) > MAX_EXTRACTED) throw fail('runtime_archive_limit', 'The runtime exceeds its installed byte limit.');
      result.push({ name, type: 'file', ...(await hashFile(filename, { signal })) });
    }
    else throw fail('runtime_existing_invalid', 'The runtime contains an unsupported filesystem entry.');
    if (result.length > MAX_FILES) throw fail('runtime_archive_limit', 'The runtime has too many entries.');
  }
  if (prefix === '' && result.reduce((sum, item) => sum + (item.bytes ?? 0), 0) > MAX_EXTRACTED) throw fail('runtime_archive_limit', 'The runtime exceeds its installed byte limit.');
  return result;
}

async function readReceipt(payload, asset, signal) {
  const payloadInfo = await maybeStat(payload);
  if (!payloadInfo?.isDirectory() || payloadInfo.isSymbolicLink() || !owned(payloadInfo)
    || process.platform !== 'win32' && (payloadInfo.mode & 0o077) !== 0) throw fail('runtime_existing_invalid', 'The installed runtime directory is not recognized. Its files were preserved.');
  const filename = path.join(payload, 'koto-runtime.json');
  const info = await maybeStat(filename);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 2 * MIB || !owned(info)
    || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw fail('runtime_existing_invalid', 'This runtime installation is incomplete or unrecognized. Preserve it and select another runtime directory.');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let receipt;
  try {
    cancelled(signal);
    const buffer = Buffer.alloc(2 * MIB + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 2 * MIB) throw new Error('receipt_size');
    receipt = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  }
  catch { throw fail('runtime_existing_invalid', 'The existing runtime receipt is invalid. Its files were preserved.'); }
  finally { await file.close(); }
  if (receipt.kind !== RECEIPT || receipt.version !== asset.version || receipt.platform !== process.platform
    || receipt.arch !== process.arch || receipt.archiveSha256 !== asset.sha256 || receipt.archiveBytes !== asset.bytes
    || receipt.source !== asset.url || !Array.isArray(receipt.files) || receipt.files.length > MAX_FILES
    || JSON.stringify(receipt.files) !== JSON.stringify(await inventory(payload, signal))) {
    throw fail('runtime_existing_mismatch', 'The installed runtime differs from its pinned receipt. It was preserved; choose another runtime directory.');
  }
  const binary = safeName(receipt.binary);
  const executable = path.join(payload, ...binary.split('/'));
  if (!binary || path.basename(binary) !== (process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')
    || !receipt.files.some(item => item.name === binary && item.type === 'file')
    || process.platform !== 'win32' && ((await lstat(executable)).mode & 0o111) === 0) throw fail('runtime_existing_invalid', 'The runtime receipt does not identify its executable.');
  return { ...receipt, path: executable, executable, directory: payload, receiptPath: filename, reused: true };
}

/** Acquire the pinned publisher runtime for this host without a compiler. */
export async function acquireLlamaRuntime({ directory, signal, onProgress } = {}) {
  const asset = LLAMA_RUNTIME_CATALOG[`${process.platform}-${process.arch}`];
  if (!asset) throw fail('runtime_platform_unavailable', 'No bundled runtime choice is available for this host. Use an existing compatible llama-server.');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');
  return serialized(async () => {
    directory = await privateDirectory(directory);
    const target = path.join(directory, `llama-${asset.version}-${process.platform}-${process.arch}`);
    const payload = path.join(target, 'runtime');
    if (await maybeStat(target)) {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink() || !owned(info)
        || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw fail('runtime_existing_invalid', 'An unrecognized runtime already occupies the selected versioned path.');
      if ((await readdir(target)).length === 0) await rmdir(target); // Only an empty interrupted publication.
      else {
        if (JSON.stringify(await readdir(target)) !== JSON.stringify(['runtime'])) throw fail('runtime_existing_invalid', 'The runtime directory contains unrecognized entries. They were preserved.');
        return readReceipt(payload, asset, signal);
      }
    }
    await reserveDisk(directory, asset.bytes + MAX_EXTRACTED + 64 * MIB);
    const lockPath = `${target}.lock`;
    let lock, stage, cleanupUnconfirmed = false, targetCreated = false;
    const bounded = AbortSignal.any([AbortSignal.timeout(600_000), ...(signal ? [signal] : [])]);
    try {
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw fail('runtime_install_busy', 'This runtime is being installed by another Koto process. Let it finish before retrying.');
        throw error;
      }
      stage = await mkdtemp(path.join(directory, '.llama-download-'));
      const archive = path.join(stage, asset.filename), extracted = path.join(stage, 'runtime');
      await mkdir(extracted, { mode: 0o700 });
      await downloadArchive(asset, archive, bounded, onProgress);
      await notify(onProgress, { type: 'runtime-extract', version: asset.version }, bounded);
      if (asset.filename.endsWith('.zip')) await extractZip(archive, extracted, bounded);
      else await extractTar(archive, extracted, bounded);
      const files = await inventory(extracted, bounded);
      const binaries = files.filter(item => item.type === 'file' && path.posix.basename(item.name)
        === (process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'));
      if (binaries.length !== 1) throw fail('runtime_binary_missing', 'The publisher archive did not contain one unambiguous llama-server executable.');
      const binary = binaries[0].name;
      if (process.platform !== 'win32' && (binaries[0].mode & 0o111) === 0) throw fail('runtime_binary_missing', 'The publisher runtime did not mark llama-server executable.');
      const receipt = { kind: RECEIPT, version: asset.version, commit: asset.commit, platform: process.platform,
        arch: process.arch, source: asset.url, archiveSha256: asset.sha256, archiveBytes: asset.bytes,
        binary, files, installedAt: new Date().toISOString() };
      await writeFile(path.join(extracted, 'koto-runtime.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      cancelled(bounded);
      await mkdir(target, { mode: 0o700 }); targetCreated = true;
      await rename(extracted, payload); // Target directory was created exclusively; no existing assets are replaced.
      return { ...receipt, path: path.join(payload, ...binary.split('/')),
        executable: path.join(payload, ...binary.split('/')), directory: payload,
        receiptPath: path.join(payload, 'koto-runtime.json'), reused: false };
    } catch (error) {
      cleanupUnconfirmed = error.code === 'runtime_cleanup_unconfirmed';
      if (cleanupUnconfirmed) throw error;
      if (bounded.aborted) throw fail('runtime_install_cancelled', 'Runtime setup was interrupted or reached its deadline. Its incomplete download was removed; existing installations were preserved.');
      throw error;
    } finally {
      if (stage && !cleanupUnconfirmed) await rm(stage, { recursive: true, force: true });
      if (targetCreated) await rmdir(target).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
      if (lock) { await lock.close(); if (!cleanupUnconfirmed) await unlink(lockPath); }
    }
  }, signal);
}
