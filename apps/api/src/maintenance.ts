import { all, stmt } from './lib/db';
import { isoBefore, nowIso } from './lib/time';

/**
 * Daily housekeeping (cron trigger). Removes expired authentication data,
 * stale idempotency records and imports, and uploads that never completed.
 * Trash is never purged automatically.
 */
export async function runMaintenance(env: Env): Promise<void> {
  const db = env.DB;
  const now = nowIso();
  const dayAgo = isoBefore(24 * 3600);

  // Abandoned uploads: remove the R2 object (if any) together with the row.
  const stale = await all<{ id: string; storage_key: string | null }>(
    db,
    "SELECT id, storage_key FROM documents WHERE status IN ('pending', 'failed') AND created_at < ? AND uploaded_at IS NULL LIMIT 100",
    dayAgo,
  );
  const keys = stale.map((d) => d.storage_key).filter((k): k is string => !!k);
  if (keys.length > 0) await env.FILES.delete(keys);

  await db.batch([
    stmt(db, 'DELETE FROM access_tokens WHERE expires_at < ?', now),
    stmt(db, 'DELETE FROM auth_nonces WHERE expires_at < ?', now),
    stmt(db, 'DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?', isoBefore(30 * 86400), isoBefore(30 * 86400)),
    stmt(db, 'DELETE FROM login_attempts WHERE created_at < ?', dayAgo),
    stmt(db, 'DELETE FROM idempotency_keys WHERE created_at < ?', dayAgo),
    stmt(db, "DELETE FROM import_jobs WHERE status <> 'committed' AND created_at < ?", dayAgo),
    stmt(db, "DELETE FROM import_chunks WHERE job_id IN (SELECT id FROM import_jobs WHERE status = 'committed')"),
    stmt(db, 'DELETE FROM activity_events WHERE occurred_at < ?', isoBefore(400 * 86400)),
    ...stale.map((d) => stmt(db, 'DELETE FROM documents WHERE id = ? AND uploaded_at IS NULL', d.id)),
  ]);
}
