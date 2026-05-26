import type { NodeGripApi } from '~preload/index.js';

declare global {
  interface Window {
    nodeGrip: NodeGripApi;
  }
}

export const ipc = window.nodeGrip;
