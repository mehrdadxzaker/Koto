'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (method, payload) => ipcRenderer.invoke(`koto:${method}`, payload);
contextBridge.exposeInMainWorld('kotoDesktop', Object.freeze({
  getState: () => invoke('state'),
  refresh: () => invoke('refresh'),
  chooseProject: () => invoke('choose-project'),
  start: options => invoke('start', options),
  stop: () => invoke('stop'),
  buildHelper: () => invoke('build-helper'),
  write: value => invoke('write', value),
  resize: value => invoke('resize', value),
  ack: value => invoke('ack', value),
  onEvent(callback) {
    if (typeof callback !== 'function') throw new TypeError('An event callback is required.');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('koto:event', listener);
    return () => ipcRenderer.removeListener('koto:event', listener);
  },
}));
