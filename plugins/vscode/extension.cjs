'use strict';

const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { KotoClient } = require('./client.cjs');

const LIVE = new Set(['starting', 'running', 'stopping']);
const MAX_PROJECTS = 20;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_QUEUED_OUTPUT_BYTES = 256 * 1024;
const STATUS = {
  idle: 'Ready', starting: 'Starting', running: 'Running', stopping: 'Stopping',
  stopped: 'Stopped', failed: 'Needs attention', cleanup_unconfirmed: 'Cleanup unconfirmed',
};
const message = error => String(error?.message ?? error ?? 'Koto could not finish this operation.')
  .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 800);
const short = (text, maximum = 80) => String(text ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, maximum);
const dimensions = value => value && Number.isInteger(value.columns) && value.columns >= 2 && value.columns <= 1000
  && Number.isInteger(value.rows) && value.rows >= 2 && value.rows <= 1000 ? value : { columns: 100, rows: 30 };
const keyFor = target => JSON.stringify([target?.project ?? null, target?.session ?? null]);

function assertLocalTrusted() {
  if (!vscode.workspace.isTrusted) throw new Error('Trust this local workspace before opening Koto.');
  if (vscode.env.uiKind === vscode.UIKind.Web || vscode.env.remoteName
    || (vscode.workspace.workspaceFolders ?? []).some(folder => folder.uri.scheme !== 'file' || folder.uri.authority)) {
    throw new Error('Koto currently supports trusted local folders in the desktop IDE. Remote and browser workspaces need their own verification.');
  }
}

function userSetting(name) {
  // A project cannot select an executable or redirect the user's Koto state.
  const value = vscode.workspace.getConfiguration('koto').inspect(name)?.globalValue;
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)
    || Buffer.byteLength(value) > 4096) throw new Error(`Set Koto: ${name} to an absolute path in User settings.`);
  return value;
}

class WorkspaceTree {
  constructor() {
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.groups = [{ kind: 'group', id: 'projects' }, { kind: 'group', id: 'sessions' }];
    this.projects = [];
    this.sessions = [];
    this.state = { status: 'idle' };
  }
  update(snapshot, state, notice) {
    this.snapshot = snapshot;
    this.state = state;
    this.notice = notice;
    this.projects = (snapshot?.projects ?? []).slice(0, MAX_PROJECTS).map(record => ({ kind: 'project', record }));
    this.sessions = (snapshot?.sessions ?? []).slice(0, 20).map(record => ({ kind: 'session', record }));
    this.changed.fire(undefined);
  }
  getChildren(element) {
    if (!element) return [...this.groups, { kind: 'helper' },
      ...(this.notice ? [{ kind: 'notice', text: this.notice }] : []),
      ...(this.state.status !== 'idle' ? [{ kind: 'status' }] : [])];
    if (element.kind !== 'group') return [];
    if (element.id === 'projects') return this.projects.length ? this.projects : [{ kind: 'empty-projects' }];
    return this.sessions.length ? this.sessions : [{ kind: 'empty-sessions' }];
  }
  getParent(element) {
    if (element.kind === 'project' || element.kind === 'empty-projects') return this.groups[0];
    if (element.kind === 'session' || element.kind === 'empty-sessions') return this.groups[1];
    return undefined;
  }
  getTreeItem(element) {
    let item;
    if (element.kind === 'group') {
      const projects = element.id === 'projects';
      item = new vscode.TreeItem(projects ? 'Projects' : 'Saved sessions', vscode.TreeItemCollapsibleState.Expanded);
      item.id = `koto-${element.id}`;
      item.description = String(projects ? this.projects.length : this.sessions.length);
      item.iconPath = new vscode.ThemeIcon(projects ? 'folder-library' : 'history');
    } else if (element.kind === 'project') {
      const project = element.record;
      item = new vscode.TreeItem(short(project.name) || path.basename(project.path));
      item.id = `project-${project.id}`;
      item.contextValue = 'koto.project';
      item.iconPath = new vscode.ThemeIcon('folder');
      item.tooltip = project.path;
      if (this.state.project === project.path && LIVE.has(this.state.status)) item.description = 'CLI running';
    } else if (element.kind === 'session') {
      const session = element.record;
      item = new vscode.TreeItem(short(session.goal) || 'Saved Koto session');
      item.id = `session-${session.id}`;
      item.contextValue = 'koto.session';
      item.description = `${path.basename(session.project)}${session.active ? ' · active' : ''}`;
      item.tooltip = `${short(session.goal, 4096)}\n${session.project}\n${session.directory}`;
      item.iconPath = new vscode.ThemeIcon('history');
    } else if (element.kind === 'helper') {
      const ready = this.snapshot?.helper?.ready === true;
      item = new vscode.TreeItem(ready ? 'Terminal support ready' : 'Set up terminal support');
      item.id = 'koto-helper';
      item.iconPath = new vscode.ThemeIcon(ready ? 'check' : 'tools');
      item.tooltip = this.snapshot?.helper?.message ?? 'Build the matching local helper using the installed developer tools.';
      if (!ready) item.command = { command: 'koto.setUpTerminal', title: 'Set Up Terminal Support' };
    } else if (element.kind === 'empty-projects') {
      item = new vscode.TreeItem('Choose a local project');
      item.command = { command: 'koto.openProject', title: 'Open Project' };
      item.iconPath = new vscode.ThemeIcon('folder-opened');
    } else if (element.kind === 'empty-sessions') {
      item = new vscode.TreeItem('Saved builds appear here');
      item.tooltip = 'Open Koto to use its existing build, review and resume commands.';
    } else {
      const status = this.state.status;
      item = new vscode.TreeItem(short(element.kind === 'notice' ? element.text : STATUS[status] ?? status, 100));
      item.tooltip = element.kind === 'notice' ? element.text : this.state.error ?? STATUS[status] ?? status;
      item.iconPath = new vscode.ThemeIcon(status === 'cleanup_unconfirmed' || status === 'failed' ? 'warning' : 'info');
    }
    return item;
  }
  dispose() { this.changed.dispose(); }
}

