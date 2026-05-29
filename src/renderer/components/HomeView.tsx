import { useEffect, useState, useRef, useCallback } from 'react';

import iconUrl from '../assets/icon.png';
import { ipc } from '../lib/ipc.js';
import { useTabsStore, type RecentProject } from '../stores/tabs.js';
import { CreateProjectDialog } from './CreateProjectDialog.js';
import { UpdaterStatus } from './UpdaterStatus.js';

type ViewMode = 'list' | 'grid';
type HomeSection = 'recent' | 'starred' | 'computer';

interface HomeFolder {
  name: string;
  path: string;
}

export function HomeView(): JSX.Element {
  const recents = useTabsStore((s) => s.recents);
  const starred = useTabsStore((s) => s.starred);
  const openProject = useTabsStore((s) => s.openProject);
  const setHomeSidebarWidth = useTabsStore((s) => s.setHomeSidebarWidth);
  const homeSidebarWidth = useTabsStore((s) => s.homeSidebarWidth);
  const toggleStarred = useTabsStore((s) => s.toggleStarred);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [section, setSection] = useState<HomeSection>('recent');
  const [createOpen, setCreateOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null);

  /** Drive the project picker: pick a folder, then run `project.open`
   * which reads existing metadata or auto-initialises `.nodegrip/`. */
  const pickAndOpen = async (defaultPath?: string) => {
    const folderPath = await ipc.project.pickFolder(defaultPath);
    if (!folderPath) return;
    const info = await ipc.project.open(folderPath);
    openProject({ folderPath: info.folderPath, name: info.metadata.name });
  };

  const openRecent = (r: RecentProject) =>
    openProject({ folderPath: r.folderPath, name: r.name });

  const starredProjects = recents.filter((r) => starred.includes(r.folderPath));
  const isStarred = (folderPath: string) => starred.includes(folderPath);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = homeSidebarWidth;
  }, [homeSidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(160, Math.min(480, startWidthRef.current + delta));
      setHomeSidebarWidth(newWidth);
    };
    const onMouseUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizing, setHomeSidebarWidth]);

  return (
    <div className="home">
      <header className="home-welcome">
        {/* macOS keeps the brand icon here because the titlebar slot is
         * reserved for the native traffic lights and shows no brand.
         * Win/Linux already have the brand in the titlebar, so we swap
         * in a neutral info glyph instead — keeps the visual rhythm of
         * the header without duplicating the logo. */}
        {ipc.platform === 'darwin' ? (
          <img src={iconUrl} alt="" className="home-welcome-icon" aria-hidden draggable={false} />
        ) : (
          <span className="home-welcome-icon home-welcome-icon-info" aria-hidden>
            <InfoIcon />
          </span>
        )}
        <span className="home-welcome-text">Welcome to NodeGrip</span>
        <button
          type="button"
          className="home-welcome-link"
          onClick={() => pickAndOpen()}
        >
          Open Project
        </button>
      </header>
      <div className="home-body">
        <aside
          className="home-sidebar"
          ref={sidebarRef}
          style={{ width: homeSidebarWidth }}
          aria-label="Navigation"
        >
          <nav>
            <ul className="home-nav">
              <li>
                <SidebarItem
                  icon={<IconClock />}
                  label="Recent"
                  active={section === 'recent'}
                  onClick={() => setSection('recent')}
                />
              </li>
              <li>
                <SidebarItem
                  icon={<IconStarOutline />}
                  label="Starred"
                  active={section === 'starred'}
                  onClick={() => setSection('starred')}
                />
              </li>
              <li>
                <SidebarItem
                  icon={<IconComputer />}
                  label="Your computer"
                  active={section === 'computer'}
                  onClick={() => setSection('computer')}
                />
              </li>
            </ul>
          </nav>
          <UpdaterStatus />
        </aside>
        <div
          className={`home-sidebar-resizer${isResizing ? ' is-resizing' : ''}`}
          onMouseDown={onResizeStart}
        />

        <main className="home-main">
          {section === 'recent' && (
            <RecentSection
              recents={recents}
              viewMode={viewMode}
              setViewMode={setViewMode}
              onOpen={() => pickAndOpen()}
              onCreate={() => setCreateOpen(true)}
              onOpenRecent={openRecent}
              isStarred={isStarred}
              onToggleStar={toggleStarred}
            />
          )}
          {section === 'starred' && (
            <StarredSection
              starred={starredProjects}
              viewMode={viewMode}
              setViewMode={setViewMode}
              onOpenRecent={openRecent}
              onToggleStar={toggleStarred}
              onGoToRecent={() => setSection('recent')}
            />
          )}
          {section === 'computer' && (
            <ComputerSection
              onPickInFolder={(folder) => pickAndOpen(folder)}
              onBrowse={() => pickAndOpen()}
            />
          )}
        </main>
      </div>

      {createOpen && (
        <CreateProjectDialog
          onCancel={() => setCreateOpen(false)}
          onCreated={(info) => {
            setCreateOpen(false);
            openProject({
              folderPath: info.folderPath,
              name: info.metadata.name,
            });
          }}
        />
      )}
    </div>
  );
}

