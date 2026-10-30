import { stripVTControlCharacters } from 'node:util';

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Terminal text is data. Never let file names, model output or pasted text
 * inject terminal control sequences, directional overrides or OSC payloads. */
export function terminalText(value, { multiline = true } = {}) {
  const sanitized = stripVTControlCharacters(String(value ?? ''))
    .replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
  return multiline ? sanitized : sanitized.replace(/\n/g, ' ');
}

export function graphemes(text) {
  return [...segments.segment(String(text))].map(part => ({ text: part.segment, index: part.index }));
}

export function cellWidth(text) {
  let cells = 0;
  for (const part of segments.segment(stripVTControlCharacters(String(text)))) {
    let size = 0;
    for (const character of part.segment) {
      const cp = character.codePointAt(0);
      if (/[\p{Mark}\p{Format}\p{Control}]/u.test(character)) continue;
      const wide = /\p{Extended_Pictographic}/u.test(character)
        || cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a
          || cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7a3
          || cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f
          || cp >= 0xff00 && cp <= 0xff60 || cp >= 0xffe0 && cp <= 0xffe6
          || cp >= 0x20000 && cp <= 0x3fffd);
      size = Math.max(size, wide ? 2 : 1);
    }
    // A regional-indicator pair is one flag occupying two terminal cells.
    if (/\p{Regional_Indicator}/u.test(part.segment)) size = 2;
    cells += size;
  }
  return cells;
}

export function clipText(value, width, ellipsis = '…') {
  const text = terminalText(value, { multiline: false });
  if (width <= 0) return '';
  if (cellWidth(text) <= width) return text;
  const ending = cellWidth(ellipsis) <= width ? ellipsis : '';
  let result = '', used = 0;
  for (const part of graphemes(text)) {
    const size = cellWidth(part.text);
    if (used + size > width - cellWidth(ending)) break;
    used += size;
    result += part.text;
  }
  return result + ending;
}

export function wrapText(value, width) {
  width = Math.max(1, width);
  const result = [];
  for (const paragraph of terminalText(value).split('\n')) {
    if (!paragraph) { result.push(''); continue; }
    let line = '';
    for (const word of paragraph.match(/\S+\s*|\s+/g) ?? []) {
      if (cellWidth(line + word) <= width) { line += word; continue; }
      if (line.trimEnd()) { result.push(line.trimEnd()); line = ''; }
      for (const part of graphemes(word.trimStart())) {
        if (cellWidth(line + part.text) > width && line) { result.push(line); line = ''; }
        line += part.text;
      }
    }
    result.push(line.trimEnd());
  }
  return result;
}

export function fuzzyScore(query, value) {
  query = terminalText(query, { multiline: false }).toLocaleLowerCase();
  value = terminalText(value, { multiline: false }).toLocaleLowerCase();
  if (!query) return 0;
  let at = 0, score = 0, previous = -2;
  for (const letter of query) {
    const found = value.indexOf(letter, at);
    if (found === -1) return -1;
    score += found === previous + 1 ? 8 : 1;
    if (found === 0 || /[\s/_.:-]/.test(value[found - 1])) score += 5;
    score -= Math.min(10, found - at);
    previous = found;
    at = found + letter.length;
  }
  return score - value.length / 1000;
}
