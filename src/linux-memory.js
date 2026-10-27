import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { throwOnResourceExhaustion } from './bounded-fetch.js';

const PROC_CGROUP = '/proc/self/cgroup';
const PROC_MOUNTS = '/proc/self/mountinfo';
const MAX_DEPTH = 64;
const MAX_U64 = (1n << 64n) - 1n;
const decoder = new TextDecoder('utf-8', { fatal: true });
const unavailable = () => Object.assign(new Error(
  'Linux effective-memory metrics could not be read safely. Check visibility of the process memory controller and available-memory metrics before retrying.'),
{ code: 'local_memory_metrics_unavailable' });

/** Fixed actual kernel interfaces only. Every query has byte/file/depth limits;
 * no file descriptor survives a read, including malformed or oversized files.
 */
function readKernelFile(filename, limit, budget, optional = false) {
  if (--budget.files < 0) throw unavailable();
  let fd;
  try {
    fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) throw unavailable();
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    budget.bytes -= bytes;
    if (bytes > limit || budget.bytes < 0) throw unavailable();
    return decoder.decode(buffer.subarray(0, bytes));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

function absoluteKernelPath(value) {
  if (!value || value.includes('\0') || Buffer.byteLength(value) > 4096
    || !path.posix.isAbsolute(value) || path.posix.normalize(value) !== value
    || value.split('/').some(part => part === '..' || part === '.')) throw unavailable();
  return value;
}

function mountPath(value) {
  if (/\\(?!040|011|012|134)/.test(value)) throw unavailable();
  return absoluteKernelPath(value.replace(/\\(040|011|012|134)/g,
    (_, octal) => String.fromCharCode(Number.parseInt(octal, 8))));
}

const beneath = (root, value) => value === root || value.startsWith(root === '/' ? '/' : root + '/');

function membership(source) {
  // A cgroup name may end in spaces. Remove the record terminator, never
  // significant path whitespace that could select a different sibling group.
  const records = source.endsWith('\n') ? source.slice(0, -1) : source;
  const lines = records === '' ? [] : records.split('\n');
  if (lines.length > 256) throw unavailable();
  let memory, unified;
  for (const line of lines) {
    const match = /^(\d+):([^:]*):(.*)$/.exec(line);
    if (!match) throw unavailable();
    if (match[1] === '0' && match[2] === '') {
      if (unified) throw unavailable();
      unified = { version: 2, path: absoluteKernelPath(match[3]) };
    } else if (match[2].split(',').includes('memory')) {
      if (memory) throw unavailable();
      memory = { version: 1, path: absoluteKernelPath(match[3]) };
    }
  }
  // A controller is bound to only one hierarchy. In hybrid setups, an explicit
  // v1 memory membership takes precedence over an unrelated unified hierarchy.
  return memory ?? unified;
}

function hierarchy(member, source) {
  const candidates = [];
  const lines = source.trimEnd().split('\n');
  if (lines.length > 8192) throw unavailable();
  for (const line of lines) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    if (separator < 6 || fields.length < separator + 4) throw unavailable();
    const filesystem = fields[separator + 1];
    if (member.version === 2 ? filesystem !== 'cgroup2'
      : filesystem !== 'cgroup' || !fields[separator + 3].split(',').includes('memory')) continue;
    const root = mountPath(fields[3]), point = mountPath(fields[4]);
    if (!beneath(root, member.path)) continue;
    const relative = path.posix.relative(root, member.path);
    candidates.push({ root, point, directory: path.posix.join(point, relative) });
    if (candidates.length > 64) throw unavailable();
  }
  // Use the widest mounted view of the matching hierarchy so every visible
  // ancestor is sampled; bind mounts of a lower subtree must not hide a cap.
  candidates.sort((left, right) => left.root.length - right.root.length || left.point.localeCompare(right.point));
  if (!candidates.length) throw unavailable();
  return candidates[0];
}

function counter(source, allowMax = false) {
  const value = source?.trim();
  if (allowMax && value === 'max') return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,19})$/.test(value)) throw unavailable();
  const bytes = BigInt(value);
  if (bytes > MAX_U64) throw unavailable();
  return bytes;
}

function clampPhysical(value, physical) {
  return value === null ? null : Number(value > physical ? physical : value);
}

