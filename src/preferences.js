import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaultStateDirectory = process.env.KOTO_STATE_DIR && path.isAbsolute(process.env.KOTO_STATE_DIR)
  ? process.env.KOTO_STATE_DIR : path.join(homedir(), '.koto');

/** Local product choices only. Native credentials remain with their CLI. */
export async function loadPreferences({ directory = defaultStateDirectory } = {}) {
  const filename = path.join(directory, 'preferences.json');
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw new Error('Invalid Koto preferences file.');
    const result = JSON.parse(await readFile(filename, 'utf8'));
    if (!result || result.schemaVersion !== 1 || typeof result !== 'object' || Array.isArray(result)) throw new Error('Unsupported Koto preferences.');
    return result;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, workers: [] };
    throw error;
  }
}

export async function savePreferences(preferences, { directory = defaultStateDirectory } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32'
      && ((info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())))) {
    throw new Error('Koto preferences need a private directory owned by your account.');
  }
  const bytes = `${JSON.stringify({ ...preferences, schemaVersion: 1 }, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > 128 * 1024) throw new Error('Koto preferences are too large.');
  const temporary = path.join(directory, `.preferences-${randomUUID()}.json`);
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path.join(directory, 'preferences.json'));
}
