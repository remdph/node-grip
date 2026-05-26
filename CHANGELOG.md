# Changelog

All notable changes to NodeGrip will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

Initial release of the NodeGrip shell — the desktop client surface that
later versions will fill with database functionality.

### Added
- Project-oriented home page (Recent / Starred / Your computer sections).
- Folder-based projects: opening a folder reads or auto-initialises
  `<folder>/.nodegrip/project.json` with the project name and creation
  timestamp.
- Tabbed workspace: each open project gets its own tab; tabs persist
  across sessions and can be reordered, starred and overflowed.
- Frameless custom titlebar with brand icon, home button, tab strip,
  about and settings buttons, plus native window controls on Win/Linux.
- Auto-updater wiring for Windows / macOS (Squirrel) and Linux (GitHub
  Releases API + dismissable banner).
- Light/dark theme with synchronous first-paint via a `localStorage`
  side-cache.

[0.1.0]: https://github.com/remdph/node-grip/releases/tag/v0.1.0
