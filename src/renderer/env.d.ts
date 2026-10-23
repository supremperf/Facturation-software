/// <reference types="vite/client" />

import type { IpcEnvelope } from '@shared/ipc';

declare global {
  interface Window {
    facturepro: {
      invoke<T = unknown>(channel: string, payload?: unknown): Promise<IpcEnvelope<T>>;
      on(event: string, callback: (payload: unknown) => void): () => void;
      platform: string;
      versions: { electron: string; chrome: string; node: string };
    };
  }
  const __APP_VERSION__: string;
}

export {};
