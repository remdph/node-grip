import { useEffect } from 'react';

import { HomeView } from './components/HomeView.js';
import { ProjectView } from './components/ProjectView.js';
import { TitleBar } from './components/TitleBar.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { ipc } from './lib/ipc.js';
import { applyTheme } from './lib/theme.js';
import { useSettingsStore } from './stores/settings.js';
import { useTabsStore } from './stores/tabs.js';

export function App(): JSX.Element {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const view = useTabsStore((s) => s.view);
  const openProject = useTabsStore((s) => s.openProject);
  const loadSettings = useSettingsStore((s) => s.load);
  const theme = useSettingsStore((s) => s.settings.theme);

  // Pull the persisted settings on mount. main.tsx already applied the
  // cached theme synchronously to avoid a flash, but settings.json is
  // the source of truth — reconcile here once it lands.
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // App menu "File → Open Project…" pushes a message here so the same
  // picker the HomeView uses drives the menu shortcut.
  useEffect(() => {
    if (!ipc?.app?.onOpenProject) return;
    return ipc.app.onOpenProject(async () => {
      const folderPath = await ipc.project.pickFolder();
      if (!folderPath) return;
      const info = await ipc.project.open(folderPath);
      openProject({ folderPath: info.folderPath, name: info.metadata.name });
    });
  }, [openProject]);

  // Cmd+W (macOS) / Ctrl+W (Win/Linux): close the active tab instead of
  // the whole window. preventDefault() in the renderer stops Electron's
  // built-in "close window" shortcut from firing. The store is read via
  // getState() so the effect doesn't need to re-bind on every tab change.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const accel = ipc.platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!accel) return;
      if (e.key !== 'w' && e.key !== 'W') return;
      e.preventDefault();
      const state = useTabsStore.getState();
      if (state.activeId) state.close(state.activeId);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  // Render every open tab's ProjectView side-by-side and toggle visibility
  // via CSS instead of mounting/unmounting. That way each tab keeps its
  // internal state (future: open queries, scroll position, schema selection)
  // across tab switches.
  //
  // Belt-and-suspenders: if there are no tabs at all, always show home
  // regardless of `view`/`activeId`. The tabs store normalises on
  // rehydration to keep these in sync, but stale state shouldn't leave
  // the user staring at a blank surface.
  const showHome = tabs.length === 0 || view !== 'tab' || activeId === null;

  return (
    <main className="app">
      <TitleBar />
      <div className="app-content">
        <div className="app-body">
          {tabs.map((tab) => {
            const isActive = view === 'tab' && tab.id === activeId;
            return (
              <div
                key={tab.id}
                className={`project-view-host${isActive ? '' : ' project-view-host-hidden'}`}
              >
                <ProjectView folderPath={tab.folderPath} name={tab.name} />
              </div>
            );
          })}
          {showHome && <HomeView />}
        </div>
      </div>
      <UpdateBanner />
    </main>
  );
}
