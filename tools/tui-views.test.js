import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planItems, taskItems, diffItems, formatCompletion, formatError,
} from '../bin/tui-views.js';

const task = (id, extra = {}) => ({ id, task: `do ${id}`, ...extra });

describe('planItems', () => {
  it('maps tasks to picker items', () => {
    const [item] = planItems({ tasks: [task('a', { label: 'worker-a', dependsOn: ['b'] })] });
    assert.equal(item.value, 'a');
    assert.ok(item.label.startsWith('1. a'));
    assert.ok(item.description.includes('after b'));
  });
  it('returns no items for a missing task list', () => {
    assert.deepEqual(planItems({}), []);
  });
  it('rejects plans over eight tasks without a partial display', () => {
    const tasks = Array.from({ length: 9 }, (_, index) => task(`t${index}`));
    assert.throws(() => planItems({ tasks }), RangeError);
  });
});

describe('taskItems', () => {
  it('maps agent state to picker items', () => {
    const [item] = taskItems({ agents: [{ id: 'w1', status: 'running', task: 'build', activity: { description: 'compiling' } }] });
    assert.equal(item.value, 'w1');
    assert.ok(item.label.includes('running'));
    assert.ok(item.detail.includes('compiling'));
  });
  it('rejects lists over 32 agents without a partial display', () => {
    const agents = Array.from({ length: 33 }, (_, index) => ({ id: `w${index}`, status: 'pending' }));
    assert.throws(() => taskItems({ agents }), RangeError);
  });
});

describe('diffItems', () => {
  it('marks non-textual diffs unavailable', () => {
    const [item] = diffItems(undefined);
    assert.equal(item.value, '__diff_unavailable__');
  });
  it('marks empty diffs explicitly', () => {
    const [item] = diffItems('');
    assert.equal(item.value, '__diff_empty__');
  });
  it('summarizes per-file additions and removals', () => {
    const raw = 'diff --git a/one.js b/one.js\n--- a/one.js\n+++ b/one.js\n+new\n-old\n'
      + 'diff --git a/two.js b/two.js\n--- a/two.js\n+++ b/two.js\n+more\n';
    const items = diffItems(raw);
    assert.equal(items[0].value, '__diff_summary__');
    assert.ok(items[0].description.includes('2 of 2'));
    assert.equal(items[1].label, 'one.js');
    assert.ok(items[1].description.includes('+1'));
    assert.ok(items[1].description.includes('−1'));
  });
  it('omits file sections past the display limit', () => {
    const raw = Array.from({ length: 300 }, (_, index) =>
      `diff --git a/f${index}.js b/f${index}.js\n--- a/f${index}.js\n+++ b/f${index}.js\n+x\n`).join('');
    const items = diffItems(raw);
    assert.ok(items.some((item) => item.value === '__diff_omitted__'));
    assert.ok(items[0].description.includes('omitted'));
  });
});

describe('formatCompletion', () => {
  it('counts agent outcomes', () => {
    const text = formatCompletion({ agents: [
      { id: 'a', status: 'succeeded' },
      { id: 'b', status: 'succeeded' },
      { id: 'c', status: 'failed', result: { error: 'boom' } },
    ] });
    assert.ok(text.includes('Agents: 2/3 succeeded; 1 failed'));
    assert.ok(text.includes('c: boom'));
  });
  it('says when changed files are unreported', () => {
    assert.ok(formatCompletion({}).includes('Changed files: not reported in this result.'));
  });
  it('truncates long verification records', () => {
    const verification = Array.from({ length: 33 }, (_, index) => `check ${index}`);
    assert.ok(formatCompletion({ verification }).includes('32 of 33 records shown'));
  });
});

describe('formatError', () => {
  it('maps socket exhaustion to capacity guidance', () => {
    assert.ok(formatError({ code: 'socket_exhausted' }).includes('Stop new requests'));
  });
  it('maps credential failures to the accounts surface', () => {
    assert.ok(formatError({ code: 'x', message: 'login required' }).includes('/accounts'));
  });
  it('falls back to explicit retry guidance', () => {
    const text = formatError({ code: 'mystery', message: 'odd failure' });
    assert.ok(text.includes('mystery'));
    assert.ok(text.includes('retry explicitly'));
  });
});
