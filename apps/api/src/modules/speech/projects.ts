import {
  uuidv7,
  zProjectData,
  type ProjectType,
  type SpeechProject,
  type SpeechProjectCreate,
  type SpeechProjectUpdate,
} from '@mynotes/shared';
import { badRequest, notFound, versionConflict } from '../../lib/errors';
import { all, first, num, parseJson, run, str, strOrNull, type Bindable, type Row } from '../../lib/db';
import { assertReference } from '../../lib/helpers';
import { nowIso } from '../../lib/time';

/** The user's own speeches (level 4): what was written at each step and which talks rehearsed it. */

function toProject(r: Row): SpeechProject {
  const data = zProjectData.safeParse(parseJson(r.data_json, {}));
  return {
    id: str(r.id),
    type: str(r.type) as ProjectType,
    title: str(r.title),
    topicId: strOrNull(r.topic_id),
    noteId: strOrNull(r.note_id),
    step: num(r.step),
    data: data.success ? data.data : zProjectData.parse({}),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export async function listProjects(db: D1Database, userId: string): Promise<SpeechProject[]> {
  return (await all(db, 'SELECT * FROM speech_projects WHERE user_id = ? ORDER BY updated_at DESC', userId)).map(toProject);
}

export async function getProject(db: D1Database, userId: string, id: string): Promise<SpeechProject> {
  const row = await first(db, 'SELECT * FROM speech_projects WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Discurso');
  return toProject(row);
}

export async function createProject(db: D1Database, userId: string, input: Required<Omit<SpeechProjectCreate, 'id'>> & { id?: string | undefined }): Promise<{ project: SpeechProject; created: boolean }> {
  const id = input.id ?? uuidv7();
  const existing = await first(db, 'SELECT user_id FROM speech_projects WHERE id = ?', id);
  if (existing) {
    if (existing.user_id !== userId) throw badRequest('Identificador já utilizado');
    return { project: await getProject(db, userId, id), created: false };
  }
  await assertReference(db, 'topics', input.topicId, userId);
  const now = nowIso();
  await run(
    db,
    `INSERT INTO speech_projects (id, user_id, type, title, topic_id, note_id, step, data_json, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?, 1, ?, ?)`,
    id,
    userId,
    input.type,
    input.title,
    input.topicId,
    JSON.stringify(zProjectData.parse({})),
    now,
    now,
  );
  return { project: await getProject(db, userId, id), created: true };
}

/** Optimistic update: applies only on the version the browser saw. */
export async function updateProject(db: D1Database, userId: string, id: string, input: SpeechProjectUpdate): Promise<SpeechProject> {
  const current = await getProject(db, userId, id);
  if (current.version !== input.baseVersion) throw versionConflict(current);
  if (input.topicId !== undefined) await assertReference(db, 'topics', input.topicId, userId);
  if (input.noteId) await assertReference(db, 'notes', input.noteId, userId);
  const set: Record<string, Bindable> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.topicId !== undefined) set.topic_id = input.topicId;
  if (input.noteId !== undefined) set.note_id = input.noteId;
  if (input.step !== undefined) set.step = input.step;
  if (input.data !== undefined) set.data_json = JSON.stringify(zProjectData.parse(input.data));
  const cols = Object.keys(set);
  if (cols.length === 0) return current;
  const res = await run(
    db,
    `UPDATE speech_projects SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND version = ?`,
    ...cols.map((c) => set[c]!),
    nowIso(),
    id,
    userId,
    input.baseVersion,
  );
  if (!res.meta.changes) throw versionConflict(await getProject(db, userId, id));
  return getProject(db, userId, id);
}

/** The rehearsals stay as talks (no longer linked); the note stays as a note. */
export async function deleteProject(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await run(db, 'DELETE FROM speech_projects WHERE id = ? AND user_id = ?', id, userId);
  if (!res.meta.changes) throw notFound('Discurso');
}
