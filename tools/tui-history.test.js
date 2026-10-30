import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPromptHistory, savePromptHistory, clearPromptHistory } from '../bin/tui-history.js';

let directory;
let project;
let savedEnv;

beforeEach(async () => {
  savedEnv = process.env.KOTO_NO_HISTORY;
  delete process.env.KOTO_NO_HISTORY;
  directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), 'koto-history-')));
  await chmod(directory, 0o700);
  project = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), 'koto-project-')));
  await chmod(project, 0o700);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.KOTO_NO_HISTORY;
  else process.env.KOTO_NO_HISTORY = savedEnv;
});

describe('prompt history', () => {
  it('round-trips saved prompts', async () => {
    await savePromptHistory(['hello', 'world'], { project, directory });
    assert.deepEqual(await loadPromptHistory({ project, directory }), ['hello', 'world']);
  });
  it('returns empty when nothing was saved', async () => {
    assert.deepEqual(await loadPromptHistory({ project, directory }), []);
  });
  it('filters invalid messages instead of storing them', async () => {
    await savePromptHistory(['kept', '', '   ', 'x'.repeat(33 * 1024)], { project, directory });
    assert.deepEqual(await loadPromptHistory({ project, directory }), ['kept']);
  });
  it('keeps only the most recent 200 prompts', async () => {
    const messages = Array.from({ length: 205 }, (_, index) => `prompt ${index}`);
    await savePromptHistory(messages, { project, directory });
    const loaded = await loadPromptHistory({ project, directory });
    assert.equal(loaded.length, 200);
    assert.equal(loaded[0], 'prompt 5');
    assert.equal(loaded[199], 'prompt 204');
  });
  it('clears stored prompts', async () => {
    await savePromptHistory(['hello'], { project, directory });
    await clearPromptHistory({ project, directory });
    assert.deepEqual(await loadPromptHistory({ project, directory }), []);
  });
  it('stays disabled under KOTO_NO_HISTORY', async () => {
    process.env.KOTO_NO_HISTORY = '1';
    await savePromptHistory(['hello'], { project, directory });
    assert.deepEqual(await loadPromptHistory({ project, directory }), []);
  });
});
