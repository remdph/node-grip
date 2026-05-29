import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import { NodeGripError } from '~shared/types/errors.js';
import { IPC_CHANNELS } from '~shared/types/ipc.js';
import type {
  FileEntry,
  FileReadResult,
  ProjectInfo,
  ProjectMetadata,
} from '~shared/types/ipc.js';
import { handle } from './register.js';
import { setProjectPassphrase } from '../datasources/vault.js';

/** Hard cap for `readFile`. Larger files are reported with
 * `tooLarge: true` and an empty content payload so the renderer can
 * render an "open externally" affordance without OOM-ing the main
 * process. 5 MiB covers any realistic SQL / config file. */
const FILE_READ_LIMIT = 5 * 1024 * 1024;

/** How many bytes to inspect when sniffing for binary content. NUL byte
 * → almost certainly not text; consistent with what `file(1)` and most
 * editors do. */
const BINARY_SNIFF_BYTES = 8192;

const PROJECT_DIR = '.nodegrip';
const PROJECT_FILE = 'project.json';

function metadataPath(folderPath: string): string {
  return path.join(folderPath, PROJECT_DIR, PROJECT_FILE);
}

function deriveProjectName(folderPath: string): string {
  return path.basename(folderPath) || folderPath;
}

async function readMetadata(folderPath: string): Promise<ProjectMetadata | null> {
  try {
    const raw = await fs.readFile(metadataPath(folderPath), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectMetadata>;
    if (typeof parsed.name !== 'string' || typeof parsed.createdAt !== 'string') {
      throw new NodeGripError(
        'VALIDATION_ERROR',
        `Malformed ${PROJECT_DIR}/${PROJECT_FILE} in ${folderPath}`,
      );
    }
    return { name: parsed.name, createdAt: parsed.createdAt };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (err instanceof NodeGripError) throw err;
    if (err instanceof SyntaxError) {
      throw new NodeGripError(
        'VALIDATION_ERROR',
        `${PROJECT_DIR}/${PROJECT_FILE} in ${folderPath} is not valid JSON`,
        err,
      );
    }
    throw new NodeGripError(
      'READ_FAILED',
      `Failed to read project metadata in ${folderPath}`,
      err,
    );
  }
}

async function writeMetadata(
  folderPath: string,
  metadata: ProjectMetadata,
): Promise<void> {
  const dir = path.join(folderPath, PROJECT_DIR);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, PROJECT_FILE),
      JSON.stringify(metadata, null, 2) + '\n',
      'utf8',
    );
  } catch (err) {
    throw new NodeGripError(
      'READ_FAILED',
      `Failed to write project metadata in ${folderPath}`,
      err,
    );
  }
}

