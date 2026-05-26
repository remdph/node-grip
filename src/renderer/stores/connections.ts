import { create } from 'zustand';

import { ipc } from '../lib/ipc.js';
import type { ConnectionState } from '~shared/types/datasource.js';

interface ConnectionsState {
  /** Latest known state per datasource id. Empty / missing ids
   * default to "disconnected" via `selectState`. */
  states: Record<string, ConnectionState>;
  /** Lazy-init flag — `bootstrap()` subscribes to main's broadcast
   * once per renderer; consumers should call it from a useEffect on
   * mount and the first invocation wins. */
  subscribed: boolean;
  /** Subscribe the store to main's connection-state broadcast.
   * Idempotent — subsequent calls are no-ops. Returns an unsubscribe
   * function for symmetry; not strictly needed because the main
   * process tears down on app quit. */
  bootstrap(): () => void;
  /** Refresh a single id by asking main for the current snapshot. The
   * panel calls this on mount per datasource so first-paint has the
   * right chip color even before a state change fires. */
  hydrate(id: string): void;
  /** Direct write used by the IPC handler — components shouldn't
   * touch this themselves; updates flow in through `bootstrap`. */
  set(state: ConnectionState): void;
}

// Module-level so the IPC subscription survives panel unmount / HMR.
// Returning a no-op from `bootstrap` keeps React's effect cleanup
// from dropping the long-lived listener.
let connectionsSubscribed = false;

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  states: {},
  subscribed: false,

  bootstrap: () => {
    if (!connectionsSubscribed) {
      connectionsSubscribed = true;
      set({ subscribed: true });
      ipc.datasource.onConnectionStateChange((state) => {
        get().set(state);
      });
    }
    return () => {};
  },

  hydrate: (id) => {
    void ipc.datasource.getConnectionState(id).then((snapshot) => {
      get().set(snapshot);
    });
  },

  set: (state) =>
    set((s) => ({
      states: { ...s.states, [state.id]: state },
    })),
}));
