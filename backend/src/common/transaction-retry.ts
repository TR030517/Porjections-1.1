/** Only structured Prisma/MySQL transaction conflicts are retryable. Never
 * infer a database lock conflict from an arbitrary message or SQL error. */
export function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code === 'P2034') return true;
  if (code !== 'P2010' || !meta || typeof meta !== 'object') return false;
  const sqlCode = (meta as { code?: unknown }).code;
  return sqlCode === '1213' || sqlCode === 1213 || sqlCode === '1205' || sqlCode === 1205;
}