export function registerProjectIpc(): void {
  handle<[string | undefined], string | null>(
    IPC_CHANNELS.project.pickFolder,
    async (event, defaultPath) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        title: 'Choose project folder',
        properties: ['openDirectory' as const, 'createDirectory' as const],
        ...(defaultPath ? { defaultPath } : {}),
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    },
  );

  // "Create" flow. Driven by the in-app CreateProjectDialog (React) which
  // collects {parent, name} via two text fields + a Browse button. We
  // mkdir <parent>/<name> recursively and either init fresh metadata or
  // return the existing project payload if the folder is already one.
  //
  // We deliberately avoid `dialog.showSaveDialog` (file-save UX with
  // overwrite warnings) and `dialog.showOpenDialog` + createDirectory
  // (macOS-only affordance, hidden by most Linux portals + Windows
  // folder picker). A custom in-app dialog is the convention DataGrip /
  // VS Code use and works identically across platforms.
  handle<[string, string], ProjectInfo>(
    IPC_CHANNELS.project.create,
    async (_event, parent, name) => {
      if (typeof parent !== 'string' || parent.length === 0) {
        throw new NodeGripError('INVALID_PATH', 'A parent folder is required');
      }
      if (!path.isAbsolute(parent)) {
        throw new NodeGripError('INVALID_PATH', 'Parent path must be absolute');
      }
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new NodeGripError('VALIDATION_ERROR', 'A project name is required');
      }
      const trimmedName = name.trim();
      // Disallow path separators and characters that are illegal on common
      // filesystems (Windows NTFS in particular). Keep it permissive
      // beyond that — non-ASCII names are fine.
      if (/[\\/:*?"<>|\0]/.test(trimmedName)) {
        throw new NodeGripError(
          'VALIDATION_ERROR',
          'Project name cannot contain / \\ : * ? " < > |',
        );
      }

      try {
        const stat = await fs.stat(parent);
        if (!stat.isDirectory()) {
          throw new NodeGripError(
            'VALIDATION_ERROR',
            `${parent} is not a directory`,
          );
        }
      } catch (err) {
        if (err instanceof NodeGripError) throw err;
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new NodeGripError(
            'FILE_NOT_FOUND',
            `Parent folder not found: ${parent}`,
            err,
          );
        }
        throw new NodeGripError('READ_FAILED', `Failed to read ${parent}`, err);
      }

      const target = path.join(parent, trimmedName);
      try {
        await fs.mkdir(target, { recursive: true });
      } catch (err) {
        throw new NodeGripError(
          'READ_FAILED',
          `Failed to create folder ${target}`,
          err,
        );
      }

      // If the folder already had project metadata (e.g. user typed the
      // name of a previously-created project), respect it. Otherwise
      // write fresh metadata using the typed `name` (not the basename —
      // they may differ if the user typed a name with characters we'd
      // sanitise out of the folder name, though for now we mirror them).
      const existing = await readMetadata(target);
      if (existing) return { folderPath: target, metadata: existing };

      const metadata: ProjectMetadata = {
        name: trimmedName,
        createdAt: new Date().toISOString(),
      };
      await writeMetadata(target, metadata);
      return { folderPath: target, metadata };
    },
  );

  handle<[string], ProjectMetadata | null>(
    IPC_CHANNELS.project.read,
    async (_event, folderPath) => {
      if (typeof folderPath !== 'string' || folderPath.length === 0) {
        throw new NodeGripError('INVALID_PATH', 'A folder path is required');
      }
      if (!path.isAbsolute(folderPath)) {
        throw new NodeGripError('INVALID_PATH', 'Folder path must be absolute');
      }
      return readMetadata(folderPath);
    },
  );

  // open = read-or-init. Auto-initialises when the folder has no
  // .nodegrip/project.json yet, matching the "open any folder" DataGrip
  // behaviour. The caller (renderer) doesn't need to know whether it was
  // a fresh init or an existing project.
  handle<[string], ProjectInfo>(
    IPC_CHANNELS.project.open,
    async (_event, folderPath) => {
      if (typeof folderPath !== 'string' || folderPath.length === 0) {
        throw new NodeGripError('INVALID_PATH', 'A folder path is required');
      }
      if (!path.isAbsolute(folderPath)) {
        throw new NodeGripError('INVALID_PATH', 'Folder path must be absolute');
      }

      try {
        const stat = await fs.stat(folderPath);
        if (!stat.isDirectory()) {
          throw new NodeGripError(
            'VALIDATION_ERROR',
            `${folderPath} is not a directory`,
          );
        }
      } catch (err) {
        if (err instanceof NodeGripError) throw err;
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new NodeGripError('FILE_NOT_FOUND', `Folder not found: ${folderPath}`, err);
        }
        throw new NodeGripError('READ_FAILED', `Failed to read ${folderPath}`, err);
      }

      const existing = await readMetadata(folderPath);
      if (existing) {
        // Existing project: set vault passphrase from stored encryption key
        setProjectPassphrase(folderPath, existing.encryptionKey ?? undefined);
        return { folderPath, metadata: existing };
      }

      const metadata: ProjectMetadata = {
        name: deriveProjectName(folderPath),
        createdAt: new Date().toISOString(),
      };
      await writeMetadata(folderPath, metadata);
      return { folderPath, metadata };
    },
  );

  // Store or update the passphrase for a project. The passphrase is
  // persisted in project.json and used to derive the vault encryption key.
  handle<[string, string | undefined], ProjectMetadata>(
    IPC_CHANNELS.project.setPassphrase,
    async (_event, folderPath, passphrase) => {
      if (typeof folderPath !== 'string' || folderPath.length === 0) {
        throw new NodeGripError('INVALID_PATH', 'A folder path is required');
      }
      if (!path.isAbsolute(folderPath)) {
        throw new NodeGripError('INVALID_PATH', 'Folder path must be absolute');
      }
      const metadata = await readMetadata(folderPath);
      if (!metadata) {
        throw new NodeGripError('VALIDATION_ERROR', `Project not found: ${folderPath}`);
      }
      setProjectPassphrase(folderPath, passphrase);
      const updated: ProjectMetadata = { ...metadata, encryptionKey: passphrase };
      await writeMetadata(folderPath, updated);
      return updated;
    },
  );

  // Lazy directory listing for the right Files panel. The tree expands
  // one level at a time so we never scan a deep tree up-front. Hidden
  // entries (including `.nodegrip/`) are included — DataGrip-style "show
  // everything" semantics, the renderer can filter later if needed.
  handle<[string], FileEntry[]>(
    IPC_CHANNELS.project.listFolder,
    async (_event, folderPath) => {
      if (typeof folderPath !== 'string' || folderPath.length === 0) {
        throw new NodeGripError('INVALID_PATH', 'A folder path is required');
      }
      if (!path.isAbsolute(folderPath)) {
        throw new NodeGripError('INVALID_PATH', 'Folder path must be absolute');
      }

      let dirents;
      try {
        dirents = await fs.readdir(folderPath, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new NodeGripError(
            'FILE_NOT_FOUND',
            `Folder not found: ${folderPath}`,
            err,
          );
        }
        if (code === 'ENOTDIR') {
          throw new NodeGripError(
            'VALIDATION_ERROR',
            `${folderPath} is not a directory`,
            err,
          );
        }
        throw new NodeGripError(
          'READ_FAILED',
          `Failed to read ${folderPath}`,
          err,
        );
      }

      const entries: FileEntry[] = [];
      for (const dirent of dirents) {
        const type: FileEntry['type'] = dirent.isDirectory()
          ? 'dir'
          : dirent.isFile()
          ? 'file'
          : null!;
        // Skip sockets / FIFOs / symlinks-to-nothing; only surface
        // regular files and directories that the renderer can act on.
        if (type !== 'dir' && type !== 'file') continue;
        entries.push({
          name: dirent.name,
          path: path.join(folderPath, dirent.name),
          type,
        });
      }

      // Directories first, then files; case-insensitive name sort within
      // each group to mirror most file managers.
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      return entries;
    },
  );

  // Text-content read with size cap + binary sniff. The renderer feeds
  // this into a read-only viewer for now; editing comes later.
  handle<[string], FileReadResult>(
    IPC_CHANNELS.project.readFile,
    async (_event, filePath) => {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new NodeGripError('INVALID_PATH', 'A file path is required');
      }
      if (!path.isAbsolute(filePath)) {
        throw new NodeGripError('INVALID_PATH', 'File path must be absolute');
      }

      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new NodeGripError(
            'FILE_NOT_FOUND',
            `File not found: ${filePath}`,
            err,
          );
        }
        throw new NodeGripError('READ_FAILED', `Failed to stat ${filePath}`, err);
      }
      if (!stat.isFile()) {
        throw new NodeGripError(
          'VALIDATION_ERROR',
          `${filePath} is not a regular file`,
        );
      }

      const size = stat.size;
      if (size > FILE_READ_LIMIT) {
        return { content: '', size, binary: false, tooLarge: true };
      }

      let buffer: Buffer;
      try {
        buffer = await fs.readFile(filePath);
      } catch (err) {
        throw new NodeGripError(
          'READ_FAILED',
          `Failed to read ${filePath}`,
          err,
        );
      }

      // Binary sniff: a NUL byte in the first N bytes is the simplest
      // heuristic. UTF-16 text files contain NUL bytes too, so we'll
      // false-positive on those — fine for v1; the renderer can show a
      // "binary file" hint and the user can open externally.
      const sniffLen = Math.min(BINARY_SNIFF_BYTES, buffer.length);
      let binary = false;
      for (let i = 0; i < sniffLen; i++) {
        if (buffer[i] === 0) {
          binary = true;
          break;
        }
      }
      if (binary) return { content: '', size, binary: true, tooLarge: false };

      const content = buffer.toString('utf8');
      return { content, size, binary: false, tooLarge: false };
    },
  );
}
