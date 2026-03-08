import { wsBridge } from './services/websocketClient';

type IpcUnsubscribe = () => void;

export type RendererIpc = {
  on: (channel: string, callback: (event: any, data: any) => void) => IpcUnsubscribe;
  send: (channel: string, data?: any) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
};

// WebSocket implementation of IPC for browser environment
const webSocketIPC: RendererIpc = {
  on: (channel: string, callback: (event: any, data: any) => void) => {
    const handler = (data: any) => callback({}, data);
    wsBridge.on(channel, handler);
    return () => wsBridge.off(channel, handler);
  },
  send: (channel: string, data?: any) => {
    wsBridge.send(channel, data);
  },
  invoke: (channel: string, ...args: any[]) => {
    return wsBridge.invoke(channel, ...args);
  }
};

export const ipc: RendererIpc = (window as any).electron ? (window as any).electron : webSocketIPC;

