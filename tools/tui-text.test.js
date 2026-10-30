import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  terminalText, graphemes, cellWidth, clipText, wrapText, fuzzyScore,
} from '../bin/tui-text.js';

describe('terminalText', () => {
  it('strips terminal escape sequences', () => {
    assert.equal(terminalText('\x1b[31mhi\x1b[0m'), 'hi');
  });
  it('strips directional overrides', () => {
    assert.equal(terminalText('a\u202eb'), 'ab');
  });
  it('strips OSC payloads and control characters', () => {
    assert.equal(terminalText('a\x07b\x00c'), 'abc');
  });
  it('normalizes tabs and line endings', () => {
    assert.equal(terminalText('a\tb\r\nc'), 'a  b\nc');
  });
  it('joins lines when multiline is disabled', () => {
    assert.equal(terminalText('a\nb', { multiline: false }), 'a b');
  });
  it('coerces nullish and non-string input', () => {
    assert.equal(terminalText(null), '');
    assert.equal(terminalText(undefined), '');
    assert.equal(terminalText(123), '123');
  });
});

describe('graphemes and cellWidth', () => {
  it('segments combining marks with their base', () => {
    assert.equal(graphemes('é').length, 1);
    assert.equal(cellWidth('é'), 1);
  });
  it('measures ASCII, wide, pictographic and flag cells', () => {
    assert.equal(cellWidth('abc'), 3);
    assert.equal(cellWidth('あ'), 2);
    assert.equal(cellWidth('👍'), 2);
    assert.equal(cellWidth('🇺🇸'), 2);
  });
});

describe('clipText', () => {
  it('truncates with an ellipsis', () => {
    assert.equal(clipText('hello world', 5), 'hell…');
  });
  it('returns short text unchanged', () => {
    assert.equal(clipText('hi', 5), 'hi');
  });
  it('returns empty for non-positive widths', () => {
    assert.equal(clipText('hello', 0), '');
  });
  it('never splits a wide grapheme', () => {
    assert.equal(clipText('あいう', 2), '…');
  });
});

describe('wrapText', () => {
  it('wraps on word boundaries', () => {
    assert.deepEqual(wrapText('aa bb cc', 4), ['aa', 'bb', 'cc']);
  });
  it('splits words longer than the width', () => {
    assert.deepEqual(wrapText('abcdefgh', 3), ['abc', 'def', 'gh']);
  });
  it('keeps empty paragraphs', () => {
    assert.deepEqual(wrapText('a\n\nb', 10), ['a', '', 'b']);
  });
});

describe('fuzzyScore', () => {
  it('scores empty queries zero and misses -1', () => {
    assert.equal(fuzzyScore('', 'abc'), 0);
    assert.equal(fuzzyScore('xyz', 'abc'), -1);
  });
  it('prefers contiguous and boundary matches', () => {
    assert.ok(fuzzyScore('ins', 'inspect') > fuzzyScore('ins', 'xixnxsxx'));
    assert.ok(fuzzyScore('c', '/c') > fuzzyScore('c', 'ac'));
  });
  it('matches case-insensitively', () => {
    assert.equal(fuzzyScore('CHAT', 'chat now'), fuzzyScore('chat', 'chat now'));
  });
});