class KotoTerminal {
  constructor(client, closed, overflow) {
    this.client = client;
    this.closedCallback = closed;
    this.overflowCallback = overflow;
    this.output = new vscode.EventEmitter();
    this.ended = new vscode.EventEmitter();
    this.onDidWrite = this.output.event;
    this.onDidClose = this.ended.event;
    this.queue = [];
    this.queuedBytes = 0;
    this.closed = false;
    this.finished = false;
    this.opened = new Promise(resolve => { this.resolveOpen = resolve; });
  }
  open(initialDimensions) { this.resolveOpen(dimensions(initialDimensions)); }
  handleInput(data) {
    if (this.closed || this.finished) return;
    if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_INPUT_BYTES) {
      this.write('\r\nKoto input is limited to 64 KiB per action. Send a smaller input.\r\n');
      return;
    }
    if (!this.client.write(data)) this.write('\r\nKoto is not accepting input. Check its state before trying again.\r\n');
  }
  setDimensions(value) {
    if (!this.closed && !this.finished && value && Number.isInteger(value.columns) && value.columns >= 2 && value.columns <= 1000
      && Number.isInteger(value.rows) && value.rows >= 2 && value.rows <= 1000) {
      this.client.resize(value.columns, value.rows);
    }
  }
  write(data) {
    if (this.closed || this.finished || typeof data !== 'string' || !data) return;
    const bytes = Buffer.byteLength(data);
    if (this.queuedBytes + bytes > MAX_QUEUED_OUTPUT_BYTES) {
      if (!this.overflowed) {
        this.overflowed = true;
        this.overflowCallback();
      }
      return;
    }
    this.queue.push(data);
    this.queuedBytes += bytes;
    if (!this.flushHandle) this.flushHandle = setImmediate(() => this.flush());
  }
  flush() {
    if (this.flushHandle) clearImmediate(this.flushHandle);
    this.flushHandle = undefined;
    const data = this.queue.join('');
    this.queue = [];
    this.queuedBytes = 0;
    if (data && !this.closed) this.output.fire(data);
  }
  finish(outcome) {
    if (this.closed || this.finished) return;
    this.flush();
    this.finished = true;
    const code = outcome?.status === 'stopped' && outcome.cleanupConfirmed === true ? 0
      : Number.isInteger(outcome?.exitCode) ? outcome.exitCode : outcome?.status === 'succeeded' ? 0 : 1;
    this.ended.fire(code);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.resolveOpen(undefined);
    this.flush();
    this.closedCallback(this);
  }
  cancelOpen() { this.resolveOpen(undefined); }
  dispose() {
    this.closed = true;
    this.cancelOpen();
    this.flush();
    this.output.dispose();
    this.ended.dispose();
  }
}

