import { z } from 'zod';
import {
  DESCRIPTION_MAX,
  MATERIAL_TYPES,
  NOTE_TITLE_MAX,
  PLAN_STATUSES,
  READING_STATUSES,
  TOPIC_TITLE_MAX,
} from '../constants';
import {
  zColor,
  zDate,
  zDateTime,
  zId,
  zPosition,
  zRichTextDoc,
  zTitle,
  zTrimmed,
  zVersion,
} from './common';

const zTimestamps = {
  version: zVersion,
  createdAt: zDateTime,
  updatedAt: zDateTime,
};

/* ----------------------------------------------------------------- Topics */

export const zTopic = z.object({
  id: zId,
  parentId: zId.nullable(),
  title: z.string(),
  description: z.string(),
  color: z.string().nullable(),
  sortKey: z.string(),
  ...zTimestamps,
});
export type Topic = z.infer<typeof zTopic>;

export const zTopicWithCounts = zTopic.extend({
  noteCount: z.number().int(),
  documentCount: z.number().int(),
  readingCount: z.number().int(),
});
export type TopicWithCounts = z.infer<typeof zTopicWithCounts>;

export const zTopicCreate = z
  .object({
    id: zId.optional(),
    parentId: zId.nullable().default(null),
    title: zTitle(TOPIC_TITLE_MAX),
    description: zTrimmed(DESCRIPTION_MAX).default(''),
    color: zColor.default(null),
  })
  .extend(zPosition.shape);
export type TopicCreate = z.input<typeof zTopicCreate>;

export const zTopicUpdate = z.object({
  baseVersion: zVersion,
  title: zTitle(TOPIC_TITLE_MAX).optional(),
  description: zTrimmed(DESCRIPTION_MAX).optional(),
  color: zColor.optional(),
});
export type TopicUpdate = z.input<typeof zTopicUpdate>;

export const zTopicMove = z
  .object({
    baseVersion: zVersion,
    parentId: zId.nullable(),
  })
  .extend(zPosition.shape);
export type TopicMove = z.input<typeof zTopicMove>;

export const TOPIC_DELETE_MODES = ['trash_all', 'move_to_parent'] as const;
export const zTopicDeleteQuery = z.object({
  mode: z.enum(TOPIC_DELETE_MODES).default('trash_all'),
});

export const zTopicDetail = z.object({
  topic: zTopicWithCounts,
  ancestors: z.array(zTopic.pick({ id: true, title: true, parentId: true })),
  children: z.array(zTopicWithCounts),
});
export type TopicDetail = z.infer<typeof zTopicDetail>;

/* ------------------------------------------------------------------ Notes */

export const zNoteSummary = z.object({
  id: zId,
  topicId: zId.nullable(),
  title: z.string(),
  excerpt: z.string(),
  wordCount: z.number().int(),
  sortKey: z.string(),
  ...zTimestamps,
});
export type NoteSummary = z.infer<typeof zNoteSummary>;

export const zNote = zNoteSummary.extend({ content: zRichTextDoc });
export type Note = z.infer<typeof zNote>;

export const zNoteCreate = z
  .object({
    id: zId.optional(),
    topicId: zId.nullable().default(null),
    title: zTrimmed(NOTE_TITLE_MAX).default(''),
    content: zRichTextDoc.optional(),
  })
  .extend(zPosition.shape);
export type NoteCreate = z.input<typeof zNoteCreate>;

export const zNoteUpdate = z.object({
  baseVersion: zVersion,
  title: zTrimmed(NOTE_TITLE_MAX).optional(),
  content: zRichTextDoc.optional(),
  topicId: zId.nullable().optional(),
});
export type NoteUpdate = z.input<typeof zNoteUpdate>;

export const zNoteMove = z
  .object({ baseVersion: zVersion, topicId: zId.nullable() })
  .extend(zPosition.shape);