/* --- Sidebar item ------------------------------------------------------- */

interface SidebarItemProps {
  icon: JSX.Element;
  label: string;
  active: boolean;
  onClick(): void;
}

function SidebarItem({ icon, label, active, onClick }: SidebarItemProps): JSX.Element {
  return (
    <button
      type="button"
      className={`home-nav-item${active ? ' home-nav-active' : ''}`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* --- Recent section ----------------------------------------------------- */

interface RecentSectionProps {
  recents: RecentProject[];
  viewMode: ViewMode;
  setViewMode(mode: ViewMode): void;
  onOpen(): void;
  onCreate(): void;
  onOpenRecent(recent: RecentProject): void;
  isStarred(folderPath: string): boolean;
  onToggleStar(folderPath: string): void;
}

function RecentSection({
  recents,
  viewMode,
  setViewMode,
  onOpen,
  onCreate,
  onOpenRecent,
  isStarred,
  onToggleStar,
}: RecentSectionProps): JSX.Element {
  return (
    <>
      <section className="home-card home-card-tools" aria-label="Recommended actions">
        <header className="home-card-header">
          <h2 className="home-card-title">Get started</h2>
        </header>
        <div className="home-tools">
          <ToolItem
            icon={<IconOpenFolder />}
            accent="open"
            title="Open a project"
            desc="Pick a folder from your computer; existing projects are recognised, fresh folders are initialised on the fly."
            cta="Open"
            onClick={onOpen}
          />
          <ToolItem
            icon={<IconNewFolder />}
            accent="new"
            title="Create a project"
            desc="Type a name for a new folder and choose where to place it. NodeGrip will create it and write the project metadata under .nodegrip/."
            cta="Create"
            onClick={onCreate}
          />
        </div>
      </section>

      <RecentsBlock
        title="Recent"
        items={recents}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onOpen={onOpenRecent}
        emptyHeading="No recent projects yet"
        emptyHint="Open a project folder to get started."
        isStarred={isStarred}
        onToggleStar={onToggleStar}
      />
    </>
  );
}

/* --- Starred section ---------------------------------------------------- */

interface StarredSectionProps {
  starred: RecentProject[];
  viewMode: ViewMode;
  setViewMode(mode: ViewMode): void;
  onOpenRecent(recent: RecentProject): void;
  onToggleStar(folderPath: string): void;
  onGoToRecent(): void;
}

function StarredSection({
  starred,
  viewMode,
  setViewMode,
  onOpenRecent,
  onToggleStar,
  onGoToRecent,
}: StarredSectionProps): JSX.Element {
  if (starred.length === 0) {
    return (
      <section className="home-recents-section home-empty-section" aria-label="Starred">
        <header className="home-recents-header">
          <h2 className="home-card-title">Starred</h2>
          <ViewToggle mode={viewMode} setMode={setViewMode} />
        </header>
        <div className="home-empty">
          <div className="home-empty-icon" aria-hidden>
            <IconStarOutlineLarge />
          </div>
          <div className="home-empty-title">No starred projects yet.</div>
          <div className="home-empty-desc">Your starred projects will appear here.</div>
          <button type="button" className="home-empty-cta" onClick={onGoToRecent}>
            Star from Recent
          </button>
        </div>
      </section>
    );
  }
  return (
    <RecentsBlock
      title="Starred"
      items={starred}
      viewMode={viewMode}
      setViewMode={setViewMode}
      onOpen={onOpenRecent}
      emptyHeading="No starred projects yet."
      emptyHint="Your starred projects will appear here."
      isStarred={() => true}
      onToggleStar={onToggleStar}
    />
  );
}

/* --- Your computer section --------------------------------------------- */

interface ComputerSectionProps {
  /** Open the system "Choose folder" dialog rooted at the given folder. */
  onPickInFolder(folderPath: string): void;
  /** Open the dialog with no preset folder (OS default). */
  onBrowse(): void;
}

function ComputerSection({ onPickInFolder, onBrowse }: ComputerSectionProps): JSX.Element {
  const [folders, setFolders] = useState<HomeFolder[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ipc.shell.homeFolders().then((list) => {
      if (!cancelled) setFolders(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="home-recents-section" aria-label="Your computer">
      <header className="home-recents-header">
        <h2 className="home-card-title">Your computer</h2>
      </header>
      {folders === null ? (
        <div className="home-recents-empty">Loading folders…</div>
      ) : folders.length === 0 ? (
        <div className="home-recents-empty">No standard folders detected on this machine.</div>
      ) : (
        <ul className="home-folders">
          {folders.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="home-folder-item"
                onClick={() => onPickInFolder(f.path)}
                title={`Pick a project folder from ${f.path}`}
              >
                <span className="home-folder-icon" aria-hidden>
                  <IconFolder />
                </span>
                <span className="home-folder-text">
                  <span className="home-folder-name">{f.name}</span>
                  <span className="home-folder-path">{f.path}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="home-browse-btn" onClick={onBrowse}>
        Browse
      </button>
    </section>
  );
}

/* --- Recents block (list/grid) shared between Recent and Starred -------- */

interface RecentsBlockProps {
  title: string;
  items: RecentProject[];
  viewMode: ViewMode;
  setViewMode(mode: ViewMode): void;
  onOpen(recent: RecentProject): void;
  emptyHeading: string;
  emptyHint: string;
  isStarred(folderPath: string): boolean;
  onToggleStar(folderPath: string): void;
}

function RecentsBlock({
  title,
  items,
  viewMode,
  setViewMode,
  onOpen,
  emptyHeading,
  emptyHint,
  isStarred,
  onToggleStar,
}: RecentsBlockProps): JSX.Element {
  return (
    <section className="home-recents-section" aria-label={title}>
      <header className="home-recents-header">
        <h2 className="home-card-title">{title}</h2>
        <ViewToggle mode={viewMode} setMode={setViewMode} />
      </header>
      {items.length === 0 ? (
        <div className="home-recents-empty">
          <div>{emptyHeading}</div>
          <div className="home-recents-empty-hint">{emptyHint}</div>
        </div>
      ) : viewMode === 'list' ? (
        <RecentsTable
          recents={items}
          onOpen={onOpen}
          isStarred={isStarred}
          onToggleStar={onToggleStar}
        />
      ) : (
        <RecentsGrid
          recents={items}
          onOpen={onOpen}
          isStarred={isStarred}
          onToggleStar={onToggleStar}
        />
      )}
    </section>
  );
}

interface ViewToggleProps {
  mode: ViewMode;
  setMode(mode: ViewMode): void;
}

function ViewToggle({ mode, setMode }: ViewToggleProps): JSX.Element {
  return (
    <div className="home-view-toggle" role="group" aria-label="View mode">
      <button
        type="button"
        className={`home-view-btn ${mode === 'list' ? 'is-active' : ''}`}
        onClick={() => setMode('list')}
        aria-label="List view"
        aria-pressed={mode === 'list'}
        title="List view"
      >
        <IconList />
      </button>
      <button
        type="button"
        className={`home-view-btn ${mode === 'grid' ? 'is-active' : ''}`}
        onClick={() => setMode('grid')}
        aria-label="Grid view"
        aria-pressed={mode === 'grid'}
        title="Grid view"
      >
        <IconGrid />
      </button>
    </div>
  );
}

/* --- Tool item ---------------------------------------------------------- */

interface ToolItemProps {
  icon: JSX.Element;
  /** Accent color hint applied to the icon background. */
  accent: 'open' | 'new';
  title: string;
  desc: string;
  cta: string;
  onClick(): void;
}

function ToolItem({ icon, accent, title, desc, cta, onClick }: ToolItemProps): JSX.Element {
  return (
    <div className={`home-tool home-tool-${accent}`}>
      <div className="home-tool-icon">{icon}</div>
      <div className="home-tool-body">
        <div className="home-tool-title">{title}</div>
        <div className="home-tool-desc">{desc}</div>
        <button type="button" className="home-tool-cta" onClick={onClick}>
          {cta}
        </button>
      </div>
    </div>
  );
}

/* --- Recents table ------------------------------------------------------ */

interface RecentsTableProps {
  recents: RecentProject[];
  onOpen(recent: RecentProject): void;
  isStarred(folderPath: string): boolean;
  onToggleStar(folderPath: string): void;
}

function RecentsTable({
  recents,
  onOpen,
  isStarred,
  onToggleStar,
}: RecentsTableProps): JSX.Element {
  return (
    <div className="home-recents-table-wrap">
      <table className="home-recents-table">
        <thead>
          <tr>
            <th className="home-recents-th-star" aria-label="Starred" />
            <th className="home-recents-th-name">Name</th>
            <th className="home-recents-th-opened">Opened</th>
          </tr>
        </thead>
        <tbody>
          {recents.map((r) => (
            <RecentsRow
              key={r.folderPath}
              recent={r}
              starred={isStarred(r.folderPath)}
              onOpen={() => onOpen(r)}
              onToggleStar={() => onToggleStar(r.folderPath)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RecentsRowProps {
  recent: RecentProject;
  starred: boolean;
  onOpen(): void;
  onToggleStar(): void;
}

function RecentsRow({
  recent,
  starred,
  onOpen,
  onToggleStar,
}: RecentsRowProps): JSX.Element {
  return (
    <tr
      className="home-recents-row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      title={recent.folderPath}
    >
      <td className="home-recents-cell-star">
        <button
          type="button"
          className={`home-star-btn${starred ? ' is-starred' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
          aria-label={starred ? 'Unstar project' : 'Star project'}
          aria-pressed={starred}
          title={starred ? 'Unstar' : 'Star'}
        >
          {starred ? <IconStarFilled /> : <IconStarOutline />}
        </button>
      </td>
      <td>
        <div className="home-recents-name">
          <RowThumb />
          <div className="home-recents-name-text">
            <div className="home-recents-name-title">{recent.name}</div>
            <div className="home-recents-name-format">{recent.folderPath}</div>
          </div>
        </div>
      </td>
      <td className="home-recents-opened">{formatOpened(recent.lastOpenedAt)}</td>
    </tr>
  );
}

function RowThumb(): JSX.Element {
  return (
    <div className="home-row-thumb home-row-thumb-folder" aria-hidden>
      <IconFolderLarge />
    </div>
  );
}

/* --- Recents grid ------------------------------------------------------- */

interface RecentsGridProps {
  recents: RecentProject[];
  onOpen(recent: RecentProject): void;
  isStarred(folderPath: string): boolean;
  onToggleStar(folderPath: string): void;
}

function RecentsGrid({
  recents,
  onOpen,
  isStarred,
  onToggleStar,
}: RecentsGridProps): JSX.Element {
  return (
    <div className="home-recents-grid">
      {recents.map((r) => (
        <GridItem
          key={r.folderPath}
          recent={r}
          starred={isStarred(r.folderPath)}
          onOpen={() => onOpen(r)}
          onToggleStar={() => onToggleStar(r.folderPath)}
        />
      ))}
    </div>
  );
}

interface GridItemProps {
  recent: RecentProject;
  starred: boolean;
  onOpen(): void;
  onToggleStar(): void;
}

function GridItem({ recent, starred, onOpen, onToggleStar }: GridItemProps): JSX.Element {
  return (
    <div className="home-grid-item" title={recent.folderPath}>
      <button
        type="button"
        className={`home-grid-star${starred ? ' is-starred' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
        aria-label={starred ? 'Unstar project' : 'Star project'}
        aria-pressed={starred}
        title={starred ? 'Unstar' : 'Star'}
      >
        {starred ? <IconStarFilled /> : <IconStarOutline />}
      </button>
      <button
        type="button"
        className="home-grid-thumb-btn"
        onClick={onOpen}
        aria-label={`Open ${recent.name}`}
      >
        <div className="home-grid-thumb home-grid-thumb-folder">
          <IconFolderLarge />
        </div>
        <div className="home-grid-name">{recent.name}</div>
      </button>
    </div>
  );
}

function formatOpened(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfThat.getTime()) / (1000 * 60 * 60 * 24),
  );
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/* --- Inline icons ------------------------------------------------------- */

function InfoIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.8" r="0.85" fill="currentColor" />
    </svg>
  );
}

function IconClock(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.4V8l2.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconComputer(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 13.5h4M8 11v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconFolder(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7a1.5 1.5 0 0 1 1.5-1.5h4l1.6 1.7h9.4A1.5 1.5 0 0 1 21 8.7v8.8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFolderLarge(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7a1.5 1.5 0 0 1 1.5-1.5h4l1.6 1.7h9.4A1.5 1.5 0 0 1 21 8.7v8.8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStarOutline(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.8l1.85 3.74 4.13.6-2.99 2.91.71 4.12L8 11.22l-3.7 1.95.71-4.12L2.02 6.14l4.13-.6z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconStarFilled(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.8l1.85 3.74 4.13.6-2.99 2.91.71 4.12L8 11.22l-3.7 1.95.71-4.12L2.02 6.14l4.13-.6z"
        fill="#f7c948"
        stroke="#f7c948"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStarOutlineLarge(): JSX.Element {
  return (
    <svg width="72" height="72" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l2.78 5.63 6.22.9-4.5 4.39 1.06 6.19L12 17.2l-5.56 2.91 1.06-6.19L3 9.53l6.22-.9z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function IconOpenFolder(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7a1.5 1.5 0 0 1 1.5-1.5h3.4l1.6 1.6h7.6A1.5 1.5 0 0 1 19.6 8.6v8.4a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconNewFolder(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7a1.5 1.5 0 0 1 1.5-1.5h3.4l1.6 1.6h7.6A1.5 1.5 0 0 1 19.6 8.6v8.4a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M11.8 11.4v3.6M10 13.2h3.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconList(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3 4.5h10M3 8h10M3 11.5h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGrid(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="3" y="3" width="4" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="9" y="3" width="4" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="3" y="9" width="4" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="9" y="9" width="4" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