class KotoWorkspace {
  constructor(context) {
    this.context = context;
    this.tree = new WorkspaceTree();
    this.state = { status: 'idle' };
    this.queue = Promise.resolve();
    this.pendingOperations = 0;
    const bookmarks = context.globalState.get('koto.projectBookmarks', []);
    this.bookmarks = (Array.isArray(bookmarks) ? bookmarks : []).filter(value => typeof value === 'string'
      && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value) && Buffer.byteLength(value) <= 4096).slice(0, MAX_PROJECTS);
    this.view = vscode.window.createTreeView('koto.workspace', { treeDataProvider: this.tree, showCollapseAll: true });
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 25);
    this.statusBar.command = 'koto.openKoto';
    this.statusBar.text = '$(terminal) Koto';
    this.statusBar.show();
    context.subscriptions.push(this.tree, this.view, this.statusBar);
    this.register();
  }
  serial(operation) {
    if (this.disposing) return Promise.reject(new Error('Koto is closing.'));
    if (this.pendingOperations >= 8) return Promise.reject(new Error('Koto is finishing pending operations. Wait before trying again.'));
    this.pendingOperations += 1;
    const next = this.queue.then(() => {
      if (this.disposing) throw new Error('Koto is closing.');
      assertLocalTrusted();
      return operation();
    }).finally(() => { this.pendingOperations -= 1; });
    this.queue = next.catch(() => {});
    return next;
  }
  register() {
    const command = (name, operation) => this.context.subscriptions.push(vscode.commands.registerCommand(name,
      item => this.serial(() => operation(item)).catch(error => this.showError(error))));
    command('koto.openKoto', item => this.openKoto(item));
    command('koto.openProject', () => this.openProject());
    command('koto.openSavedSession', item => this.openSavedSession(item));
    command('koto.refresh', () => this.refresh());
    command('koto.setUpTerminal', () => this.buildHelper());
    command('koto.stop', () => this.stop());
    this.context.subscriptions.push(this.view.onDidChangeSelection(event => {
      const item = event.selection[0];
      // Native tree selection only chooses navigation; it never launches work.
      if (item?.kind === 'project') this.selected = { project: item.record.path };
      else if (item?.kind === 'session') this.selected = { project: item.record.project, session: item.record.id };
      this.render();
    }));
    this.context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
      if (terminal === this.terminal && this.presentation) this.terminalClosed(this.presentation);
    }));
    this.context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()));
    this.context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => this.scheduleRefresh()));
    this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('koto.nodePath') || event.affectsConfiguration('koto.stateDirectory')) {
        if (LIVE.has(this.state.status) || this.state.status === 'cleanup_unconfirmed') {
          this.notice = 'Stop the current Koto CLI before applying changed runtime or state-directory settings.';
          this.render();
        } else this.scheduleRefresh();
      }
    }));
  }
  showError(error) {
    if (this.disposing) return;
    this.notice = message(error);
    this.render();
    void vscode.window.showErrorMessage(this.notice);
  }
  render() {
    if (this.disposing) return;
    this.tree.update(this.snapshotValue, this.state, this.notice ?? this.snapshotValue?.notice);
    this.view.description = this.snapshotValue ? `${this.snapshotValue.coreVersion} · ${STATUS[this.state.status] ?? this.state.status}` : 'Local CLI';
    this.statusBar.text = `${this.state.status === 'cleanup_unconfirmed' ? '$(warning)' : '$(terminal)'} Koto`;
    this.statusBar.tooltip = [STATUS[this.state.status] ?? this.state.status, this.selected?.project,
      this.state.error, 'Open Koto to use setup, /sessions, /resume, /review and /integrate.'].filter(Boolean).join('\n');
    void vscode.commands.executeCommand('setContext', 'koto.cliRunning', LIVE.has(this.state.status)).then(undefined, () => {});
  }
  scheduleRefresh() {
    if (this.disposing || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.serial(() => this.refresh()).catch(error => { this.notice = message(error); this.render(); });
    }, 100);
  }
  async ensureClient() {
    if (this.disposing) throw new Error('Koto is closing.');
    const settings = { nodePath: userSetting('nodePath'), stateDirectory: userSetting('stateDirectory') };
    const key = JSON.stringify(settings);
    if (this.client && this.settingsKey === key) return this.client;
    if (this.client && (LIVE.has(this.state.status) || this.state.status === 'cleanup_unconfirmed')) {
      throw new Error('Stop Koto and confirm cleanup before applying runtime or state-directory changes.');
    }
    if (this.client) {
      await this.client.dispose();
      this.client.removeListener('state', this.stateListener);
      this.client.removeListener('output', this.outputListener);
      this.client.removeListener('completion', this.completionListener);
    }
    this.client = new KotoClient({ extensionPath: this.context.extensionPath,
      storagePath: this.context.globalStorageUri.fsPath, ...settings });
    this.settingsKey = key;
    this.state = this.client.state;
    this.stateListener = state => { this.state = state; this.render(); };
    this.outputListener = data => { if (!this.disposing) this.presentation?.write(data); };
    this.completionListener = outcome => {
      if (this.disposing) return;
      this.presentation?.finish(outcome);
      this.scheduleRefresh();
    };
    this.client.on('state', this.stateListener);
    this.client.on('output', this.outputListener);
    this.client.on('completion', this.completionListener);
    return this.client;
  }
  projectPaths() {
    return [...new Set([...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath), ...this.bookmarks])].slice(0, MAX_PROJECTS);
  }
  async refresh() {
    const client = await this.ensureClient();
    this.snapshotValue = await client.snapshot(this.projectPaths());
    this.state = client.state;
    this.notice = undefined;
    if (!this.selected && this.snapshotValue.projects.length === 1) this.selected = { project: this.snapshotValue.projects[0].path };
    this.render();
    return this.snapshotValue;
  }
  async openProject() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    let chosen;
    if (folders.length) {
      const selected = await vscode.window.showQuickPick([
        ...folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, uri: folder.uri })),
        { label: 'Choose another folder…', picker: true },
      ], { title: 'Koto: Choose a project', placeHolder: 'Select a local project; this does not start agents.' });
      if (!selected) return;
      if (!selected.picker) chosen = selected.uri;
    }
    if (!chosen) {
      const result = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true,
        canSelectMany: false, openLabel: 'Select Koto project', title: 'Koto: Choose a local project' });
      if (!result?.[0]) return;
      chosen = result[0];
    }
    if (chosen.scheme !== 'file' || chosen.authority) throw new Error('Choose a folder on this computer.');
    const canonical = await fs.realpath(chosen.fsPath);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Choose a project directory.');
    this.bookmarks = [canonical, ...this.bookmarks.filter(value => value !== canonical)].slice(0, MAX_PROJECTS);
    await this.context.globalState.update('koto.projectBookmarks', this.bookmarks);
    await this.refresh();
    const item = this.tree.projects.find(item => item.record.path === canonical);
    if (!item) throw new Error('The selected project is unavailable. Refresh and choose it again.');
    this.selected = { project: item.record.path };
    await this.view.reveal(item, { select: true, focus: true });
    this.render();
  }
  target(item) {
    if (item?.kind === 'project') {
      const record = this.snapshotValue.projects.find(project => project.id === item.record?.id);
      if (!record) throw new Error('This project is unavailable. Refresh and select it again.');
      return { project: record.path };
    }
    if (item?.kind === 'session') {
      const record = this.snapshotValue.sessions.find(session => session.id === item.record?.id);
      if (!record) throw new Error('This saved session is unavailable. Refresh and select it again.');
      return { project: record.project, session: record.id };
    }
    return this.selected ? { ...this.selected } : {};
  }
  async openSavedSession(item) {
    await this.refresh();
    if (item?.kind !== 'session') {
      if (!this.snapshotValue.sessions.length) {
        await vscode.window.showInformationMessage('No saved Koto builds yet. Open Koto to start your project workflow.');
        return;
      }
      const chosen = await vscode.window.showQuickPick(this.snapshotValue.sessions.map(record => ({
        label: short(record.goal) || 'Saved session', description: path.basename(record.project), detail: record.directory,
        item: { kind: 'session', record },
      })), { title: 'Koto: Open saved session', placeHolder: 'Choose saved work. Continue it explicitly with /resume in Koto.' });
      if (!chosen) return;
      item = chosen.item;
    }
    return this.openKoto(item);
  }
  async buildHelper() {
    const client = await this.ensureClient();
    if (LIVE.has(client.state.status) || client.state.status === 'cleanup_unconfirmed') {
      throw new Error('Stop Koto and confirm cleanup before setting up terminal support.');
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Koto: Setting up local terminal support', cancellable: false },
      () => client.buildHelper());
    return this.refresh();
  }
  async openKoto(item) {
    await this.refresh();
    let client = this.client;
    if (client.state.status === 'cleanup_unconfirmed') throw new Error('Koto cleanup is unconfirmed. Inspect the retained session before opening a replacement CLI.');
    const target = this.target(item);
    if (target.project && !this.snapshotValue.projects.some(project => project.path === target.project)
      || target.session && !this.snapshotValue.sessions.some(session => session.id === target.session && session.project === target.project)) {
      throw new Error('This selection is unavailable. Refresh and choose the project or session again.');
    }
    if (LIVE.has(client.state.status)) {
      if (this.terminal && this.activeKey === keyFor(target)) { this.terminal.show(false); return; }
      const answer = await vscode.window.showWarningMessage('Stop the current Koto CLI and switch?', { modal: true }, 'Stop and switch', 'Keep current');
      if (answer !== 'Stop and switch') return;
      await this.requestStop();
      if (client.state.status === 'cleanup_unconfirmed') throw new Error('Koto could not confirm cleanup. No replacement CLI was started.');
      await this.refresh();
      client = this.client;
      if (target.project && !this.snapshotValue.projects.some(project => project.path === target.project)
        || target.session && !this.snapshotValue.sessions.some(session => session.id === target.session && session.project === target.project)) {
        throw new Error('This selection is unavailable. Refresh and choose the project or session again.');
      }
    }
    const session = this.snapshotValue.sessions.find(saved => saved.id === target.session);
    if (session?.active) throw new Error('This saved session is active. Stop its current owner before reopening it.');
    if (!this.snapshotValue.helper.ready) {
      const answer = await vscode.window.showInformationMessage('Koto needs its matching local terminal helper. Build it with the developer tools already installed on this computer?', 'Set up terminal support', 'Cancel');
      if (answer !== 'Set up terminal support') return;
      await this.buildHelper();
    }
    const oldTerminal = this.terminal;
    this.terminal = undefined;
    this.presentation?.dispose();
    this.presentation = undefined;
    oldTerminal?.dispose();
    const presentation = new KotoTerminal(client, terminal => this.terminalClosed(terminal), () => {
      this.notice = 'Koto terminal output exceeded its bounded queue. The CLI is stopping; inspect its retained session before continuing.';
      this.render();
      void this.requestStop().catch(error => this.showError(error));
    });
    this.presentation = presentation;
    this.activeKey = keyFor(target);
    this.selected = target;
    this.terminal = vscode.window.createTerminal({ name: 'Koto', pty: presentation, isTransient: true });
    this.terminal.show(false);
    let timer;
    try {
      const size = await Promise.race([presentation.opened, new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 15_000); })]);
      if (!size || this.disposing || presentation.closed) throw new Error('The Koto terminal closed before its CLI started.');
      await client.start({ ...target, cols: size.columns, rows: size.rows });
      this.render();
    } catch (error) {
      presentation.write(`\r\n${message(error)}\r\n`);
      presentation.finish({ exitCode: 1 });
      throw error;
    } finally { clearTimeout(timer); }
  }
  terminalClosed(presentation) {
    if (presentation !== this.presentation || presentation.closeHandled) return;
    presentation.closeHandled = true;
    presentation.cancelOpen();
    this.terminal = undefined;
    // Retain the asynchronous owner until stop confirms cleanup; a terminal's
    // disposal alone is never used as evidence that native work has settled.
    if (this.disposing) return;
    // Cleanup bypasses the presentation command queue and trust checks. There
    // is still only one stop promise, even if close and Stop happen together.
    this.closePromise = this.requestStop().then(() => this.render()).catch(error => this.showError(error));
  }
  requestStop() {
    if (this.stopPromise) return this.stopPromise;
    if (!this.client) return Promise.resolve();
    const client = this.client;
    this.stopPromise = Promise.resolve().then(() => client.stop()).finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
  }
  async stop() {
    if (!this.client) return;
    await this.requestStop();
    this.state = this.client.state;
    await this.refresh();
  }
  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposing = true;
    clearTimeout(this.refreshTimer);
    this.presentation?.cancelOpen();
    this.disposePromise = (async () => {
      // The runner also owns EOF shutdown when an IDE terminates its extension
      // host before this promise can finish.
      let error;
      try { await this.client?.dispose(); } catch (failure) { error = failure; }
      this.presentation?.dispose();
      this.terminal?.dispose();
      if (error) throw error;
    })();
    return this.disposePromise;
  }
}

let workspace;
exports.activate = async context => {
  workspace = new KotoWorkspace(context);
  try { await workspace.serial(() => workspace.refresh()); }
  catch (error) { workspace.notice = message(error); workspace.render(); }
};
exports.deactivate = () => workspace?.dispose();