export const NOTE_SORTS = ['manual', 'updated', 'created', 'title'] as const;
export const zNoteListQuery = z.object({
  topicId: z.union([zId, z.literal('none')]).optional(),
  sort: z.enum(NOTE_SORTS).default('updated'),
});

export const zNoteRevisionSummary = z.object({
  id: zId,
  noteId: zId,
  version: zVersion,
  title: z.string(),
  wordCount: z.number().int(),
  createdAt: zDateTime,
});
export const zNoteRevision = zNoteRevisionSummary.extend({ content: zRichTextDoc });
export type NoteRevisionSummary = z.infer<typeof zNoteRevisionSummary>;
export type NoteRevision = z.infer<typeof zNoteRevision>;

export const zBacklink = z.object({
  noteId: zId,
  title: z.string(),
  topicId: zId.nullable(),
  updatedAt: zDateTime,
});
export type Backlink = z.infer<typeof zBacklink>;

/* -------------------------------------------------------------- Documents */

export const DOCUMENT_STATUSES = ['pending', 'ready', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const zDocument = z.object({
  id: zId,
  topicId: zId.nullable(),
  title: z.string(),
  description: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(DOCUMENT_STATUSES),
  uploadedAt: zDateTime.nullable(),
  ...zTimestamps,
});
export type DocumentMeta = z.infer<typeof zDocument>;

export const zDocumentCreate = z.object({
  id: zId.optional(),
  topicId: zId.nullable().default(null),
  title: zTrimmed(300).optional(),
  description: zTrimmed(DESCRIPTION_MAX).default(''),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(128),
  sizeBytes: z.number().int().min(1),
});
export type DocumentCreate = z.input<typeof zDocumentCreate>;

export const zDocumentUpdate = z.object({
  baseVersion: zVersion,
  title: zTitle(300).optional(),
  description: zTrimmed(DESCRIPTION_MAX).optional(),
  topicId: zId.nullable().optional(),
});
export type DocumentUpdate = z.input<typeof zDocumentUpdate>;

export const zDocumentListQuery = z.object({
  topicId: z.union([zId, z.literal('none')]).optional(),
  type: z.enum(['pdf', 'image', 'other']).optional(),
  q: z.string().max(200).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
});

export const zSignedLink = z.object({ url: z.string(), expiresAt: zDateTime });

/* --------------------------------------------------------------- Readings */

export const zReading = z.object({
  id: zId,
  topicId: zId.nullable(),
  documentId: zId.nullable(),
  title: z.string(),
  author: z.string(),
  materialType: z.enum(MATERIAL_TYPES),
  status: z.enum(READING_STATUSES),
  totalPages: z.number().int().nullable(),
  currentPage: z.number().int().nullable(),
  progressPercent: z.number().nullable(),
  startedOn: zDate.nullable(),
  completedOn: zDate.nullable(),
  dueOn: zDate.nullable(),
  priority: z.number().int().min(0).max(3),
  notes: z.string(),
  ...zTimestamps,
});
export type Reading = z.infer<typeof zReading>;

const zReadingFields = {
  topicId: zId.nullable(),
  documentId: zId.nullable(),
  title: zTitle(300),
  author: zTrimmed(300),
  materialType: z.enum(MATERIAL_TYPES),
  status: z.enum(READING_STATUSES),
  totalPages: z.number().int().min(1).max(100_000).nullable(),
  currentPage: z.number().int().min(0).max(100_000).nullable(),
  progressPercent: z.number().min(0).max(100).nullable(),
  startedOn: zDate.nullable(),
  completedOn: zDate.nullable(),
  dueOn: zDate.nullable(),
  priority: z.number().int().min(0).max(3),
  notes: zTrimmed(DESCRIPTION_MAX),
};

export const zReadingCreate = z.object({
  id: zId.optional(),
  topicId: zReadingFields.topicId.default(null),
  documentId: zReadingFields.documentId.default(null),
  title: zReadingFields.title,
  author: zReadingFields.author.default(''),
  materialType: zReadingFields.materialType.default('book'),
  status: zReadingFields.status.default('not_started'),
  totalPages: zReadingFields.totalPages.default(null),
  currentPage: zReadingFields.currentPage.default(null),
  progressPercent: zReadingFields.progressPercent.default(null),
  startedOn: zReadingFields.startedOn.default(null),
  completedOn: zReadingFields.completedOn.default(null),
  dueOn: zReadingFields.dueOn.default(null),
  priority: zReadingFields.priority.default(0),
  notes: zReadingFields.notes.default(''),
});
export type ReadingCreate = z.input<typeof zReadingCreate>;

export const zReadingUpdate = z
  .object(zReadingFields)
  .partial()
  .extend({ baseVersion: zVersion });
export type ReadingUpdate = z.input<typeof zReadingUpdate>;

export const zReadingListQuery = z.object({
  status: z.enum(READING_STATUSES).optional(),
  topicId: zId.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(['updated', 'due', 'priority', 'title']).default('updated'),
});

/* ------------------------------------------------------------------ Plans */

export const zPlanItem = z.object({
  id: zId,
  planId: zId,
  title: z.string(),
  notes: z.string(),
  readingId: zId.nullable(),
  dueOn: zDate.nullable(),
  completedAt: zDateTime.nullable(),
  sortKey: z.string(),
  ...zTimestamps,
});
export type PlanItem = z.infer<typeof zPlanItem>;

export const zPlan = z.object({
  id: zId,
  topicId: zId.nullable(),
  title: z.string(),
  description: z.string(),
  goal: z.string(),
  status: z.enum(PLAN_STATUSES),
  startOn: zDate.nullable(),
  targetOn: zDate.nullable(),
  itemCount: z.number().int(),
  completedCount: z.number().int(),
  ...zTimestamps,
});
export type Plan = z.infer<typeof zPlan>;

export const zPlanDetail = zPlan.extend({ items: z.array(zPlanItem) });
export type PlanDetail = z.infer<typeof zPlanDetail>;

export const zPlanCreate = z.object({
  id: zId.optional(),
  topicId: zId.nullable().default(null),
  title: zTitle(300),
  description: zTrimmed(DESCRIPTION_MAX).default(''),
  goal: zTrimmed(2000).default(''),
  status: z.enum(PLAN_STATUSES).default('active'),
  startOn: zDate.nullable().default(null),
  targetOn: zDate.nullable().default(null),
});
export type PlanCreate = z.input<typeof zPlanCreate>;

export const zPlanUpdate = z.object({
  baseVersion: zVersion,
  topicId: zId.nullable().optional(),
  title: zTitle(300).optional(),
  description: zTrimmed(DESCRIPTION_MAX).optional(),
  goal: zTrimmed(2000).optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  startOn: zDate.nullable().optional(),
  targetOn: zDate.nullable().optional(),
});
export type PlanUpdate = z.input<typeof zPlanUpdate>;

export const zPlanItemCreate = z
  .object({
    id: zId.optional(),
    title: zTitle(300),
    notes: zTrimmed(DESCRIPTION_MAX).default(''),
    readingId: zId.nullable().default(null),
    dueOn: zDate.nullable().default(null),
  })
  .extend(zPosition.shape);
export type PlanItemCreate = z.input<typeof zPlanItemCreate>;

export const zPlanItemUpdate = z
  .object({
    baseVersion: zVersion,
    title: zTitle(300).optional(),
    notes: zTrimmed(DESCRIPTION_MAX).optional(),
    readingId: zId.nullable().optional(),
    dueOn: zDate.nullable().optional(),
    completed: z.boolean().optional(),
  })
  .extend(zPosition.shape);
export type PlanItemUpdate = z.input<typeof zPlanItemUpdate>;

export const zUpcomingGoal = zPlanItem.extend({ planTitle: z.string() });
export type UpcomingGoal = z.infer<typeof zUpcomingGoal>;
