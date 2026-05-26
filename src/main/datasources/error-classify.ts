import type { TestConnectionResult } from '~shared/types/datasource.js';

/** Coarse classification of driver errors so the UI can hint at
 * remediation (e.g. "check the host" vs "wrong password") and we don't
 * leak raw stack traces. Shared by both test-connect (one-shot) and
 * the live connection pool (persistent). */
export function classifyError(
  err: unknown,
): { kind: TestConnectionResult['errorKind']; message: string } {
  const e = err as { code?: string; message?: string; errno?: string };
  const raw = (e?.message ?? String(err)).trim();
  const code = e?.code ?? '';

  // Network: DNS / connection refused / unreachable.
  if (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ECONNRESET' ||
    /getaddrinfo|connect ENOENT/i.test(raw)
  ) {
    return { kind: 'network', message: raw };
  }

  // Timeout.
  if (
    code === 'ETIMEDOUT' ||
    code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
    /timeout/i.test(raw)
  ) {
    return { kind: 'timeout', message: raw };
  }

  // Auth: pg uses SQLSTATE 28P01 (invalid password) and 28000;
  // mysql uses ER_ACCESS_DENIED_ERROR (1045).
  if (
    code === '28P01' ||
    code === '28000' ||
    code === 'ER_ACCESS_DENIED_ERROR' ||
    /password authentication failed|access denied|authentication/i.test(raw)
  ) {
    return { kind: 'auth', message: raw };
  }

  // Database doesn't exist: pg 3D000, mysql ER_BAD_DB_ERROR (1049).
  if (
    code === '3D000' ||
    code === 'ER_BAD_DB_ERROR' ||
    /database .* does not exist|unknown database/i.test(raw)
  ) {
    return { kind: 'database', message: raw };
  }

  if (/ssl|tls|certificate/i.test(raw)) {
    return { kind: 'tls', message: raw };
  }

  return { kind: 'unknown', message: raw };
}
