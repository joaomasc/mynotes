import { z } from 'zod';
import {
  DESCRIPTION_MAX,
  ENTITY_TYPES,
  FAVORITE_ENTITY_TYPES,
  GRAPH_ENTITY_TYPES,
  RELATION_KINDS,
  SEARCH_ENTITY_TYPES,
} from '../constants';
import { zDate, zDateTime, zId, zTitle, zTrimmed, zVersion } from './common';
import { zNoteSummary, zReading, zTopicWithCounts, zUpcomingGoal } from './content';

const zTimestamps = {
  version: zVersion,
  createdAt: zDateTime,
  updatedAt: zDateTime,
};

/* ---------------------------------------------------------- Study sessions */

export const zStudySession = z.object({
  id: zId,
  topicId: zId.nullable(),
  startedAt: zDateTime,
  durationSeconds: z.number().int(),
  objective: z.string(),
  notes: z.string(),
  progressRating: z.number().int().min(1).max(5).nullable(),
  source: z.enum(['manual', 'timer']),
  noteIds: z.array(zId),
  documentIds: z.array(zId),
  ...zTimestamps,
});
export type StudySession = z.infer<typeof zStudySession>;

const zSessionFields = {
  topicId: zId.nullable(),
  startedAt: zDateTime,
  durationSeconds: z.number().int().min(60, 'Duração mínima de 1 minuto').max(24 * 3600),
  objective: zTrimmed(1000),
  notes: zTrimmed(DESCRIPTION_MAX),
  progressRating: z.number().int().min(1).max(5).nullable(),
  noteIds: z.array(zId).max(50),
  documentIds: z.array(zId).max(50),
};

export const zStudySessionCreate = z.object({
  id: zId.optional(),
  topicId: zSessionFields.topicId.default(null),
  startedAt: zSessionFields.startedAt,
  durationSeconds: zSessionFields.durationSeconds,
  objective: zSessionFields.objective.default(''),
  notes: zSessionFields.notes.default(''),
  progressRating: zSessionFields.progressRating.default(null),
  source: z.enum(['manual', 'timer']).default('manual'),
  noteIds: zSessionFields.noteIds.default([]),
  documentIds: zSessionFields.documentIds.default([]),
});
export type StudySessionCreate = z.input<typeof zStudySessionCreate>;

export const zStudySessionUpdate = z
  .object(zSessionFields)
  .partial()
  .extend({ baseVersion: zVersion });
export type StudySessionUpdate = z.input<typeof zStudySessionUpdate>;

export const zStudySessionListQuery = z.object({
  from: zDateTime.optional(),
  to: zDateTime.optional(),
  topicId: zId.optional(),
});

export const zStudyStatsQuery = z.object({
  from: zDateTime,
  to: zDateTime,
  /** Client UTC offset in minutes (e.g. -180 for UTC-3), used for day buckets. */
  tzOffset: z.coerce.number().int().min(-14 * 60).max(14 * 60).default(0),
});

export const zStudyStats = z.object({
  totalSeconds: z.number().int(),
  sessionCount: z.number().int(),
  activeDays: z.number().int(),
  byDay: z.array(z.object({ date: zDate, seconds: z.number().int(), sessions: z.number().int() })),
  byTopic: z.array(z.object({ topicId: zId.nullable(), seconds: z.number().int(), sessions: z.number().int() })),
});
export type StudyStats = z.infer<typeof zStudyStats>;

/* --------------------------------------------------------------- Concepts */

export const zConcept = z.object({
  id: zId,
  topicId: zId.nullable(),
  name: z.string(),
  description: z.string(),
  ...zTimestamps,
});
export type Concept = z.infer<typeof zConcept>;

export const zConceptCreate = z.object({
  id: zId.optional(),
  topicId: zId.nullable().default(null),
  name: zTitle(200),
  description: zTrimmed(DESCRIPTION_MAX).default(''),
});
export type ConceptCreate = z.input<typeof zConceptCreate>;

export const zConceptUpdate = z.object({
  baseVersion: zVersion,
  topicId: zId.nullable().optional(),
  name: zTitle(200).optional(),
  description: zTrimmed(DESCRIPTION_MAX).optional(),
});
export type ConceptUpdate = z.input<typeof zConceptUpdate>;

/* -------------------------------------------------------------- Relations */

export const zGraphEntityType = z.enum(GRAPH_ENTITY_TYPES);
export const zRelationKind = z.enum(RELATION_KINDS);

