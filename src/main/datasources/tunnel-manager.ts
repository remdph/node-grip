import { createServer, type Server, type Socket } from 'node:net';
import fs from 'node:fs/promises';

import { NodeGripError } from '~shared/types/errors.js';
import type { DatasourceConfig } from '~shared/types/datasource.js';

/** A live SSH tunnel + local TCP listener pair. The renderer never
 * sees this — it talks to the DB driver, which talks to
 * `localhost:<localPort>`. */
export interface ActiveTunnel {
  /** Local TCP port the DB driver should connect to. */
  localPort: number;
  /** Tear down both the SSH client and the local listener. */
  close(): Promise<void>;
}

/** Open an SSH connection to `config.ssh.host:port` as
 * `config.ssh.user`, then a local TCP listener that forwards every
 * accepted socket to the SSH channel destined for `config.host:port`.
 * Returns the local port + a close handle. */
export async function openTunnel(
  config: DatasourceConfig,
): Promise<ActiveTunnel> {
  const ssh = config.ssh;
  if (!ssh || ssh.enabled !== true) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      'SSH tunnel requested but ssh.enabled is false',
    );
  }
  if (!ssh.host || !ssh.user) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      'SSH host and user are required when the tunnel is enabled',
    );
  }
  if (!ssh.privateKeyPath) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      'A private key path is required (password auth is not supported yet)',
    );
  }

  let privateKey: Buffer;
  try {
    privateKey = await fs.readFile(ssh.privateKeyPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new NodeGripError(
        'FILE_NOT_FOUND',
        `SSH private key not found: ${ssh.privateKeyPath}`,
        err,
      );
    }
    throw new NodeGripError(
      'READ_FAILED',
      `Failed to read SSH private key ${ssh.privateKeyPath}`,
      err,
    );
  }

  // Dynamic import keeps ssh2 out of the cold-start path; it's only
  // loaded when a tunnel-enabled datasource is connected.
  const { Client } = await import('ssh2');
  const sshClient = new Client();

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      sshClient.removeAllListeners('ready');
      reject(
        new NodeGripError(
          'READ_FAILED',
          `SSH handshake failed: ${err.message}`,
          err,
        ),
      );
    };
    sshClient.once('ready', () => {
      sshClient.removeListener('error', onError);
      resolve();
    });
    sshClient.once('error', onError);
    sshClient.connect({
      host: ssh.host,
      port: ssh.port,
      username: ssh.user,
      privateKey,
      // Reasonable timeouts so a hung jump host doesn't lock the UI
      // forever — the parent connect() flow also has its own race.
      readyTimeout: 7_000,
      keepaliveInterval: 30_000,
    });
  });

  // Local TCP server forwarding every accepted socket through an SSH
  // direct-tcpip channel to <config.host>:<config.port>. The kernel
  // picks the free local port for us (port: 0).
  const server: Server = createServer((local) => {
    sshClient.forwardOut(
      '127.0.0.1',
      0,
      config.host,
      config.port,
      (err: Error | undefined, stream) => {
        if (err) {
          local.destroy(err);
          return;
        }
        local.pipe(stream).pipe(local);
        const onError = (e: Error) => {
          console.warn('[tunnel] stream error:', e.message);
        };
        local.on('error', onError);
        stream.on('error', onError);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err) => reject(err));
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    sshClient.end();
    throw new NodeGripError(
      'READ_FAILED',
      'Could not determine local tunnel port',
    );
  }
  const localPort = address.port;

  const close = async () => {
    // Stop accepting new sockets immediately. Existing ones drain via
    // their own .destroy below.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Best-effort destroy of any half-open inbound sockets the server
    // didn't release.
    server.unref();
    try {
      sshClient.end();
    } catch (err) {
      console.warn('[tunnel] error ending ssh client:', err);
    }
  };

  // Defensive socket-error logging — a dropped tunnel shouldn't crash
  // the main process.
  sshClient.on('error', (err: Error) => {
    console.warn('[tunnel] ssh client error:', err.message);
  });
  sshClient.on('close', () => {
    server.close();
  });
  server.on('connection', (s: Socket) => {
    s.on('error', () => {
      /* swallowed — logged above per-stream */
    });
  });

  return { localPort, close };
}
