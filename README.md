<div align="center">
  <img src="logo.png" alt="NodeGrip" height="40" />
</div>

<br />

<p align="center">
  A lightweight, fast desktop database client built with Electron and React — inspired by JetBrains DataGrip.
  <br />
  Project-oriented workspace, tabbed editor, and a focused UI for browsing schemas, running queries, and inspecting results.
</p>

<p align="center">
  <a href="https://github.com/remdph/node-grip/releases"><img alt="Version" src="https://img.shields.io/badge/version-0.1.0-cbd5e1?style=flat-square" /></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-cbd5e1?style=flat-square" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-cbd5e1?style=flat-square" />
  <img alt="Status" src="https://img.shields.io/badge/status-early%20development-eab308?style=flat-square" />
</p>

> **Status: early development.** Version 0.1.0 ships only the shell — projects, home page, tabbed workspace and the desktop chrome. Database connectivity, schema browsing, and the query editor are landing next.

---

## What is NodeGrip?

NodeGrip is a desktop client for working with databases. It's organised around the idea that everything you do for a single database belongs together — connection details, saved queries, exploration history — and lives inside a **project**, which is just a regular folder on disk that NodeGrip recognises.

The design goal is the same DX that makes DataGrip pleasant — keyboard-first, multi-tab, results-first — without the JetBrains footprint.

## Projects

A NodeGrip project is a folder on your filesystem with a `.nodegrip/` subfolder for project metadata:

```
my-database/
├── .nodegrip/
│   └── project.json     # name + creation timestamp (more to come)
└── … your own files …
```

This means a project is:

- **Portable** — copy the folder, you've copied the project.
- **Versionable** — commit `.nodegrip/` to git to share connection presets, ignore it to keep them local.
- **Inspectable** — no opaque database, no hidden config file in your home directory.

Opening a folder that doesn't have a `.nodegrip/` subfolder yet auto-initialises it, the same way DataGrip silently creates `.idea/` on first open.

## Home page

The home page is the launcher:

- **Recent** — recently opened projects, list or grid.
- **Starred** — projects you've pinned.
- **Your computer** — quick access to standard folders (Documents, Downloads, Desktop) to pick a project from.

Each opened project becomes a tab in the titlebar. Tabs persist across sessions; closing them all returns you to the home page.

## What's planned

| Area              | What's coming                                                                          |
| ----------------- | -------------------------------------------------------------------------------------- |
| Connectivity      | PostgreSQL first, then MySQL / MariaDB / SQLite.                                        |
| Schema browser    | Sidebar with databases → schemas → tables → columns + indexes.                          |
| Query editor      | SQL editor with syntax highlighting, multi-statement run, history.                      |
| Results grid      | Sortable, filterable, paginated grid with cell-level inspection.                        |
| Connection store  | Per-project connection presets under `.nodegrip/`. Optional OS keychain for passwords.  |
| Multi-tab queries | Each query in its own tab inside a project, with independent results.                   |

## Quick start (development)

NodeGrip targets **Node 22** (a `mise.toml` is included for [mise](https://mise.jdx.dev/) / asdf users) and **pnpm**.

```bash
pnpm install
pnpm dev
```

That launches the app in development mode (Vite + Electron with DevTools).

## Build & package

```bash
pnpm package    # build the app bundle (no installer)
pnpm make       # build platform-specific installers (deb/rpm/zip/squirrel/dmg)
```

## Tech stack

| Layer       | Library                                          |
| ----------- | ------------------------------------------------ |
| Shell       | Electron 33 (frameless `BrowserWindow`)          |
| UI          | React 18 + TypeScript (strict)                   |
| Bundling    | Vite + Electron Forge                            |
| State       | `zustand` with localStorage persistence          |

## Project layout

```
src/
  main/        Electron main process (windows, IPC handlers, app lifecycle)
  preload/     Context-isolated bridge that exposes a typed API to the renderer
  renderer/    React UI
    components/   TitleBar, HomeView, ProjectView, dialogs
    stores/       Zustand stores (tabs, settings)
    styles/       global.css
  shared/      Types and IPC channel constants shared between main and renderer
```

## License

[MIT](LICENSE) © 2026 Rafael Maldonado.

The full license text lives in the [`LICENSE`](LICENSE) file at the repo root
and is also linked from the in-app **About NodeGrip** dialog. NodeGrip is free
software with no warranty — see the LICENSE for the standard MIT disclaimer.

## Support the project

If NodeGrip saves you time, consider [buying me a coffee](https://www.buymeacoffee.com/remdph) — it helps keep development active.
