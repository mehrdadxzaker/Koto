import { createInterface, emitKeypressEvents } from 'node:readline';
import { cellWidth, clipText, fuzzyScore, graphemes, terminalText, wrapText } from './tui-text.js';

const DRAFT_LIMIT = 32 * 1024;
const HISTORY_LIMIT = 200;
const ITEM_LIMIT = 2000;
const cancelled = () => Object.assign(new Error('Conversation closed.'), { code: 'chat_cancelled' });
const boundedDraft = value => {
  const clean = terminalText(value);
  let bytes = 0, result = '';
  for (const part of graphemes(clean)) {
    const next = Buffer.byteLength(part.text);
    if (bytes + next > DRAFT_LIMIT) break;
    result += part.text; bytes += next;
  }
  return result;
};
const validItems = items => Array.isArray(items) ? items.slice(0, ITEM_LIMIT)
  .filter(item => item && typeof item === 'object' && typeof item.label === 'string') : [];

/** One owner for the inline terminal input block. clear()/redraw() hand cursor
 * ownership to activity/output rendering without consuming terminal history.
 * No screen, terminal profile, font, shell integration or clipboard is changed. */
export function createTerminalInput({ write, signal, onInterrupt, onBusyLine,
  onBusyTyping, onBusyInputIdle, onClose, suggest, getStatus, plain,
  stream = process.stdout, input = process.stdin } = {}) {
  if (typeof write !== 'function') throw new TypeError('Terminal input requires write().');
  const isPlain = plain === true || process.env.KOTO_PLAIN === '1'
    || process.env.KOTO_SCREEN_READER === '1' || process.env.TERM === 'dumb'
    || input.isTTY !== true || stream.isTTY !== true || typeof input.setRawMode !== 'function';
  if (isPlain) return plainInput({ write, signal, onInterrupt, onBusyLine, onClose, input, stream });

  const colour = process.env.NO_COLOR === undefined;
  const ascii = process.env.KOTO_ASCII === '1';
  const frame = ascii ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', selected: '>' }
    : { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', selected: '›' };
  const ink = (value, code) => colour ? `\x1b[${code}m${value}\x1b[0m` : value;
  const wasRaw = input.isRaw === true;
  const wasFlowing = input.readableFlowing;
  let closed = false, active = false, pending, modal, draft = '', cursor = 0;
  let label = 'You>', completion = false, menu = [], menuIndex = 0;
  let dismissedAt, suggestionEpoch = 0, suggestionController, suggestionLoading = false, paste = false, pasteText = '';
  let history = [], historyIndex = 0, historyDraft = '', historySearch;
  let rendered = [], renderedCursor = { row: 0, column: 0 }, renderedColumns = 0;
  let statusOverride, notice = '';
  const columns = () => Math.max(8, Math.min(500, (Number.isInteger(stream.columns) ? stream.columns : 80) - 1));
  const rows = () => Math.max(3, Math.min(200, Number.isInteger(stream.rows) ? stream.rows : 24));

  function clear() {
    if (!rendered.length) return;
    const currentWidth = columns() + 1;
    let top = renderedCursor.row;
    if (renderedColumns && currentWidth < renderedColumns) {
      top = rendered.slice(0, renderedCursor.row).reduce((count, line) =>
        count + Math.max(1, Math.ceil(cellWidth(line) / currentWidth)), 0)
        + Math.floor(renderedCursor.column / currentWidth);
    }
    write(`${top ? `\x1b[${top}A` : ''}\r\x1b[J`);
    rendered = []; renderedCursor = { row: 0, column: 0 };
  }

  function draw(lines, row, column) {
    clear();
    if (closed || !active) return;
    const maximum = Math.max(1, rows() - 1);
    lines = lines.slice(0, maximum).map(line => {
      // Fixed decoration owns ANSI. All caller-controlled text was sanitized
      // before formatting, and no rendered line reaches the wrapping column.
      return cellWidth(line) > columns() ? clipText(line, columns(), ascii ? '...' : '…') : line;
    });
    row = Math.max(0, Math.min(lines.length - 1, row));
    column = Math.max(0, Math.min(columns() - 1, column));
    write(lines.join('\r\n'));
    const up = lines.length - 1 - row;
    write(`${up ? `\x1b[${up}A` : ''}\r${column ? `\x1b[${column}C` : ''}`);
    rendered = lines; renderedCursor = { row, column }; renderedColumns = columns() + 1;
  }

  function inputLayout(width) {
    const lines = [''];
    let line = 0, used = 0, point = { row: 0, column: 0 };
    for (const part of graphemes(draft)) {
      if (part.index === cursor) point = { row: line, column: used };
      if (part.text === '\n') { lines.push(''); line += 1; used = 0; continue; }
      const size = cellWidth(part.text);
      if (used + size > width && used) { lines.push(''); line += 1; used = 0; }
      if (part.index === cursor) point = { row: line, column: used };
      lines[line] += part.text; used += size;
    }
    if (cursor === draft.length) point = { row: line, column: used };
    // Leave a cursor cell at an exact line boundary instead of writing onto
    // the right-hand frame or triggering terminal autowrap.
    if (point.column >= width && cursor === draft.length) {
      lines.push(''); point = { row: lines.length - 1, column: 0 };
    }
    return { lines, point };
  }

  function selectedHistory() {
    if (!historySearch) return [];
    return history.slice().reverse().map(value => ({ value, label: value.split('\n')[0], description: value }))
      .map((item, order) => ({ item, order, score: fuzzyScore(historySearch.query, item.value) }))
      .filter(entry => entry.score >= 0).sort((a, b) => b.score - a.score || a.order - b.order).map(entry => entry.item);
  }

  function displayItems(items, index, count, { multiple, selected } = {}) {
    const start = Math.max(0, Math.min(items.length - count, index - Math.floor(count / 2)));
    return items.slice(start, start + count).map((item, offset) => {
      const focused = start + offset === index;
      const check = multiple ? selected.has(item.value) ? '[x] ' : '[ ] ' : '';
      const prefix = `${focused ? frame.selected : ' '} ${check}`;
      const text = clipText(`${prefix}${item.label}${item.disabled ? ' [unavailable]' : ''}`, columns());
      return focused ? ink(text, item.disabled ? '2' : '36') : item.disabled ? ink(text, '2') : text;
    });
  }

  function modalItems() {
    if (!modal) return [];
    const filtered = modal.items.map((item, order) => ({ item, order,
      score: fuzzyScore(modal.query, `${item.label} ${item.description ?? ''}`) }))
      .filter(entry => entry.score >= 0).sort((a, b) => b.score - a.score || a.order - b.order).map(entry => entry.item);
    if (modal.allowCustom && modal.query.trim()) filtered.push({ value: modal.query.trim(), label: `Use typed answer: ${modal.query.trim()}`, custom: true });
    return filtered;
  }

  function redraw() {
    if (closed || !active) return;
    if (modal) {
      const items = modalItems();
      modal.index = Math.max(0, Math.min(items.length - 1, modal.index));
      // A tiny terminal must retain the focused choice and its exit controls.
      // Drop decoration/filter/detail before these essential interaction rows.
      if (rows() <= 7) {
        const budget = Math.max(2, rows() - 1);
        const lines = [];
        if (budget >= 3) lines.push(ink(clipText(modal.title, columns()), '1'));
        const filterRow = lines.length;
        if (budget >= 4) lines.push(clipText(`Filter> ${modal.query}`, columns()));
        const count = Math.max(1, budget - lines.length - 1);
        lines.push(...(items.length ? displayItems(items, modal.index, count, modal)
          : [ink('No matches', '2')]));
        lines.push(ink(clipText(`Enter ${modal.multiple ? 'confirm' : 'select'} · Esc back · ${ascii ? 'Up/Down' : '↑/↓'}${modal.multiple ? ' · Space toggle' : ''}`, columns()), '2'));
        draw(lines, budget >= 4 ? filterRow : Math.min(lines.length - 2, filterRow),
          budget >= 4 ? Math.min(columns() - 1, cellWidth(`Filter> ${modal.query}`)) : 0);
        return;
      }
      const lines = wrapText(modal.title, columns()).slice(0, 2).map(line => ink(line, '1'));
      const filter = `Filter> ${modal.query}`;
      const filterRow = lines.length;
      lines.push(clipText(filter, columns()));
      const capacity = Math.max(1, Math.min(7, rows() - lines.length - (modal.expanded ? 7 : 4)));
      lines.push(...displayItems(items, modal.index, capacity, modal));
      if (!items.length) lines.push(ink('  No matches. Esc returns.', '2'));
      const selected = items[modal.index];
      if (selected?.description && !modal.expanded) lines.push(ink(clipText(`  ${selected.description}`, columns()), '2'));
      if (modal.expanded) {
        const detail = wrapText(selected?.detail ?? selected?.description ?? 'No additional detail.', Math.max(1, columns() - 2));
        const available = Math.max(1, Math.min(10, rows() - lines.length - 3));
        modal.scroll = Math.max(0, Math.min(Math.max(0, detail.length - available), modal.scroll));
        lines.push(...detail.slice(modal.scroll, modal.scroll + available).map(line => `  ${line}`));
        lines.push(ink(`  Detail ${modal.scroll + 1}-${Math.min(detail.length, modal.scroll + available)} / ${detail.length}`, '2'));
      }
      lines.push(ink(clipText(`Enter ${modal.multiple ? 'confirm' : 'select'} · Esc back · ${ascii ? 'Up/Down' : '↑/↓'}${modal.multiple ? ' · Space toggle' : ''} · ${modal.expanded ? 'Left collapse · PgUp/PgDn scroll' : 'Right details'}`, columns()), '2'));
      draw(lines, filterRow, Math.min(columns() - 1, cellWidth(filter)));
      return;
    }

    const width = columns();
    const compact = width < 24 || rows() < 8;
    const innerWidth = Math.max(1, width - (compact ? 2 : 4));
    const layout = inputLayout(innerWidth);
    if (compact) {
      const line = layout.lines[layout.point.row] ?? '';
      const lines = [clipText(`> ${line}`, width)];
      if (menu.length) lines.push(clipText(`Tab: ${menu[menuIndex]?.label ?? ''}`, width));
      draw(lines, 0, Math.min(width - 1, 2 + layout.point.column));
      return;
    }
    const availableRows = Math.max(1, Math.min(6, rows() - (menu.length || historySearch ? 8 : 5)));
    const offset = Math.max(0, Math.min(layout.lines.length - availableRows, layout.point.row - availableRows + 1));
    const visible = layout.lines.slice(offset, offset + availableRows);
    const lines = [];
    let status = '';
    try { status = terminalText(statusOverride ?? getStatus?.() ?? '', { multiline: false }); }
    catch { status = 'Status unavailable'; }
    if (status) lines.push(ink(clipText(status, width), '2'));
    const title = ` ${terminalText(label, { multiline: false })} `;
    const topLabel = clipText(title, Math.max(1, width - 4));
    lines.push(ink(`${frame.tl}${topLabel}${frame.h.repeat(Math.max(0, width - cellWidth(topLabel) - 2))}${frame.tr}`, '36'));
    const cursorRow = lines.length + layout.point.row - offset;
    for (const [index, line] of visible.entries()) {
      const marker = index === 0 && offset ? ascii ? '^' : '↑'
        : index === visible.length - 1 && offset + visible.length < layout.lines.length ? ascii ? 'v' : '↓' : ' ';
      lines.push(`${ink(frame.v, '36')}${marker}${line}${' '.repeat(Math.max(0, innerWidth - cellWidth(line)))} ${ink(frame.v, '36')}`);
    }
    lines.push(ink(`${frame.bl}${frame.h.repeat(width - 2)}${frame.br}`, '36'));
    const hints = menu.length ? 'Enter/Tab insert · Esc dismiss · then Enter sends · Up/Down choose'
      : pending ? width < 62 ? 'Enter send · Esc menu · Ctrl+C stop · Ctrl+J newline'
        : 'Enter send · Ctrl+J/Alt+Enter newline · / commands · @ context · Ctrl+R history · Esc dismiss · Ctrl+C stop'
      : 'Enter queues · /stop cancels · Ctrl+J newline · Ctrl+R history · Ctrl+C stop';
    lines.push(ink(clipText(notice || hints, width), notice ? '33' : '2'));
    if (historySearch) {
      const matches = selectedHistory();
      historySearch.index = Math.max(0, Math.min(matches.length - 1, historySearch.index));
      lines.push(ink(clipText(`History search: ${historySearch.query} · Enter restores draft`, width), '2'));
      lines.push(...displayItems(matches, historySearch.index, Math.max(1, Math.min(5, rows() - lines.length - 1))));
      if (!matches.length) lines.push(ink('  No matching history.', '2'));
    } else if (menu.length) {
      lines.push(...displayItems(menu, menuIndex, Math.max(1, Math.min(6, rows() - lines.length - 2))));
      const selected = menu[menuIndex];
      if (selected?.description && lines.length < rows() - 1) lines.push(ink(clipText(`  ${selected.description}`, width), '2'));
    }
    draw(lines, cursorRow, 2 + layout.point.column);
  }

  function saveState() { return { draft, cursor, label, active, completion, menu, menuIndex, dismissedAt, historySearch }; }
  function restoreState(saved) {
    ({ draft, cursor, label, active, completion, menu, menuIndex, dismissedAt, historySearch } = saved);
    refreshSuggestions();
  }
  function cancelSuggestions() { suggestionEpoch += 1; suggestionController?.abort(); suggestionController = undefined; suggestionLoading = false; }
  function refreshSuggestions() {
    cancelSuggestions();
    // A previous menu is never selectable for a newer draft while asynchronous
    // discovery/filtering is pending, even when keystrokes arrive in one batch.
    menu = []; menuIndex = 0;
    if (closed || modal || historySearch || !completion || !suggest || dismissedAt === draft || paste) { menu = []; return; }
    const before = draft.slice(0, cursor);
    // Argument completion is also delegated to the actual capability catalog.
    const trigger = before.startsWith('/') || /(?:^|\s)@[^\n]*$/.test(before);
    if (!trigger) { menu = []; return; }
    const epoch = suggestionEpoch;
    const requestedLine = draft, requestedCursor = cursor;
    suggestionController = new AbortController();
    suggestionLoading = true;
    const requestSignal = signal ? AbortSignal.any([signal, suggestionController.signal]) : suggestionController.signal;
    Promise.resolve().then(() => requestSignal.aborted ? []
      : suggest({ line: requestedLine, cursor: requestedCursor, signal: requestSignal })).then(items => {
      if (closed || modal || epoch !== suggestionEpoch || requestSignal.aborted) return;
      suggestionLoading = false;
      if (notice.startsWith('Loading choices;')) notice = '';
      menu = validItems(items);
      menuIndex = 0;
      redraw();
    }, error => {
      if (closed || epoch !== suggestionEpoch || requestSignal.aborted) return;
      suggestionLoading = false;
      menu = []; notice = `Suggestions unavailable: ${terminalText(error?.message ?? error, { multiline: false }).slice(0, 160)}`;
      redraw();
    });
  }

  function record(value) {
    if (!value.trim()) return;
    history = [...history.filter(item => item !== value), value].slice(-HISTORY_LIMIT);
    historyIndex = history.length;
  }
  function edited(keepNotice = false) {
    if (!keepNotice) notice = '';
    dismissedAt = undefined; historyIndex = history.length;
    refreshSuggestions(); redraw();
    if (!pending && !draft) onBusyInputIdle?.();
  }
  function insert(text) {
    notice = '';
    text = terminalText(text);
    const before = draft.slice(0, cursor), after = draft.slice(cursor);
    const candidate = boundedDraft(before + text + after);
    if (candidate.length < before.length + text.length + after.length) notice = 'Draft limited to 32 KiB; excess text was not inserted.';
    draft = candidate; cursor = Math.min(draft.length, before.length + text.length);
    edited(true);
  }
  function move(delta) {
    const positions = [...graphemes(draft).map(part => part.index), draft.length];
    const at = positions.findIndex(position => position >= cursor);
    cursor = positions[Math.max(0, Math.min(positions.length - 1, at + delta))] ?? 0;
    refreshSuggestions(); redraw();
  }
  function recall(direction) {
    if (!history.length) return;
    if (historyIndex === history.length) historyDraft = draft;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + direction));
    draft = historyIndex === history.length ? historyDraft : history[historyIndex];
    cursor = draft.length; menu = []; dismissedAt = draft; redraw();
  }
  function acceptSuggestion() {
    const selected = menu[menuIndex];
    if (!selected || selected.disabled) return;
    const before = draft.slice(0, cursor);
    const match = before.match(/(?:^|\s)(@(?:\{[^}]*|[^\s]*))$/);
    const fallbackStart = match ? cursor - match[1].length : before.startsWith('/') && !/\s/.test(before) ? 0 : before.lastIndexOf(' ') + 1;
    const start = Number.isInteger(selected.replaceStart) && selected.replaceStart >= 0 && selected.replaceStart <= cursor ? selected.replaceStart : fallbackStart;
    const end = Number.isInteger(selected.replaceEnd) && selected.replaceEnd >= start && selected.replaceEnd <= draft.length ? selected.replaceEnd : cursor;
    const inserted = terminalText(selected.insertText ?? selected.value ?? selected.label);
    draft = boundedDraft(draft.slice(0, start) + inserted + draft.slice(end));
    cursor = Math.min(draft.length, start + inserted.length);
    menu = []; dismissedAt = draft; notice = '';
    cancelSuggestions(); redraw();
  }

  function settleModal(value, error) {
    if (!modal) return;
    const current = modal;
    current.signal?.removeEventListener('abort', current.abort);
    clear(); modal = undefined;
    restoreState(current.saved);
    redraw();
    if (error) current.reject(error); else current.resolve(value);
  }
  function modalKey(character, key) {
    const items = modalItems();
    if (key.name === 'escape') { settleModal(null); return; }
    if (key.name === 'up' || key.name === 'down') {
      const direction = key.name === 'up' ? -1 : 1;
      modal.index = Math.max(0, Math.min(items.length - 1, modal.index + direction));
      modal.scroll = 0;
    } else if (['right', 'left'].includes(key.name)) { modal.expanded = key.name === 'right'; modal.scroll = 0; }
    else if (['pageup', 'pagedown'].includes(key.name)) {
      if (modal.expanded) modal.scroll += key.name === 'pageup' ? -6 : 6;
      else modal.index = Math.max(0, Math.min(items.length - 1, modal.index + (key.name === 'pageup' ? -6 : 6)));
    } else if (key.name === 'return') {
      const selected = items[modal.index];
      if (modal.multiple) { settleModal([...modal.selected]); return; }
      if (selected && !selected.disabled) settleModal(selected.value);
      return;
    } else if (modal.multiple && key.name === 'space') {
      const selected = items[modal.index];
      if (selected && !selected.disabled) {
        if (modal.selected.has(selected.value)) modal.selected.delete(selected.value); else modal.selected.add(selected.value);
      }
    } else if (key.name === 'backspace') { modal.query = graphemes(modal.query).slice(0, -1).map(part => part.text).join(''); modal.index = 0; modal.scroll = 0; }
    else if (key.ctrl && key.name === 'u') { modal.query = ''; modal.index = 0; modal.scroll = 0; }
    else if (character && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(character)) {
      modal.query = boundedDraft(modal.query + character).slice(0, 512); modal.index = 0; modal.scroll = 0;
    }
    redraw();
  }

  function submit() {
    if (suggestionLoading && completion) {
      notice = 'Loading choices; press Enter after the selection appears.';
      redraw(); return;
    }
    if (menu.length) { acceptSuggestion(); return; }
    if (historySearch) {
      const selected = selectedHistory()[historySearch.index];
      if (selected) { draft = selected.value; cursor = draft.length; }
      historySearch = undefined; menu = []; dismissedAt = draft; redraw(); return;
    }
    const value = draft.trim();
    clear();
    // Submitted prompts become ordinary scrollback; setup/approval answers are
    // not added to history. They are still visible to the current operator.
    write(`${terminalText(label, { multiline: false })} ${terminalText(value)}\r\n`);
    if (completion) record(value);
    draft = ''; cursor = 0; menu = []; notice = ''; cancelSuggestions();
    const current = pending;
    if (current) {
      current.signal?.removeEventListener('abort', current.abort); pending = undefined;
      if (current.saved) restoreState(current.saved);
      else { active = true; label = 'You>'; completion = true; }
      redraw(); current.resolve(value);
    } else {
      redraw();
      try {
        const failed = error => {
          if (closed) return;
          if (!draft) { draft = value; cursor = draft.length; }
          notice = `Could not queue input: ${terminalText(error?.message ?? error, { multiline: false }).slice(0, 160)}`;
          redraw();
        };
        try { const result = onBusyLine?.(value); result?.catch?.(failed); }
        catch (error) { failed(error); }
      }
      finally { if (!draft) onBusyInputIdle?.(); }
    }
  }

  function keypress(character, key = {}) {
    if (closed) return;
    if (key.name === 'paste-start') {
      paste = true; pasteText = '';
      if (!pending && !modal) onBusyTyping?.();
      return;
    }
    if (key.name === 'paste-end') {
      if (!paste) return;
      paste = false;
      const contents = pasteText; pasteText = '';
      if (modal) { modal.query = boundedDraft(modal.query + terminalText(contents, { multiline: false })).slice(0, 512); modal.index = 0; redraw(); }
      else insert(contents);
      return;
    }
    if (paste) {
      if (Buffer.byteLength(pasteText) < DRAFT_LIMIT) pasteText += key.sequence ?? character ?? '';
      return;
    }
    if (key.ctrl && key.name === 'c') {
      let keep = false;
      try { keep = onInterrupt?.() === false; } finally { if (!keep) close(); }
      return;
    }
    if (!pending && !modal) onBusyTyping?.();
    if (modal) { modalKey(character, key); return; }
    if (historySearch) {
      if (key.name === 'escape') { historySearch = undefined; redraw(); return; }
      if (key.name === 'return') { submit(); return; }
      if (key.name === 'down' || key.ctrl && key.name === 'r') historySearch.index += 1;
      else if (key.name === 'up') historySearch.index -= 1;
      else if (key.name === 'backspace') { historySearch.query = graphemes(historySearch.query).slice(0, -1).map(part => part.text).join(''); historySearch.index = 0; }
      else if (key.ctrl && key.name === 'u') { historySearch.query = ''; historySearch.index = 0; }
      else if (character && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(character)) { historySearch.query = (historySearch.query + character).slice(0, 512); historySearch.index = 0; }
      redraw(); return;
    }
    if (key.name === 'escape') { menu = []; dismissedAt = draft; cancelSuggestions(); redraw(); return; }
    if (key.name === 'tab') { if (menu.length) acceptSuggestion(); else { dismissedAt = undefined; refreshSuggestions(); } return; }
    // Node names LF "enter" and CR "return". Ctrl+J sends LF, whereas the
    // physical Enter key normally sends CR in iTerm/xterm/Terminal.app.
    if (key.name === 'return' && key.meta || key.ctrl && key.name === 'j'
      || key.name === 'enter' || key.name === 'linefeed') { insert('\n'); return; }
    if (key.name === 'return') { submit(); return; }
    if (key.ctrl && key.name === 'd') { if (!draft) close(); else { const next = graphemes(draft.slice(cursor))[0]; if (next) { draft = draft.slice(0, cursor) + draft.slice(cursor + next.text.length); edited(); } } return; }
    if (key.ctrl && key.name === 'r') { historySearch = { query: '', index: 0 }; menu = []; cancelSuggestions(); redraw(); return; }
    if (key.name === 'up' || key.name === 'down') {
      if (menu.length) { menuIndex = Math.max(0, Math.min(menu.length - 1, menuIndex + (key.name === 'up' ? -1 : 1))); redraw(); }
      else if (draft.includes('\n')) {
        const before = draft.slice(0, cursor), currentStart = before.lastIndexOf('\n') + 1, offset = cursor - currentStart;
        if (key.name === 'up') { const previousEnd = Math.max(0, currentStart - 1); const previousStart = previousEnd ? draft.lastIndexOf('\n', previousEnd - 1) + 1 : 0; cursor = currentStart ? Math.min(previousEnd, previousStart + offset) : 0; }
        else { const nextStart = draft.indexOf('\n', cursor); if (nextStart >= 0) { const nextEnd = draft.indexOf('\n', nextStart + 1); cursor = Math.min(nextEnd === -1 ? draft.length : nextEnd, nextStart + 1 + offset); } else cursor = draft.length; }
        cursor = [...graphemes(draft).map(part => part.index), draft.length].find(position => position >= cursor) ?? draft.length;
        redraw();
      } else recall(key.name === 'up' ? -1 : 1);
      return;
    }
    if (key.name === 'left' || key.name === 'right') {
      if (key.ctrl || key.meta) {
        if (key.name === 'left') { const before = draft.slice(0, cursor); cursor = Math.max(0, before.search(/\S+\s*$/)); }
        else { const after = draft.slice(cursor); const match = after.match(/^\s*\S+\s*/); cursor += match ? match[0].length : after.length; }
        refreshSuggestions(); redraw();
      } else move(key.name === 'left' ? -1 : 1);
      return;
    }
    if (key.name === 'home' || key.ctrl && key.name === 'a') { cursor = cursor ? draft.lastIndexOf('\n', cursor - 1) + 1 : 0; redraw(); return; }
    if (key.name === 'end' || key.ctrl && key.name === 'e') { const end = draft.indexOf('\n', cursor); cursor = end === -1 ? draft.length : end; redraw(); return; }
    if (key.ctrl && key.name === 'u') { draft = draft.slice(cursor); cursor = 0; edited(); return; }
    if (key.ctrl && key.name === 'k') { draft = draft.slice(0, cursor); edited(); return; }
    if (key.ctrl && key.name === 'w') { const before = draft.slice(0, cursor), removed = before.match(/\S+\s*$/)?.[0] ?? before; draft = before.slice(0, before.length - removed.length) + draft.slice(cursor); cursor -= removed.length; edited(); return; }
    if (key.name === 'backspace') { const previous = graphemes(draft.slice(0, cursor)).at(-1); if (previous) { draft = draft.slice(0, previous.index) + draft.slice(cursor); cursor = previous.index; edited(); } return; }
    if (key.name === 'delete') { const next = graphemes(draft.slice(cursor))[0]; if (next) { draft = draft.slice(0, cursor) + draft.slice(cursor + next.text.length); edited(); } return; }
    if (character && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(character)) insert(character);
  }

  function ask(nextLabel, { signal: questionSignal, defaultValue, complete = false } = {}) {
    if (closed || questionSignal?.aborted) return Promise.reject(cancelled());
    if (pending || modal) return Promise.reject(new Error('An input question is already open.'));
    const saved = complete ? undefined : saveState();
    active = true; label = terminalText(nextLabel, { multiline: false }); completion = complete;
    if (!complete || defaultValue !== undefined) { draft = boundedDraft(defaultValue ?? ''); cursor = draft.length; }
    menu = []; historySearch = undefined; dismissedAt = undefined;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!pending || pending.abort !== abort) return;
        const current = pending; pending = undefined;
        questionSignal?.removeEventListener('abort', abort);
        clear(); if (current.saved) restoreState(current.saved); redraw(); reject(cancelled());
      };
      pending = { resolve, reject, abort, signal: questionSignal, saved };
      questionSignal?.addEventListener('abort', abort, { once: true });
      if (questionSignal?.aborted) abort(); else { refreshSuggestions(); redraw(); }
    });
  }

  function openModal({ title, items, multiple = false, initial, allowCustom = false, signal: modalSignal } = {}) {
    if (closed || modalSignal?.aborted) return Promise.reject(cancelled());
    if (pending || modal) return Promise.reject(new Error('An input question is already open.'));
    const saved = saveState();
    cancelSuggestions(); menu = []; active = true;
    return new Promise((resolve, reject) => {
      const prepared = validItems(items);
      const index = prepared.findIndex(item => item.value === initial);
      const abort = () => settleModal(undefined, cancelled());
      modal = { title: terminalText(title ?? 'Choose'), items: prepared, query: '',
        multiple, selected: new Set(Array.isArray(initial) ? initial : []),
        allowCustom, index: Math.max(0, index), expanded: false, scroll: 0,
        saved, resolve, reject, abort, signal: modalSignal };
      modalSignal?.addEventListener('abort', abort, { once: true });
      if (modalSignal?.aborted) abort(); else redraw();
    });
  }

  function close() {
    if (closed) return;
    clear(); closed = true; cancelSuggestions();
    input.removeListener('keypress', keypress); input.removeListener('end', close);
    input.removeListener('error', close); stream.removeListener('resize', redraw);
    signal?.removeEventListener('abort', close);
    try { input.setRawMode(wasRaw); } catch { /* The terminal may already have closed. */ }
    write('\x1b[?2004l\x1b[?25h');
    if (wasFlowing !== true) input.pause();
    if (pending) { const current = pending; pending = undefined; current.signal?.removeEventListener('abort', current.abort); current.reject(cancelled()); }
    if (modal) { const current = modal; modal = undefined; current.signal?.removeEventListener('abort', current.abort); current.reject(cancelled()); }
    onClose?.();
  }

  emitKeypressEvents(input);
  input.setRawMode(true);
  input.on('keypress', keypress); input.once('end', close); input.once('error', close);
  stream.on('resize', redraw); signal?.addEventListener('abort', close, { once: true });
  write('\x1b[?2004h'); input.resume();
  if (signal?.aborted) close();
  return {
    get closed() { return closed; }, get plain() { return false; },
    ask, choose: openModal, browse: openModal, clear, redraw, close,
    suspend() { clear(); active = false; cancelSuggestions(); },
    resume() { active = true; refreshSuggestions(); redraw(); },
    refresh() { refreshSuggestions(); redraw(); },
    setDraft(value) { draft = boundedDraft(value); cursor = draft.length; dismissedAt = undefined; refreshSuggestions(); redraw(); },
    getDraft() { return draft; },
    get history() { return [...history]; },
    setHistory(values) { history = Array.isArray(values) ? values.filter(value => typeof value === 'string').slice(-HISTORY_LIMIT).map(boundedDraft) : []; historyIndex = history.length; },
    setStatus(value) { statusOverride = value; redraw(); },
  };
}