function cgroupMemory(physicalTotalBytes, budget) {
  const before = readKernelFile(PROC_CGROUP, 64 * 1024, budget);
  const member = membership(before);
  if (!member) return { totalBytes: physicalTotalBytes };
  const mount = hierarchy(member, readKernelFile(PROC_MOUNTS, 1024 * 1024, budget));
  const physical = BigInt(physicalTotalBytes);
  let directory = mount.directory, ancestorsChecked = 0, memoryGroupsChecked = 0, constrainedGroups = 0;
  let minimumLimit = null, minimumRemaining = null, leafUsage = null, limitingUsage = null;
  for (;;) {
    if (++ancestorsChecked > MAX_DEPTH) throw unavailable();
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) throw unavailable();
    const limitFile = member.version === 2 ? 'memory.max' : 'memory.limit_in_bytes';
    const usageFile = member.version === 2 ? 'memory.current' : 'memory.usage_in_bytes';
    const limitSource = readKernelFile(path.posix.join(directory, limitFile), 128, budget, true);
    if (limitSource === undefined) {
      const trueRoot = directory === mount.point && mount.root === '/';
      if (!trueRoot) {
        // Threaded/inactive v2 subgroups may have no memory interface of their
        // own. Their parent still accounts for them and is sampled next.
        if (member.version !== 2) throw unavailable();
        const controllers = readKernelFile(path.posix.join(directory, 'cgroup.controllers'), 4096, budget).trim().split(/\s+/);
        if (controllers.includes('memory')
          || readKernelFile(path.posix.join(directory, usageFile), 128, budget, true) !== undefined) throw unavailable();
      }
    } else {
      const limit = counter(limitSource, member.version === 2);
      const usage = counter(readKernelFile(path.posix.join(directory, usageFile), 128, budget));
      // Usage must be exactly representable in diagnostics. Limits use BigInt
      // so v1's large kernel unlimited sentinel is accepted without rounding.
      if (usage > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
      if (ancestorsChecked === 1) leafUsage = usage;
      memoryGroupsChecked += 1;
      if (limit !== null) {
        if (limit < physical) constrainedGroups += 1;
        if (minimumLimit === null || limit < minimumLimit) minimumLimit = limit;
        const remaining = limit > usage ? limit - usage : 0n;
        if (minimumRemaining === null || remaining < minimumRemaining) {
          minimumRemaining = remaining;
          limitingUsage = usage;
        }
      }
    }
    if (directory === mount.point) break;
    const parent = path.posix.dirname(directory);
    if (parent === directory || !beneath(mount.point, parent)) throw unavailable();
    directory = parent;
  }
  if (readKernelFile(PROC_CGROUP, 64 * 1024, budget) !== before) throw unavailable();
  return {
    totalBytes: minimumLimit === null ? physicalTotalBytes : Number(minimumLimit < physical ? minimumLimit : physical),
    cgroup: {
      version: member.version, ancestorsChecked, memoryGroupsChecked, constrainedGroups,
      // Limit/headroom diagnostics are capped at physical capacity. This keeps
      // huge v1 unlimited sentinels numeric and does not invent free memory.
      limitBytes: clampPhysical(minimumLimit, physical),
      remainingBytes: clampPhysical(minimumRemaining, physical),
      usageBytes: leafUsage === null ? null : Number(leafUsage),
      limitingUsageBytes: limitingUsage === null ? null : Number(limitingUsage),
    },
  };
}

function query(operation) {
  try { return operation({ files: 256, bytes: 2 * 1024 * 1024 }); }
  catch (error) {
    throwOnResourceExhaustion(error);
    if (error.code === 'local_memory_metrics_unavailable') throw error;
    throw unavailable();
  }
}

/** All ancestors visible through the process's cgroup mount are included. Host
 * ancestors hidden outside its cgroup namespace cannot be observed here.
 */
export function readLinuxMemoryCapacity(physicalTotalBytes) {
  return query(budget => cgroupMemory(physicalTotalBytes, budget).totalBytes);
}

export function readLinuxMemorySnapshot(physicalTotalBytes, rawFreeBytes) {
  return query(budget => {
    const constrained = cgroupMemory(physicalTotalBytes, budget);
    const info = readKernelFile('/proc/meminfo', 64 * 1024, budget);
    const available = [...info.matchAll(/^MemAvailable:\s+([0-9]+) kB\r?$/gm)];
    if (available.length !== 1) throw unavailable();
    const availableBytes = counter(available[0][1]) * 1024n;
    if (availableBytes > BigInt(physicalTotalBytes)) throw unavailable();
    return { ...constrained, physicalTotalBytes, rawFreeBytes,
      availableBytes: Math.min(Number(availableBytes), constrained.totalBytes,
        constrained.cgroup?.remainingBytes ?? physicalTotalBytes),
      source: constrained.cgroup ? `linux-memavailable-cgroup-v${constrained.cgroup.version}` : 'linux-memavailable',
    };
  });
}
