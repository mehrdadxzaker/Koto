import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const integrity = JSON.parse(await fs.readFile(path.join(root, 'core-integrity.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const source = path.join(root, 'node_modules', '@mehrdadz', 'koto');
const dist = path.join(root, 'dist');
const destination = path.join(dist, 'core');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

requireCondition(integrity.schemaVersion === 1 && integrity.package === '@mehrdadz/koto', 'Unsupported Koto core integrity manifest.');
requireCondition(integrity.version === '3.0.0-alpha.1' && manifest.dependencies?.[integrity.package] === integrity.version,
  'The production dependency must match the frozen Koto core version.');
requireCondition(Array.isArray(integrity.payloads) && integrity.payloads.length === 54, 'Expected all 54 frozen Koto payloads.');

const expected = new Map();
for (const entry of integrity.payloads) {
  requireCondition(typeof entry.path === 'string' && entry.path !== '' && entry.path === path.posix.normalize(entry.path)
    && !path.posix.isAbsolute(entry.path) && !entry.path.includes('\\') && !entry.path.includes('\0')
    && !entry.path.split('/').includes('..') && !expected.has(entry.path), 'Invalid or duplicate Koto payload path.');
  requireCondition(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 2 * 1024 * 1024
    && /^[0-9a-f]{64}$/.test(entry.sha256) && /^0[0-7]{3}$/.test(entry.mode), `Invalid integrity metadata for ${entry.path}.`);
  expected.set(entry.path, entry);
}

async function existing(target) {
  try { return await fs.lstat(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function requireDirectory(target) {
  const stat = await fs.lstat(target);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), `Expected a regular directory: ${target}`);
}

async function verifyPayloads(directory) {
  await requireDirectory(directory);
  const found = new Map();
  async function visit(current, prefix = '') {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(current, entry.name);
      requireCondition(!entry.isSymbolicLink(), `Koto payload must not be a symbolic link: ${relative}`);
      if (entry.isDirectory()) await visit(target, relative);
      else {
        requireCondition(entry.isFile() && expected.has(relative), `Unexpected Koto payload: ${relative}`);
        const wanted = expected.get(relative);
        const stat = await fs.lstat(target);
        const bytes = await fs.readFile(target);
        requireCondition(stat.isFile() && !stat.isSymbolicLink() && bytes.length === wanted.bytes
          && createHash('sha256').update(bytes).digest('hex') === wanted.sha256,
        `Koto payload integrity mismatch: ${relative}. Run npm ci before rebuilding.`);
        // Windows does not expose POSIX permission bits; publication verifies them on macOS.
        if (process.platform !== 'win32') requireCondition((stat.mode & 0o777) === Number.parseInt(wanted.mode, 8),
          `Koto payload permission mismatch: ${relative}`);
        found.set(relative, true);
      }
    }
  }
  await visit(directory);
  requireCondition(found.size === expected.size && [...expected.keys()].every(name => found.has(name)),
    'The Koto package is missing a frozen payload. Run npm ci before rebuilding.');
}

const sourceMetadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
requireCondition(sourceMetadata.name === integrity.package && sourceMetadata.version === integrity.version,
  'Installed Koto dependency does not match the frozen release.');
await verifyPayloads(source);

const distStat = await existing(dist);
if (distStat) await requireDirectory(dist);
else await fs.mkdir(dist, { mode: 0o755 });
const temporary = await fs.mkdtemp(path.join(dist, '.core-stage-'));
let backup;
let promoted = false;
try {
  for (const entry of integrity.payloads) {
    const target = path.join(temporary, ...entry.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await fs.copyFile(path.join(source, ...entry.path.split('/')), target,
      constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    await fs.chmod(target, Number.parseInt(entry.mode, 8));
  }
  await verifyPayloads(temporary);
  if (await existing(destination)) {
    await requireDirectory(destination);
    backup = path.join(dist, `.core-previous-${randomUUID()}`);
    await fs.rename(destination, backup);
  }
  try {
    await fs.rename(temporary, destination);
    promoted = true;
  } catch (error) {
    if (backup) { await fs.rename(backup, destination); backup = undefined; }
    throw error;
  }
} finally {
  if (!promoted) await fs.rm(temporary, { recursive: true, force: true });
  if (promoted && backup) await fs.rm(backup, { recursive: true });
}

console.log(JSON.stringify({ package: integrity.package, version: integrity.version,
  payloadFiles: expected.size, archiveSha256: integrity.archive.sha256, output: 'dist/core' }));
