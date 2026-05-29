import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface ProjectTab {
  id: string;
  /** Display name (project metadata name; falls back to folder basename). */
  name: string;
  /** Absolute path to the project folder on disk. */
  folderPath: string;
}

export interface RecentProject {
  folderPath: string;
  name: string;
  /** ISO timestamp of the most recent open. */
  lastOpenedAt: string;
}

export type View = 'picker' | 'tab';

interface TabsState {
  tabs: ProjectTab[];
  activeId: string | null;
  view: View;
  recents: RecentProject[];
  /** Folder paths the user has starred from the home view. Lookup is O(n)
   * but the list is tiny so it doesn't matter. */
  starred: string[];
  /** Visibility of the project-view side panels. Persisted globally
   * (not per-project) — matches DataGrip / IntelliJ behaviour where
   * toggling a tool window applies across all open projects. */
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  /** Width in px of the home view sidebar. */
  homeSidebarWidth: number;
  setHomeSidebarWidth(width: number): void;
  setView(view: View): void;
  close(id: string): void;
  activate(id: string): void;
  openProject(input: { folderPath: string; name?: string }): void;
  /** Update the visible name for a tab (e.g. after the user renames it). */
  updateName(tabId: string, name: string): void;
  /** Move a tab from `fromIndex` to `toIndex` (drag-and-drop reorder).
   * `toIndex` is the slot the tab should occupy AFTER removal — same
   * convention as the HTML5 DnD drop position the titlebar passes in. */
  reorder(fromIndex: number, toIndex: number): void;
  closeAll(): void;
  addRecent(input: { folderPath: string; name?: string }): void;
  removeRecent(folderPath: string): void;
  toggleStarred(folderPath: string): void;
  toggleLeftSidebar(): void;
  toggleRightSidebar(): void;
}

const RECENTS_MAX = 10;

const makeId = () => `tab-${Math.random().toString(36).slice(2, 10)}`;

function deriveName(folderPath: string): string {
  return folderPath.split(/[\\/]/).pop() ?? folderPath;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
      view: 'picker',
      recents: [],
      starred: [],
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      homeSidebarWidth: 232,

      setHomeSidebarWidth: (width) => set({ homeSidebarWidth: width }),

      setView: (view) => set({ view }),

      close: (id) => {
        const { tabs, activeId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx === -1) return;
        const next = tabs.filter((t) => t.id !== id);
        if (next.length === 0) {
          set({ tabs: [], activeId: null, view: 'picker' });
          return;
        }
        let nextActive = activeId;
        if (activeId === id) {
          const fallback = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
          nextActive = fallback?.id ?? null;
        }
        set({ tabs: next, activeId: nextActive });
      },

      activate: (id) => {
        if (get().tabs.some((t) => t.id === id)) {
          set({ activeId: id, view: 'tab' });
        }
      },

      openProject: ({ folderPath, name }) => {
        const finalName = name?.trim() || deriveName(folderPath);
        const { tabs } = get();
        const existing = tabs.find((t) => t.folderPath === folderPath);
        if (existing) {
          set({ activeId: existing.id, view: 'tab' });
        } else {
          const tab: ProjectTab = {
            id: makeId(),
            name: finalName,
            folderPath,
          };
          set({ tabs: [...tabs, tab], activeId: tab.id, view: 'tab' });
        }
        get().addRecent({ folderPath, name: finalName });
      },

      updateName: (tabId, name) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, name } : t)),
        })),

      reorder: (fromIndex, toIndex) =>
        set((s) => {
          if (fromIndex === toIndex) return {};
          if (fromIndex < 0 || fromIndex >= s.tabs.length) return {};
          if (toIndex < 0 || toIndex > s.tabs.length) return {};
          const next = s.tabs.slice();
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return {};
          const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
          next.splice(insertAt, 0, moved);
          return { tabs: next };
        }),

      closeAll: () => set({ tabs: [], activeId: null, view: 'picker' }),

      addRecent: ({ folderPath, name }) => {
        const finalName = name?.trim() || deriveName(folderPath);
        set((s) => {
          const filtered = s.recents.filter((r) => r.folderPath !== folderPath);
          const next: RecentProject = {
            folderPath,
            name: finalName,
            lastOpenedAt: new Date().toISOString(),
          };
          return { recents: [next, ...filtered].slice(0, RECENTS_MAX) };
        });
      },

      removeRecent: (folderPath) =>
        set((s) => ({
          recents: s.recents.filter((r) => r.folderPath !== folderPath),
          // Remove the starred mark too so we never end up with a dangling
          // path that the user can't unstar.
          starred: s.starred.filter((p) => p !== folderPath),
        })),

      toggleStarred: (folderPath) =>
        set((s) => ({
          starred: s.starred.includes(folderPath)
            ? s.starred.filter((p) => p !== folderPath)
            : [...s.starred, folderPath],
        })),

      toggleLeftSidebar: () =>
        set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
      toggleRightSidebar: () =>
        set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
    }),
    {
      name: 'node-grip:tabs',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeId: state.activeId,
        view: state.view,
        recents: state.recents,
        starred: state.starred,
        leftSidebarOpen: state.leftSidebarOpen,
        rightSidebarOpen: state.rightSidebarOpen,
        homeSidebarWidth: state.homeSidebarWidth,
      }),
      // Defensive normalization on rehydrate: if tabs is empty, force
      // activeId/view back to "home". Without this guard, stale state can
      // convince App.tsx that there's a tab to show even when there isn't.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!Array.isArray(state.tabs) || state.tabs.length === 0) {
          state.tabs = [];
          state.activeId = null;
          state.view = 'picker';
        } else if (!state.tabs.some((t) => t.id === state.activeId)) {
          state.activeId = state.tabs[0]?.id ?? null;
          if (state.activeId === null) state.view = 'picker';
        }
      },
      // v1: first project-oriented schema. Older PDF-era persisted state
      // (PdfTab.filePath etc.) is dropped on first load — the pivot to a
      // database client makes the previous payload meaningless.
      // v2: adds left/right sidebar visibility toggles.
      // v3: adds homeSidebarWidth.
      version: 3,
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== 'object') return persisted;
        let next = persisted as Record<string, unknown>;
        if (version < 2) {
          next = {
            ...next,
            leftSidebarOpen: true,
            rightSidebarOpen: true,
          };
        }
        if (version < 3) {
          next = {
            ...next,
            homeSidebarWidth: 232,
          };
        }
        return next;
      },
    },
  ),
);
