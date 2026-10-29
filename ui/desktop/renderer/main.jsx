import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import logo from './assets/koto-logo.png';

const bridge = window.kotoDesktop;
const PREFERENCES_KEY = 'koto.desktop.presentation.v1';
const MAX_PENDING_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const byteLength = value => encoder.encode(value).byteLength;
const live = active => active && ['starting', 'running', 'stopping'].includes(active.status);
const activityRank = { starting: 0, running: 1, stopping: 2, stopped: 3, failed: 3, cleanup_unconfirmed: 3 };
const statusLabel = { starting: 'Starting', running: 'Running', stopping: 'Stopping', stopped: 'Stopped', failed: 'Stopped with an error', cleanup_unconfirmed: 'Cleanup unconfirmed' };
const initialState = { projects: [], recentSessions: [], active: null, helper: { ready: false }, platform: '', appVersion: '', coreVersion: '' };

function readPreferences() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null'); } catch { /* Presentation preferences are optional. */ }
  return {
    fontSize: Number.isInteger(saved?.fontSize) && saved.fontSize >= 12 && saved.fontSize <= 20 ? saved.fontSize : 15,
    reducedMotion: typeof saved?.reducedMotion === 'boolean' ? saved.reducedMotion : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

function friendlyError(value) {
  const message = value?.message || String(value || 'Koto could not complete that action.');
  if (message.includes('desktop_output_overflow')) return 'Terminal output exceeded the display queue. Koto stopped the CLI; its saved work remains available.';
  if (message.includes('cleanup_unconfirmed')) return 'Koto could not confirm that all owned processes stopped. Review the retained session before continuing.';
  if (message.includes('helper_missing') || message.includes('helper_unavailable')) return 'Set up terminal support on this computer before opening the CLI.';
  return message;
}

function Icon({ name, size = 18, ...props }) {
  const paths = {
    folder: <><path d="M3 7.5V5.5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /></>,
    session: <><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h4M9 12h5M9 16h5" /></>,
    chevron: <><path d="m13 7-5 5 5 5M18 7l-5 5 5 5" /></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    settings: <><path d="m9.5 3-.7 2.3-2 .9-2.2-.6-1.5 2.6 1.6 1.8-.2 2.2L3 14l1.5 2.6 2.3-.5 1.8 1.2.5 2.7h3l.8-2.4 2-.9 2.2.7 1.5-2.6-1.6-1.8.2-2.2L21 9l-1.5-2.6-2.3.5-1.8-1.2-.5-2.7Z" /><circle cx="12" cy="11.5" r="3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-8h6v8" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-1.2L20 9M4 15l2.4 3.2A7 7 0 0 0 18 17" /></>,
    play: <path d="m8 5 11 7-11 7Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    alert: <><path d="m12 3 10 17H2Z" /><path d="M12 9v5M12 17v.1" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

function cleanState(next) {
  return {
    ...initialState, ...next,
    projects: Array.isArray(next?.projects) ? next.projects.slice(0, 64) : [],
    recentSessions: Array.isArray(next?.recentSessions) ? next.recentSessions.slice(0, 20) : [],
    helper: next?.helper || { ready: false },
    active: next?.active || null,
  };
}

function makeTerminal(container, { onState, onError, preferences }) {
  const terminal = new Terminal({
    allowProposedApi: false, allowTransparency: false, convertEol: false,
    cursorBlink: !preferences.reducedMotion, cursorStyle: 'bar', cursorWidth: 2,
    fontFamily: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: preferences.fontSize, lineHeight: 1.46, letterSpacing: 0,
    scrollback: 5000, screenReaderMode: true,
    theme: {
      background: '#101317', foreground: '#e9ecef', cursor: '#b7daca', cursorAccent: '#101317',
      selectionBackground: '#344d48', black: '#1c222a', red: '#e9a19c', green: '#9bcbb5',
      yellow: '#d8c099', blue: '#9bb9d8', magenta: '#b8a6d1', cyan: '#9ac7c6', white: '#d7dde5',
      brightBlack: '#808b9d', brightRed: '#f1b4b1', brightGreen: '#b7deca', brightYellow: '#e4d0ac',
      brightBlue: '#b8cfe8', brightMagenta: '#cdbfe0', brightCyan: '#b6dddd', brightWhite: '#ffffff',
    },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  let disposed = false;
  let bootstrapped = false;
  let id = null;
  let sequence = 0;
  let state = initialState;
  let lastSize = '';
  let resizeTimer;
  let draining = false;
  let writes = [];
  let queuedBytes = 0;
  let staged = [];
  let stagedBytes = 0;
  let overflowed = false;
  const retired = new Set();

  const report = error => { if (!disposed) onError(friendlyError(error)); };
  const consume = (sessionId, value) => {
    if (!bridge || !sessionId || !Number.isSafeInteger(value) || value < 1) return;
    bridge.ack({ id: sessionId, sequence: value }).then(accepted => {
      if (!accepted && sessionId === id && live(state.active)) report(new Error('The terminal display connection was interrupted. Stop the CLI before opening it again.'));
    }).catch(report);
  };
  function overflow() {
    if (overflowed || disposed) return;
    overflowed = true;
    report(new Error('desktop_output_overflow'));
    bridge?.stop().then(next => acceptState(next)).catch(report);
  }
  function drain() {
    if (draining || disposed) return;
    const item = writes.shift();
    if (!item) return;
    queuedBytes -= item.bytes;
    if (item.id !== id) { drain(); return; }
    draining = true;
    if (item.reset) terminal.reset();
    terminal.write(item.data, () => {
      draining = false;
      if (disposed) return;
      consume(item.id, item.sequence);
      drain();
    });
  }
  function enqueue(item) {
    item.bytes = byteLength(item.data);
    if (queuedBytes + item.bytes > MAX_PENDING_BYTES || writes.length >= 512) { overflow(); return; }
    queuedBytes += item.bytes;
    writes.push(item);
    drain();
  }
  function fitTerminal() {
    if (disposed || !container.isConnected || !container.clientWidth || !container.clientHeight) return;
    try {
      fit.fit();
      const cols = Math.max(2, Math.min(500, terminal.cols));
      const rows = Math.max(2, Math.min(300, terminal.rows));
      const key = id + ':' + cols + ':' + rows;
      if (bridge && id && live(state.active) && key !== lastSize) {
        lastSize = key;
        const sessionId = id;
        bridge.resize({ id: sessionId, cols, rows }).then(accepted => {
          if (!accepted && sessionId === id && live(state.active) && state.active.status !== 'stopping') {
            lastSize = '';
            report(new Error('The CLI could not accept the new terminal size. Resize the window again after checking its state.'));
          }
        }).catch(report);
      }
    } catch (error) { report(error); }
  }
  function scheduleFit() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitTerminal, 60);
  }
  function acceptState(value) {
    if (disposed) return;
    let next = cleanState(value);
    const previous = state.active;
    if (next.active && retired.has(next.active.id)) next = { ...next, active: previous };
    if (previous && next.active?.id === previous.id) {
      const olderSequence = next.active.sequence < previous.sequence;
      const olderStatus = (activityRank[next.active.status] ?? 0) < (activityRank[previous.status] ?? 0);
      if (olderSequence || olderStatus) next = { ...next, active: { ...next.active, ...previous } };
    }
    state = next;
    if (next.active && next.active.id !== id) {
      if (id) {
        retired.add(id);
        if (retired.size > 16) retired.delete(retired.values().next().value);
      }
      id = next.active.id;
      sequence = Number.isSafeInteger(next.active.sequence) ? next.active.sequence : 0;
      writes = [];
      queuedBytes = 0;
      overflowed = false;
      enqueue({ id, sequence, data: typeof next.active.tail === 'string' ? next.active.tail : '', reset: true });
      lastSize = '';
      scheduleFit();
    }
    onState(next);
  }
  function acceptOutput(event) {
    if (typeof event.data !== 'string' || !Number.isSafeInteger(event.sequence)) return;
    if (retired.has(event.id)) return;
    if (event.id !== id) { stage(event); return; }
    const duplicate = event.sequence <= sequence;
    if (!duplicate) sequence = event.sequence;
    enqueue({ id: event.id, sequence: event.sequence, data: duplicate ? '' : event.data });
  }
  function stage(event) {
    const size = event.type === 'output' ? byteLength(event.data || '') : byteLength(event.state?.active?.tail || '');
    if (stagedBytes + size > MAX_PENDING_BYTES || staged.length >= 128) { overflow(); return; }
    stagedBytes += size;
    staged.push(event);
  }
  function handle(event) {
    if (disposed || !event || typeof event !== 'object') return;
    if (!bootstrapped) { stage(event); return; }
    if (event.type === 'state') {
      acceptState(event.state);
      const matching = staged.filter(item => item.type === 'output' && item.id === id);
      staged = staged.filter(item => !(item.type === 'output' && item.id === id));
      stagedBytes = staged.reduce((sum, item) => sum + byteLength(item.data || ''), 0);
      matching.forEach(acceptOutput);
    } else if (event.type === 'output') acceptOutput(event);
    else if (event.type === 'error') report(event.message);
  }

  // Subscribe before taking a snapshot. The snapshot tail owns all bytes up to
  // its sequence; queued events beyond that point are appended once.
  const unsubscribe = bridge?.onEvent(handle);
  const input = terminal.onData(data => {
    if (!bridge || !id || !live(state.active) || state.active.status === 'stopping') return;
    if (byteLength(data) > 64 * 1024) { report(new Error('That paste is too large. Paste less than 64 KiB at a time.')); return; }
    bridge.write({ id, data }).then(accepted => {
      if (!accepted) report(new Error('The CLI could not accept that input. Check its current state before retrying.'));
    }).catch(report);
  });
  const observer = new ResizeObserver(scheduleFit);
  observer.observe(container);
  scheduleFit();
  if (bridge) {
    bridge.getState().then(next => {
      if (disposed) return;
      acceptState(next);
      bootstrapped = true;
      const pending = staged;
      staged = [];
      stagedBytes = 0;
      pending.forEach(handle);
    }).catch(error => { bootstrapped = true; report(error); onState(initialState); });
  } else {
    bootstrapped = true;
    onState(initialState);
  }
  return {
    state: acceptState,
    dimensions: () => ({ cols: Math.max(2, Math.min(500, terminal.cols)), rows: Math.max(2, Math.min(300, terminal.rows)) }),
    focus: () => terminal.focus(),
    updatePreferences(next) {
      terminal.options.fontSize = next.fontSize;
      terminal.options.cursorBlink = !next.reducedMotion;
      scheduleFit();
    },
    dispose() {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      unsubscribe?.();
      input.dispose();
      writes = [];
      staged = [];
      terminal.dispose();
    },
  };
}

function App() {
  const [state, setState] = useState(initialState);
  const [loaded, setLoaded] = useState(!bridge);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [sidebar, setSidebar] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(readPreferences);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const terminalElement = useRef(null);
  const terminalController = useRef(null);
  const settingsButton = useRef(null);
  const settingsDialog = useRef(null);

  useEffect(() => {
    const controller = makeTerminal(terminalElement.current, {
      preferences,
      onState(next) {
        setState(next);
        setLoaded(true);
        if (next.active?.error) setError(friendlyError(next.active.error));
      },
      onError: setError,
    });
    terminalController.current = controller;
    return () => { controller.dispose(); terminalController.current = null; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Settings still apply for this window. */ }
    terminalController.current?.updatePreferences(preferences);
  }, [preferences]);
  useEffect(() => {
    if (!state.projects.some(project => project.id === selectedProject)) {
      const activeProject = state.projects.find(project => project.path === state.active?.project);
      setSelectedProject(activeProject?.id || state.projects[0]?.id || '');
    }
  }, [state.projects, state.active?.project]);
  useEffect(() => {
    if (selectedSession && !state.recentSessions.some(session => session.id === selectedSession)) {
      setSelectedSession('');
    }
  }, [state.recentSessions, selectedSession]);
  useEffect(() => {
    if (!settingsOpen) return;
    const previous = document.activeElement;
    const dialog = settingsDialog.current;
    dialog?.querySelector('button, input')?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); setSettingsOpen(false); }
      if (event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); (previous?.isConnected ? previous : settingsButton.current)?.focus(); };
  }, [settingsOpen]);

  const active = state.active;
  const running = live(active);
  const chosenProject = state.projects.find(project => project.id === selectedProject);
  const chosenSession = state.recentSessions.find(session => session.id === selectedSession);
  const activeProject = state.projects.find(project => project.path === active?.project);
  const startEnabled = Boolean(bridge && loaded && state.helper.ready && !busy && active?.status !== 'cleanup_unconfirmed');
  const terminalVisible = Boolean(active);
  const terminalTitle = activeProject?.name || (active?.project ? active.project.split(/[\\/]/).filter(Boolean).at(-1) : 'Local workspace');

  async function action(name, perform, after) {
    if (!bridge || busy) return;
    setBusy(name);
    setError('');
    try {
      const next = await perform();
      if (next) terminalController.current?.state(next);
      after?.(next);
    } catch (value) { setError(friendlyError(value)); }
    finally { setBusy(''); }
  }
  function start() {
    if (selectedProject && !chosenProject) {
      setSelectedProject('');
      setError('This project is no longer available. Refresh the sidebar and choose it again.');
      return;
    }
    if (selectedSession && (!chosenSession || !chosenProject || chosenSession.project !== chosenProject.path)) {
      setSelectedSession('');
      setError('This saved session is no longer available for the selected project. Refresh the sidebar and choose it again.');
      return;
    }
    action('start', () => bridge.start({
      ...(chosenProject ? { projectId: chosenProject.id } : {}),
      ...(chosenSession ? { sessionId: chosenSession.id } : {}),
      ...terminalController.current.dimensions(), animation: !preferences.reducedMotion,
    }), () => terminalController.current?.focus());
  }
  function chooseProject() {
    action('choose', () => bridge.chooseProject(), next => {
      if (next?.chosenProjectId && next.projects.some(project => project.id === next.chosenProjectId)) {
        setSelectedProject(next.chosenProjectId);
        setSelectedSession('');
      }
    });
  }
  function selectProject(project) {
    setSelectedProject(project.id);
    setSelectedSession('');
  }
  function selectSession(session) {
    setSelectedSession(session.id);
    const project = state.projects.find(item => item.path === session.project);
    setSelectedProject(project?.id || '');
  }
  function emptyTitle() {
    if (!bridge) return 'Your agents. One workspace.';
    if (!loaded) return 'Opening your workspace…';
    if (!state.helper.ready) return 'Make room for your agents.';
    return chosenSession ? chosenSession.goal || 'Return to a saved session.' : 'Your agents. One conversation.';
  }

  return <div className={'desktop-app' + (sidebar ? '' : ' sidebar-collapsed') + (preferences.reducedMotion ? ' reduced-motion' : '')}>
    <div className="window-drag-region" aria-hidden="true" />
    <aside className="sidebar" aria-label="Projects and saved sessions" hidden={!sidebar}>
      <div className="brand-row">
        <div className="brand"><img src={logo} alt="" /><span>Koto</span></div>
        <button className="icon-button collapse-button" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={() => setSidebar(false)}><Icon name="chevron" /></button>
      </div>
      <div className="sidebar-scroll">
        <section className="navigation-section" aria-labelledby="projects-heading">
          <div className="section-heading"><h2 id="projects-heading">Projects</h2><button className="icon-button quiet" title="Refresh projects and saved sessions" aria-label="Refresh projects and saved sessions" disabled={!bridge || Boolean(busy)} onClick={() => action('refresh', () => bridge.refresh())}><Icon name="refresh" size={15} /></button></div>
          <div className="project-list">
            {state.projects.map(project => <button key={project.id} className={'project-row' + (selectedProject === project.id && !selectedSession ? ' selected' : '')} aria-pressed={selectedProject === project.id && !selectedSession} title={project.path} onClick={() => selectProject(project)}>
              <Icon name="folder" size={20} />
              <span className="row-text"><span className="row-title">{project.name}</span><span className="row-description">{project.path}</span></span>
              {active?.project === project.path && running && <span className="live-dot" aria-label="CLI running in this project" />}
            </button>)}
            {!state.projects.length && <p className="empty-navigation">{loaded ? 'Your projects will appear here.' : 'Loading projects…'}</p>}
          </div>
          <button className="open-project-button" onClick={chooseProject} disabled={!bridge || Boolean(busy)}><Icon name="folder" size={18} /><span>{busy === 'choose' ? 'Choosing project…' : 'Open project'}</span></button>
        </section>
        <section className="navigation-section recent-section" aria-labelledby="sessions-heading">
          <div className="section-heading"><h2 id="sessions-heading">Recent sessions</h2><span className="section-count">{state.recentSessions.length || ''}</span></div>
          <div className="session-list">
            {state.recentSessions.map(session => <button key={session.id} className={'session-row' + (selectedSession === session.id ? ' selected' : '')} aria-pressed={selectedSession === session.id} title={(session.goal || 'Saved session') + '\n' + session.directory} onClick={() => selectSession(session)}>
              <Icon name="session" size={18} /><span className="row-text"><span className="row-title">{session.goal || 'Saved session'}</span><span className="row-description">{session.project.split(/[\\/]/).filter(Boolean).at(-1) || session.project}</span></span>
              {session.active && <span className="retained-status" title="Saved record reports active; live ownership is not established" aria-label="Saved active state">○</span>}
            </button>)}
            {!state.recentSessions.length && <p className="empty-navigation">Saved builds will appear here.</p>}
          </div>
        </section>
      </div>
      <div className="sidebar-footer">
        <div className="local-label"><Icon name="home" size={18} /><span>Local workspace</span></div>
        <button className="settings-button" ref={settingsButton} onClick={() => setSettingsOpen(true)}><Icon name="settings" size={19} /><span>Settings</span></button>
      </div>
    </aside>

    <main className="main-workspace">
      <header className="terminal-toolbar">
        <div className="terminal-heading">
          {!sidebar && <button className="icon-button reveal-sidebar" title="Show sidebar" aria-label="Show sidebar" onClick={() => setSidebar(true)}><Icon name="sidebar" /></button>}
          <h1>Koto CLI</h1>
        </div>
        <div className="terminal-meta">
          <span className="active-project-name" title={active?.project || ''}>{terminalTitle}</span>
          <span className={'terminal-status ' + (active?.status || 'idle')} role="status"><span className="status-dot" />{!bridge ? 'Desktop app required' : !loaded ? 'Connecting' : active ? statusLabel[active.status] || active.status : 'Ready'}</span>
        </div>
        <div className="toolbar-actions">
          {running && <button className="toolbar-button stop-button" disabled={Boolean(busy) || active.status === 'stopping'} onClick={() => action('stop', () => bridge.stop())}><Icon name="stop" size={13} /><span>Stop CLI</span></button>}
          {!running && active && <button className="toolbar-button" disabled={!startEnabled} onClick={start}><Icon name="play" size={14} /><span>Open CLI</span></button>}
        </div>
      </header>

      <div className="terminal-area">
        <div ref={terminalElement} className={'terminal-container' + (terminalVisible ? ' is-visible' : '')} aria-label="Interactive Koto CLI" />
        {!terminalVisible && <div className="terminal-empty">
          <div className="empty-brand"><img src={logo} alt="" /><span>KOTO</span></div>
          <h2>{emptyTitle()}</h2>
          <p>{!bridge ? 'Open Koto Desktop to use a real local terminal.' : !loaded ? 'Reading projects and saved sessions from this computer.' : !state.helper.ready ? 'Set up terminal support, then open the Koto CLI.' : 'Describe the work, review the plan, then build.'}</p>
          {bridge && loaded && state.helper.ready && <div className="start-selection">
            {(chosenSession || chosenProject) && <div className="selection-summary"><Icon name={chosenSession ? 'session' : 'folder'} size={17} /><span>{chosenSession ? 'Saved session · ' + (chosenSession.goal || 'Untitled') : chosenProject.name}</span></div>}
            <button className="primary-button" disabled={!startEnabled} onClick={start}><span>{busy === 'start' ? 'Opening CLI…' : chosenSession ? 'Open saved session' : 'Open CLI'}</span><Icon name="arrow" size={17} /></button>
            <p className="empty-note">{chosenSession ? 'Koto will open this retained session for review.' : 'Account setup and agent controls stay in the CLI.'}</p>
          </div>}
          {bridge && loaded && !state.helper.ready && <div className="start-selection"><button className="primary-button" disabled={Boolean(busy)} onClick={() => action('helper', () => bridge.buildHelper())}><span>{busy === 'helper' ? 'Setting up terminal support…' : 'Set up terminal support'}</span><Icon name="arrow" size={17} /></button><p className="empty-note">{state.helper.message || 'Uses the existing build tools on this computer.'}</p></div>}
          {!bridge && <p className="desktop-only-note">Use the desktop app to access projects and terminal sessions on this computer.</p>}
        </div>}
      </div>

      {terminalVisible && (chosenSession || chosenProject) && ((chosenSession && chosenSession.directory !== active?.session) || (!chosenSession && chosenProject.path !== active?.project)) && <div className="selection-bar"><span><Icon name={chosenSession ? 'session' : 'folder'} size={15} />Selected: {chosenSession ? chosenSession.goal || 'Saved session' : chosenProject.name}</span><button className="text-button" disabled={!startEnabled} onClick={start}>Open CLI here<Icon name="arrow" size={14} /></button></div>}
      {error && <div className="error-banner" role="alert"><Icon name="alert" size={17} /><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><Icon name="close" size={15} /></button></div>}
      {terminalVisible && !running && <div className="terminal-ended" role="status"><span>{active.status === 'cleanup_unconfirmed' ? 'Cleanup needs attention. Retained work remains available in Koto.' : 'CLI stopped. Your saved sessions remain available.'}</span></div>}
    </main>

    {settingsOpen && <div className="settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-heading" ref={settingsDialog}>
        <header><h2 id="settings-heading">Settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><Icon name="close" /></button></header>
        <div className="setting-row"><label htmlFor="terminal-font-size">Terminal text size<span>Applies to this window immediately.</span></label><div className="range-control"><input id="terminal-font-size" type="range" min="12" max="20" step="1" value={preferences.fontSize} onChange={event => setPreferences(previous => ({ ...previous, fontSize: Number(event.target.value) }))} /><output htmlFor="terminal-font-size">{preferences.fontSize}px</output></div></div>
        <div className="setting-row"><label htmlFor="reduce-motion">Reduce motion<span>Disables cursor blinking. CLI animation changes apply at its next start.</span></label><input id="reduce-motion" className="toggle" type="checkbox" checked={preferences.reducedMotion} onChange={event => setPreferences(previous => ({ ...previous, reducedMotion: event.target.checked }))} /></div>
        <div className="setting-row helper-setting"><div className="setting-label">Terminal support<span>{!bridge ? 'Available in the desktop app.' : state.helper.ready ? 'Ready on this computer.' : state.helper.message || 'Requires the existing host build tools.'}</span></div>{bridge && <button className="secondary-button" disabled={Boolean(busy) || running} onClick={() => action('helper', () => bridge.buildHelper())}>{busy === 'helper' ? 'Setting up…' : state.helper.ready ? 'Rebuild' : 'Set up'}</button>}</div>
        <footer><span>{state.appVersion ? 'Desktop ' + state.appVersion : 'Koto desktop'}{state.coreVersion ? ' · Core ' + state.coreVersion : ''}</span><button className="secondary-button" onClick={() => setSettingsOpen(false)}>Done</button></footer>
      </section>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
