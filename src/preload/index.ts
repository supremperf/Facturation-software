import { contextBridge, ipcRenderer } from 'electron';
import { INVOKE_CHANNELS, APP_EVENTS, type AppEventName, type IpcEnvelope } from '../shared/ipc';

const allowedChannels = new Set<string>(INVOKE_CHANNELS);
const allowedEvents = new Set<string>(Object.values(APP_EVENTS));

const api = {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<IpcEnvelope<T>> {
    if (!allowedChannels.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { message: `Canal IPC non autorisé : ${channel}`, code: 'IPC_FORBIDDEN' },
      });
    }
    return ipcRenderer.invoke(channel, payload) as Promise<IpcEnvelope<T>>;
  },
  on(event: string, callback: (payload: unknown) => void): () => void {
    if (!allowedEvents.has(event)) return () => undefined;
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(event as AppEventName, listener);
    return () => ipcRenderer.removeListener(event as AppEventName, listener);
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
};

contextBridge.exposeInMainWorld('facturepro', api);
