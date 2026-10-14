import {
  normalizeAligned,
  uuidv7,
  type Plan,
  type PlanCreate,
  type PlanDetail,
  type PlanItem,
  type PlanItemCreate,
  type PlanItemUpdate,
  type PlanUpdate,
  type UpcomingGoal,
} from '@mynotes/shared';
import { badRequest, notFound } from '../../lib/errors';
import { all, first, num, str, strOrNull, stmt, versionedUpdate, type Bindable, type Row } from '../../lib/db';
import { activityStmt, assertReference, sortKeyFor } from '../../lib/helpers';
import { nowIso } from '../../lib/time';

export function toPlan(r: Row): Plan {
  return {
    id: str(r.id),
    topicId: strOrNull(r.topic_id),
    title: str(r.title),
    description: str(r.description),
    goal: str(r.goal),
    status: str(r.status) as Plan['status'],
    startOn: strOrNull(r.start_on),
    targetOn: strOrNull(r.target_on),
    itemCount: num(r.item_count),
    completedCount: num(r.completed_count),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function toPlanItem(r: Row): PlanItem {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    title: str(r.title),
    notes: str(r.notes),
    readingId: strOrNull(r.reading_id),
    dueOn: strOrNull(r.due_on),
    completedAt: strOrNull(r.completed_at),
    sortKey: str(r.sort_key),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

const PLAN_SELECT = `SELECT p.*,
    (SELECT COUNT(*) FROM reading_plan_items i WHERE i.plan_id = p.id) AS item_count,
    (SELECT COUNT(*) FROM reading_plan_items i WHERE i.plan_id = p.id AND i.completed_at IS NOT NULL) AS completed_count
  FROM reading_plans p`;

const planSearchText = (title: string, description: string, goal: string) =>
  normalizeAligned(`${title} ${description} ${goal}`.normalize('NFC'));

async function planRow(db: D1Database, userId: string, id: string) {
  return first(db, `${PLAN_SELECT} WHERE p.id = ? AND p.user_id = ?`, id, userId);
}

export async function listPlans(db: D1Database, userId: string, status?: string): Promise<Plan[]> {
  const rows = status
    ? await all(db, `${PLAN_SELECT} WHERE p.user_id = ? AND p.status = ? ORDER BY p.updated_at DESC`, userId, status)
    : await all(db, `${PLAN_SELECT} WHERE p.user_id = ? ORDER BY p.status, p.updated_at DESC`, userId);
  return rows.map(toPlan);
}

export async function getPlan(db: D1Database, userId: string, id: string): Promise<PlanDetail> {
  const row = await planRow(db, userId, id);
  if (!row) throw notFound('Plano');
  const items = await all(db, 'SELECT * FROM reading_plan_items WHERE plan_id = ? ORDER BY sort_key, id', id);
  return { ...toPlan(row), items: items.map(toPlanItem) };
}

export async function createPlan(
  db: D1Database,
  userId: string,
  input: Required<Omit<PlanCreate, 'id'>> & { id?: string | undefined },
): Promise<{ plan: Plan; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT user_id FROM reading_plans WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { plan: toPlan((await planRow(db, userId, id))!), created: false };
  }
  await assertReference(db, 'topics', input.topicId, userId);
  if (input.startOn && input.targetOn && input.targetOn < input.startOn) {
    throw badRequest('A data-alvo não pode ser anterior ao início');
  }
  const now = nowIso();
  const title = input.title.normalize('NFC');
  await db.batch([
    stmt(
      db,
      `INSERT INTO reading_plans (id, user_id, topic_id, title, description, goal, status, start_on, target_on,
                                  search_text, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      userId,
      input.topicId,
      title,
      input.description,
      input.goal,
      input.status,
      input.startOn,
      input.targetOn,
      planSearchText(title, input.description, input.goal),
      now,
      now,
    ),
    activityStmt(db, userId, 'plan', id, 'created', title),
  ]);
  return { plan: toPlan((await planRow(db, userId, id))!), created: true };
}

export async function updatePlan(db: D1Database, userId: string, id: string, input: PlanUpdate): Promise<Plan> {
  const current = await planRow(db, userId, id);
  if (!current) throw notFound('Plano');
  if (input.topicId !== undefined) await assertReference(db, 'topics', input.topicId, userId);
  const map: Record<string, string> = {
    topicId: 'topic_id',
    title: 'title',
    description: 'description',
    goal: 'goal',
    status: 'status',
    startOn: 'start_on',
    targetOn: 'target_on',
  };
  const set: Record<string, Bindable> = {};
  for (const [field, col] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) set[col] = value as Bindable;
  }
  const merged = { ...current, ...set } as Row;
  if (merged.start_on && merged.target_on && str(merged.target_on) < str(merged.start_on)) {
    throw badRequest('A data-alvo não pode ser anterior ao início');
  }
  set.search_text = planSearchText(str(merged.title), str(merged.description), str(merged.goal));
  await versionedUpdate(
    db,
    { table: 'reading_plans', id, userId, baseVersion: input.baseVersion, set },
    async () => {
      const r = await planRow(db, userId, id);
      return r ? toPlan(r) : null;
    },
    'Plano',
  );
  return toPlan((await planRow(db, userId, id))!);
}

export async function deletePlan(db: D1Database, userId: string, id: string): Promise<void> {
  const row = await first(db, 'SELECT title FROM reading_plans WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Plano');
  await db.batch([
    stmt(db, 'DELETE FROM reading_plans WHERE id = ? AND user_id = ?', id, userId),
    activityStmt(db, userId, 'plan', id, 'deleted', str(row.title)),
  ]);
}

/* ------------------------------------------------------------------ items */

const itemOwner = (userId: string) => ({
  sql: 'plan_id IN (SELECT id FROM reading_plans WHERE user_id = ?)',
  binds: [userId] as Bindable[],
});

async function itemRow(db: D1Database, userId: string, planId: string, itemId: string) {
  return first(
    db,
    `SELECT i.* FROM reading_plan_items i JOIN reading_plans p ON p.id = i.plan_id
      WHERE i.id = ? AND i.plan_id = ? AND p.user_id = ?`,
    itemId,
    planId,
    userId,
  );
}

const itemScope = (planId: string, excludeId?: string) => ({
  table: 'reading_plan_items',
  where: 'plan_id = ?',
  binds: [planId] as Bindable[],
  excludeId,
});

async function touchPlan(db: D1Database, planId: string) {
  await db.prepare('UPDATE reading_plans SET updated_at = ? WHERE id = ?').bind(nowIso(), planId).run();
}

export async function createPlanItem(
  db: D1Database,
  userId: string,
  planId: string,
  input: Required<Omit<PlanItemCreate, 'id' | 'afterId' | 'beforeId'>> & {
    id?: string | undefined;
    afterId?: string | null | undefined;
    beforeId?: string | null | undefined;
  },
): Promise<PlanItem> {
  if (!(await first(db, 'SELECT 1 AS ok FROM reading_plans WHERE id = ? AND user_id = ?', planId, userId))) {
    throw notFound('Plano');
  }
  const id = input.id ?? uuidv7();
  const existing = await itemRow(db, userId, planId, id);
  if (existing) return toPlanItem(existing);
  await assertReference(db, 'readings', input.readingId, userId);
  const sortKey = await sortKeyFor(db, itemScope(planId), input);
  const now = nowIso();
  const row = await first(
    db,
    `INSERT INTO reading_plan_items (id, plan_id, title, notes, reading_id, due_on, completed_at, sort_key, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?) RETURNING *`,
    id,
    planId,
    input.title.normalize('NFC'),
    input.notes,
    input.readingId,
    input.dueOn,
    sortKey,
    now,
    now,
  );
  await touchPlan(db, planId);
  return toPlanItem(row!);
}

export async function updatePlanItem(
  db: D1Database,
  userId: string,
  planId: string,
  itemId: string,
  input: PlanItemUpdate,
): Promise<PlanItem> {
  const current = await itemRow(db, userId, planId, itemId);
  if (!current) throw notFound('Etapa');
  if (input.readingId !== undefined) await assertReference(db, 'readings', input.readingId, userId);
  const set: Record<string, Bindable> = {};
  if (input.title !== undefined) set.title = input.title.normalize('NFC');
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.readingId !== undefined) set.reading_id = input.readingId;
  if (input.dueOn !== undefined) set.due_on = input.dueOn;
  if (input.completed !== undefined) set.completed_at = input.completed ? (strOrNull(current.completed_at) ?? nowIso()) : null;
  if (input.afterId !== undefined || input.beforeId !== undefined) {
    set.sort_key = await sortKeyFor(db, itemScope(planId, itemId), input);
  }
  const row = await versionedUpdate(
    db,
    { table: 'reading_plan_items', id: itemId, userId, baseVersion: input.baseVersion, set, ownerSql: itemOwner(userId) },
    async () => {
      const r = await itemRow(db, userId, planId, itemId);
      return r ? toPlanItem(r) : null;
    },
    'Etapa',
  );
  if (input.completed === true && !current.completed_at) {
    await activityStmt(db, userId, 'plan', planId, 'completed', str(row.title)).run();
  }
  await touchPlan(db, planId);
  return toPlanItem(row);
}

export async function deletePlanItem(db: D1Database, userId: string, planId: string, itemId: string): Promise<void> {
  const current = await itemRow(db, userId, planId, itemId);
  if (!current) throw notFound('Etapa');
  await db.prepare('DELETE FROM reading_plan_items WHERE id = ?').bind(itemId).run();
  await touchPlan(db, planId);
}

/** Open plan steps with a due date, soonest first (dashboard "next goals"). */
export async function upcomingGoals(db: D1Database, userId: string, limit = 8): Promise<UpcomingGoal[]> {
  const rows = await all(
    db,
    `SELECT i.*, p.title AS plan_title FROM reading_plan_items i JOIN reading_plans p ON p.id = i.plan_id
      WHERE p.user_id = ? AND p.status = 'active' AND i.completed_at IS NULL AND i.due_on IS NOT NULL
      ORDER BY i.due_on ASC, i.sort_key LIMIT ?`,
    userId,
    limit,
  );
  return rows.map((r) => ({ ...toPlanItem(r), planTitle: str(r.plan_title) }));
}