export const zRelation = z.object({
  id: zId,
  sourceType: zGraphEntityType,
  sourceId: zId,
  targetType: zGraphEntityType,
  targetId: zId,
  kind: zRelationKind,
  label: z.string(),
  ...zTimestamps,
});
export type Relation = z.infer<typeof zRelation>;

export const zRelationWithTitles = zRelation.extend({
  sourceTitle: z.string(),
  targetTitle: z.string(),
});
export type RelationWithTitles = z.infer<typeof zRelationWithTitles>;

export const zRelationCreate = z.object({
  id: zId.optional(),
  sourceType: zGraphEntityType,
  sourceId: zId,
  targetType: zGraphEntityType,
  targetId: zId,
  kind: zRelationKind.default('related'),
  label: zTrimmed(200).default(''),
});
export type RelationCreate = z.input<typeof zRelationCreate>;

export const zRelationUpdate = z.object({
  baseVersion: zVersion,
  kind: zRelationKind.optional(),
  label: zTrimmed(200).optional(),
});
export type RelationUpdate = z.input<typeof zRelationUpdate>;

export const zRelationListQuery = z.object({
  entityType: zGraphEntityType,
  entityId: zId,
});

/* -------------------------------------------------------------- Mind maps */

export const zMindMapNode = z.object({
  id: z.string().min(1).max(64),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  label: z.string().max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  /** Optional link to a real entity (topic, note, document, reading, concept); title is a display snapshot. */
  ref: z
    .object({ type: zGraphEntityType, id: zId, title: z.string().max(300).optional() })
    .nullable()
    .default(null),
  parentId: z.string().max(64).nullable().default(null),
});
export type MindMapNode = z.infer<typeof zMindMapNode>;

export const zMindMapEdge = z.object({
  id: z.string().min(1).max(64),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  label: z.string().max(200).default(''),
});
export type MindMapEdge = z.infer<typeof zMindMapEdge>;

export const zMindMapData = z
  .object({
    nodes: z.array(zMindMapNode).max(2000),
    edges: z.array(zMindMapEdge).max(4000),
    viewport: z
      .object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.05).max(10) })
      .nullable()
      .default(null),
  })
  .superRefine((data, ctx) => {
    const ids = new Set<string>();
    for (const node of data.nodes) {
      if (ids.has(node.id)) ctx.addIssue({ code: 'custom', message: `Nó duplicado: ${node.id}` });
      ids.add(node.id);
    }
    for (const edge of data.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        ctx.addIssue({ code: 'custom', message: `Conexão ${edge.id} aponta para nó inexistente` });
      }
    }
  });
export type MindMapData = z.infer<typeof zMindMapData>;

export const zMindMapSummary = z.object({
  id: zId,
  topicId: zId.nullable(),
  title: z.string(),
  nodeCount: z.number().int(),
  ...zTimestamps,
});
export type MindMapSummary = z.infer<typeof zMindMapSummary>;

export const zMindMap = zMindMapSummary.extend({ data: zMindMapData });
export type MindMap = z.infer<typeof zMindMap>;

export const zMindMapCreate = z.object({
  id: zId.optional(),
  topicId: zId.nullable().default(null),
  title: zTitle(200),
  data: zMindMapData.optional(),
});
export type MindMapCreate = z.input<typeof zMindMapCreate>;

export const zMindMapUpdate = z.object({
  baseVersion: zVersion,
  topicId: zId.nullable().optional(),
  title: zTitle(200).optional(),
  data: zMindMapData.optional(),
});
export type MindMapUpdate = z.input<typeof zMindMapUpdate>;

/* ------------------------------------------------------------------ Graph */

export const GRAPH_EDGE_KINDS = [...RELATION_KINDS, 'parent', 'contains', 'links_to'] as const;
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export const zGraphNode = z.object({
  /** `${type}:${entityId}` */
  key: z.string(),
  type: zGraphEntityType,
  entityId: zId,
  label: z.string(),
  topicId: zId.nullable(),
});
export type GraphNode = z.infer<typeof zGraphNode>;

export const zGraphEdge = z.object({
  key: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.enum(GRAPH_EDGE_KINDS),
  relationId: zId.nullable(),
  label: z.string(),
});
export type GraphEdge = z.infer<typeof zGraphEdge>;

export const zGraph = z.object({
  nodes: z.array(zGraphNode),
  edges: z.array(zGraphEdge),
  truncated: z.boolean(),
});
export type Graph = z.infer<typeof zGraph>;

