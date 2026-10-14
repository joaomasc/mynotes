import type { EntityType } from '@mynotes/shared';
import { badRequest } from './errors';
import { stmt } from './db';

/** Where each entity type lives and which column is its display title. */
export const ENTITY_TABLES: Partial<Record<EntityType, { table: string; title: string; trashable: boolean; topic?: string }>> = {
  topic: { table: 'topics', title: 'title', trashable: true, topic: 'parent_id' },
  note: { table: 'notes', title: 'title', trashable: true, topic: 'topic_id' },
  document: { table: 'documents', title: 'title', trashable: true, topic: 'topic_id' },
  reading: { table: 'readings', title: 'title', trashable: false, topic: 'topic_id' },
  concept: { table: 'concepts', title: 'name', trashable: false, topic: 'topic_id' },
  plan: { table: 'reading_plans', title: 'title', trashable: false, topic: 'topic_id' },
  mindmap: { table: 'mind_maps', title: 'title', trashable: false, topic: 'topic_id' },
};

export interface EntityRef {
  type: EntityType;
  id: string;
}

export interface EntityInfo {
  title: string;
  topicId: string | null;
  updatedAt: string;
}

const key = (type: string, id: string) => `${type}:${id}`;

/**
 * Resolves titles of live (non-trashed) entities owned by the user, one query
 * per type. Missing/trashed entities are absent from the result.
 */
export async function resolveEntities(
  db: D1Database,
  userId: string,
  refs: EntityRef[],
): Promise<Map<string, EntityInfo>> {
  const byType = new Map<EntityType, Set<string>>();
  for (const r of refs) {
    if (!ENTITY_TABLES[r.type]) continue;
    byType.set(r.type, (byType.get(r.type) ?? new Set()).add(r.id));
  }
  // D1 allows 100 bound parameters per statement: query in chunks of 90 ids.
  const jobs: { type: EntityType; statement: D1PreparedStatement }[] = [];
  for (const [type, idSet] of byType) {
    const meta = ENTITY_TABLES[type]!;
    const ids = [...idSet];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      jobs.push({
        type,
        statement: stmt(
          db,
          `SELECT id, ${meta.title} AS title, ${meta.topic ?? 'NULL'} AS topic_id, updated_at FROM ${meta.table}
            WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})${meta.trashable ? ' AND deleted_at IS NULL' : ''}`,
          userId,
          ...chunk,
        ),
      });
    }
  }
  const out = new Map<string, EntityInfo>();
  if (jobs.length === 0) return out;
  const results = await db.batch<{ id: string; title: string; topic_id: string | null; updated_at: string }>(
    jobs.map((j) => j.statement),
  );
  results.forEach((res, i) => {
    for (const row of res.results ?? []) {
      out.set(key(jobs[i]!.type, row.id), { title: row.title, topicId: row.topic_id ?? null, updatedAt: row.updated_at });
    }
  });
  return out;
}

export function entityKey(type: string, id: string): string {
  return key(type, id);
}

export async function assertEntity(db: D1Database, userId: string, ref: EntityRef): Promise<EntityInfo> {
  const found = (await resolveEntities(db, userId, [ref])).get(key(ref.type, ref.id));
  if (!found) throw badRequest('Item referenciado não existe', ref);
  return found;
}