function plainInput({ write, signal, onInterrupt, onBusyLine, onClose, input, stream }) {
  const terminal = createInterface({ input, output: stream, terminal: false });
  let closed = false, pending, draft = '', history = [];
  const interrupt = () => { let keep = false; try { keep = onInterrupt?.() === false; } finally { if (!keep) close(); } };
  const closedEvent = () => {
    if (closed) return;
    closed = true; process.removeListener('SIGINT', interrupt); signal?.removeEventListener('abort', close);
    if (pending) { const current = pending; pending = undefined; current.signal?.removeEventListener('abort', current.abort); current.reject(cancelled()); }
    onClose?.();
  };
  function close() { if (!closed) { terminal.close(); closedEvent(); } }
  terminal.on('close', closedEvent);
  terminal.on('line', line => { if (!pending) onBusyLine?.(terminalText(line)); });
  process.on('SIGINT', interrupt);
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) close();
  function ask(label, { signal: questionSignal, defaultValue, complete = false } = {}) {
    if (closed || questionSignal?.aborted) return Promise.reject(cancelled());
    if (pending) return Promise.reject(new Error('An input question is already open.'));
    const initial = terminalText(defaultValue ?? (complete ? draft : ''));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => { if (pending?.abort === abort) { pending = undefined; controller.abort(); reject(cancelled()); } };
      pending = { reject, abort, signal: questionSignal };
      questionSignal?.addEventListener('abort', abort, { once: true });
      terminal.question(`${terminalText(label, { multiline: false })}${initial ? ` [${terminalText(initial, { multiline: false })}]` : ''} `,
        { signal: controller.signal }, value => {
          if (!pending || pending.abort !== abort) return;
          pending = undefined; questionSignal?.removeEventListener('abort', abort);
          value = terminalText(value).trim() || initial;
          if (complete && value) { history = [...history.filter(item => item !== value), boundedDraft(value)].slice(-HISTORY_LIMIT); draft = ''; }
          resolve(value);
        });
      if (questionSignal?.aborted) abort();
    });
  }
  async function choose({ title, items, multiple = false, initial, allowCustom = false, signal: selectionSignal } = {}) {
    items = validItems(items);
    write(`${terminalText(title ?? 'Choose')}\n`);
    for (const [index, item] of items.entries()) write(`${index + 1}. ${terminalText(item.label, { multiline: false })}${item.disabled ? ' [unavailable]' : ''}${item.description ? ` — ${terminalText(item.description, { multiline: false })}` : ''}\n`);
    const defaultIndex = items.findIndex(item => item.value === initial && !item.disabled);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = await ask(`Choose ${multiple ? 'numbers separated by commas' : 'a number'}${defaultIndex >= 0 ? ` [${defaultIndex + 1}]` : ''}, or cancel:`, { signal: selectionSignal });
      if (!answer || ['q', 'cancel', 'esc'].includes(answer.toLowerCase())) {
        if (!answer && multiple && Array.isArray(initial)) return initial.filter(value => items.some(item => item.value === value && !item.disabled));
        return !answer && defaultIndex >= 0 ? items[defaultIndex].value : null;
      }
      const numbers = answer.split(',').map(item => Number(item.trim()) - 1);
      if (numbers.every(number => Number.isInteger(number) && items[number] && !items[number].disabled)
        && (multiple || numbers.length === 1)) return multiple ? [...new Set(numbers)].map(number => items[number].value) : items[numbers[0]].value;
      if (allowCustom) return answer;
      write('Choose an available displayed number, or cancel.\n');
    }
    return null;
  }
  return { get closed() { return closed; }, get plain() { return true; }, ask, choose,
    async browse(options) {
      const value = await choose(options);
      const item = options.items.find(item => item.value === value);
      if (item?.detail) write(`${terminalText(item.detail)}\n`);
      return value;
    },
    clear() {}, redraw() {}, refresh() {}, suspend() {}, resume() {}, close,
    setDraft(value) { draft = boundedDraft(value); }, getDraft() { return draft; },
    get history() { return [...history]; },
    setHistory(values) { history = Array.isArray(values) ? values.filter(value => typeof value === 'string').slice(-HISTORY_LIMIT).map(boundedDraft) : []; },
    setStatus() {},
  };
}
