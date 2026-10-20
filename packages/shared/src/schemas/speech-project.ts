import { z } from 'zod';
import { PROJECT_STEPS, PROJECT_TYPES, zProjectData } from '../speech/project';
import { zDateTime, zId, zVersion } from './common';

/** One of the user's own speeches (level 4). */
export const zSpeechProject = z.object({
  id: zId,
  type: z.enum(PROJECT_TYPES),
  title: z.string(),
  topicId: zId.nullable(),
  /** The note that keeps the script. */
  noteId: zId.nullable(),
  /** Current step (1 to 11). */
  step: z.number().int().min(1).max(PROJECT_STEPS.length),
  data: zProjectData,
  version: zVersion,
  createdAt: zDateTime,
  updatedAt: zDateTime,
});
export type SpeechProject = z.infer<typeof zSpeechProject>;

export const zSpeechProjectCreate = z.object({
  id: zId.optional(),
  type: z.enum(PROJECT_TYPES),
  title: z.string().trim().min(1, 'Dê um título ao discurso').max(300),
  topicId: zId.nullable().default(null),
});
export type SpeechProjectCreate = z.input<typeof zSpeechProjectCreate>;

export const zSpeechProjectUpdate = z.object({
  baseVersion: zVersion,
  title: z.string().trim().min(1).max(300).optional(),
  topicId: zId.nullable().optional(),
  noteId: zId.nullable().optional(),
  step: z.number().int().min(1).max(PROJECT_STEPS.length).optional(),
  data: zProjectData.optional(),
});
export type SpeechProjectUpdate = z.input<typeof zSpeechProjectUpdate>;

/** A browser's Web Push subscription (for the daily reminder). */
export const zPushSubscription = z.object({
  endpoint: z.url().max(2000).refine((u) => u.startsWith('https://'), 'Endereço de notificação inválido'),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, 'Chave inválida'),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/, 'Chave inválida'),
  }),
});
export type PushSubscriptionInput = z.infer<typeof zPushSubscription>;

export const zPushStatus = z.object({
  /** Null when the server has no VAPID keys (reminders unavailable). */
  publicKey: z.string().nullable(),
  subscriptions: z.number().int(),
});
export type PushStatus = z.infer<typeof zPushStatus>;
