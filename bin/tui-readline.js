import { EventEmitter } from 'node:events';
import { createTerminalInput } from './tui-input.js';

/** Small adapter for the existing project terminal's serialized control queue.
 * The input implementation owns all keys/rendering; no second readline or raw
 * stdin listener is introduced by this facade. Native attachment closes it. */
export function createTuiReadline(options = {}) {
  const events = new EventEmitter();
  let prompt = 'Agents>', main, questionActive = false;
  const ui = createTerminalInput({ ...options,
    onClose() { events.emit('close'); options.onClose?.(); },
    onInterrupt() {
      if (events.listenerCount('SIGINT')) { events.emit('SIGINT'); return false; }
      return options.onInterrupt?.();
    },
    onBusyLine(line) { events.emit('line', line); },
  });
  function pausePrompt() {
    ui.suspend();
    main?.abort(); main = undefined;
    ui.clear();
  }
  function showPrompt() {
    if (ui.closed) return;
    if (main || questionActive) { ui.redraw(); return; }
    const controller = new AbortController();
    main = controller;
    ui.ask(prompt, { signal: controller.signal, complete: true }).then(line => {
      if (main !== controller) return;
      main = undefined;
      events.emit('line', line);
    }, error => {
      if (main === controller) main = undefined;
      if (!ui.closed && !controller.signal.aborted) events.emit('inputError', error);
    });
  }
  Object.assign(events, {
    getInput: () => ui,
    setPrompt(value) { prompt = value; },
    prompt: showPrompt, pausePrompt,
    clear: () => ui.clear(), redraw: () => ui.redraw(), close: () => ui.close(),
    question(label, optionsOrCallback, callback) {
      const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback ?? {};
      callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      pausePrompt(); questionActive = true;
      ui.ask(label, { ...options, complete: false }).then(answer => {
        questionActive = false; callback?.(answer);
      }, error => {
        questionActive = false;
        if (!ui.closed && !options.signal?.aborted) events.emit('inputError', error);
      });
      return events;
    },
    async choose(options) {
      pausePrompt(); questionActive = true;
      try { return await ui.choose(options); } finally { questionActive = false; }
    },
    async browse(options) {
      pausePrompt(); questionActive = true;
      try { return await ui.browse(options); } finally { questionActive = false; }
    },
  });
  return Object.defineProperties(events, {
    closed: { enumerable: true, get: () => ui.closed },
    line: { enumerable: true, get: () => ui.getDraft() },
  });
}