export const zGraphQuery = z.object({
  /** Comma-separated subset of entity types. */
  types: z.string().max(100).optional(),
  /** Restrict to a topic subtree. */
  topicId: zId.optional(),
  /** Include structural edges (hierarchy/containment). */
  structure: z.enum(['true', 'false']).default('true'),
});

/* -------------------------------------------------------------- Favorites */

export const zFavoriteEntityType = z.enum(FAVORITE_ENTITY_TYPES);

export const zFavorite = z.object({
  id: zId,
  entityType: zFavoriteEntityType,
  entityId: zId,
  title: z.string(),
  createdAt: zDateTime,
});
export type Favorite = z.infer<typeof zFavorite>;

export const zFavoriteCreate = z.object({
  entityType: zFavoriteEntityType,
  entityId: zId,
});

/* --------------------------------------------------------------- Activity */

export const ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'viewed',
  'deleted',
  'restored',
  'completed',
  'studied',
  'uploaded',
] as const;

export const zActivityEvent = z.object({
  id: zId,
  entityType: z.enum(ENTITY_TYPES),
  entityId: zId,
  action: z.enum(ACTIVITY_ACTIONS),
  title: z.string(),
  occurredAt: zDateTime,
});
export type ActivityEvent = z.infer<typeof zActivityEvent>;

export const zViewEvent = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: zId,
});

/* ---------------------------------------------------------------- Search */

export const zSearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  types: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const zSearchResult = z.object({
  type: z.enum(SEARCH_ENTITY_TYPES),
  id: zId,
  title: z.string(),
  snippet: z.string(),
  topicId: zId.nullable(),
  updatedAt: zDateTime,
});
export type SearchResult = z.infer<typeof zSearchResult>;

/* ----------------------------------------------------------------- Trash */

export const TRASHABLE_TYPES = ['topic', 'note', 'document'] as const;
export const zTrashItem = z.object({
  type: z.enum(TRASHABLE_TYPES),
  id: zId,
  title: z.string(),
  deletedAt: zDateTime,
  batchId: z.string().nullable(),
  batchSize: z.number().int(),
});
export type TrashItem = z.infer<typeof zTrashItem>;
export const zTrashRef = z.object({ type: z.enum(TRASHABLE_TYPES), id: zId });

/* ------------------------------------------------------------- Dashboard */

export const zDashboard = z.object({
  continueItems: z.array(zActivityEvent),
  recentNotes: z.array(zNoteSummary),
  readingsInProgress: z.array(zReading),
  overdueReadings: z.array(zReading),
  upcomingGoals: z.array(zUpcomingGoal),
  study: z.object({
    last7DaysSeconds: z.number().int(),
    last30DaysSeconds: z.number().int(),
    sessionsLast7Days: z.number().int(),
    recent: z.array(zStudySession),
  }),
  favorites: z.array(zFavorite),
  topics: z.array(zTopicWithCounts),
});
export type Dashboard = z.infer<typeof zDashboard>;

/* -------------------------------------------------------------- Settings */

export const zUiSettings = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
});

export const zStudyTimer = z.object({
  status: z.enum(['idle', 'running', 'paused']),
  topicId: zId.nullable(),
  objective: z.string().max(1000),
  /** When the timer was first started. */
  startedAt: zDateTime.nullable(),
  /** When the current running stretch began (null while paused/idle). */
  resumedAt: zDateTime.nullable(),
  /** Seconds accumulated before the current running stretch. */
  accumulatedSeconds: z.number().int().min(0).max(7 * 24 * 3600),
});
export type StudyTimer = z.infer<typeof zStudyTimer>;

export const zStudyGoals = z.object({
  weeklyMinutes: z.number().int().min(0).max(100 * 60).default(0),
});

export const SETTINGS_SCHEMAS = {
  ui: zUiSettings,
  study_timer: zStudyTimer,
  study_goals: zStudyGoals,
} as const;
export type SettingKey = keyof typeof SETTINGS_SCHEMAS;
export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMAS) as SettingKey[];
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_SCHEMAS)[K]>;

export const zSetting = z.object({
  key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]),
  value: z.unknown(),
  version: zVersion,
  updatedAt: zDateTime,
});
export type Setting = z.infer<typeof zSetting>;

export const zSettingPut = z.object({
  value: z.unknown(),
  /** Omit when creating the setting for the first time. */
  baseVersion: zVersion.optional(),
});

export const zDateRange = z.object({ from: zDate, to: zDate });
