import type {
  ActivityEvent,
  AiActionDecision,
  AiChatRequest,
  AiChatResponse,
  AiConversation,
  AiConversationSummary,
  AiIndexStatus,
  AiIndexSync,
  AiStatus,
  Backlink,
  BrokenReference,
  BackupManifest,
  BackupTableName,
  Concept,
  ConceptCreate,
  ConceptUpdate,
  Dashboard,
  DocumentCreate,
  DocumentMeta,
  DocumentUpdate,
  Favorite,
  FavoriteEntityType,
  Graph,
  ImportMode,
  ImportResult,
  MindMap,
  MindMapCreate,
  MindMapListQuery,
  MindMapSummary,
  MindMapUpdate,
  Note,
  NoteCreate,
  NoteRevision,
  NoteRevisionSummary,
  NoteSummary,
  NoteUpdate,
  Plan,
  PlanCreate,
  PlanDetail,
  PlanItem,
  PlanItemCreate,
  PlanItemUpdate,
  PlanUpdate,
  Reading,
  ReadingCreate,
  ReadingUpdate,
  RelationCreate,
  RelationUpdate,
  Reference,
  RelationWithTitles,
  SearchResult,
  Session,
  Setting,
  SettingKey,
  SpeechAttempt,
  SpeechAttemptCreate,
  SpeechAttemptSummary,
  SpeechFeedback,
  SpeechFeedbackRequest,
  SpeechPathState,
  SpeechPracticeCreate,
  SpeechPracticeResult,
  SpeechProject,
  SpeechProjectCreate,
  SpeechProjectUpdate,
  PushStatus,
  ReviewAnswer,
  ReviewAnswerResult,
  ReviewCard,
  ReviewCardCreate,
  ReviewCardUpdate,
  ReviewEvaluation,
  ReviewGenerate,
  ReviewGenerateResult,
  ReviewHelp,
  ReviewProposal,
  ReviewProposalDecision,
  ReviewQueue,
  ReviewRecall,
  ReviewRecallCreate,
  ReviewScopeInfo,
  ReviewSession,
  ReviewSessionCreate,
  ReviewSessionSummary,
  ReviewStats,
  ReviewSummary,
  ReviewVariants,
  PushSubscriptionInput,
  SkillId,
  VariantExercise,
  StudySession,
  StudySessionCreate,
  StudySessionUpdate,
  StudyStats,
  TagCount,
  Topic,
  TopicContext,
  TopicCreate,
  TopicDetail,
  TopicMove,
  TopicUpdate,
  TopicWithCounts,
  Transcription,
  TranscriptionCreate,
  TrashItem,
  UpcomingGoal,
  UploadStart,
  UploadedPart,
  User,
  ViewLayout,
  ViewLayoutData,
} from '@mynotes/shared';
import { api, request } from './client';
import { postStream } from './sse';

/** Every API call used by the app, typed with the shared contract. */
export const endpoints = {
  auth: {
    me: () => api.get<User>('/auth/me'),
    sessions: () => api.get<Session[]>('/auth/sessions'),
    revokeSession: (id: string) => api.del(`/auth/sessions/${id}`),
    revokeOthers: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
  },

  topics: {
    list: () => api.get<TopicWithCounts[]>('/topics'),
    get: (id: string) => api.get<TopicDetail>(`/topics/${id}`),
    create: (body: TopicCreate) => api.post<Topic>('/topics', body),
    update: (id: string, body: TopicUpdate) => api.patch<Topic>(`/topics/${id}`, body),
    move: (id: string, body: TopicMove) => api.post<Topic>(`/topics/${id}/move`, body),
    remove: (id: string, mode: 'trash_all' | 'move_to_parent') =>
      api.del<{ batchId: string; affected: number }>(`/topics/${id}`, { mode }),
    context: (id: string) => api.get<TopicContext>(`/topics/${id}/context`),
  },

  notes: {
    list: (q: { topicId?: string; sort?: string; role?: string; readingId?: string; tag?: string; cursor?: string; limit?: number }) =>
      api.page<NoteSummary>('/notes', q),
    get: (id: string, signal?: AbortSignal) => api.get<Note>(`/notes/${id}`, undefined, signal),
    create: (body: NoteCreate) => api.post<Note>('/notes', body),
    update: (id: string, body: NoteUpdate) => api.patch<NoteSummary>(`/notes/${id}`, body, { retries: 0 }),
    move: (id: string, body: { baseVersion: number; topicId: string | null; afterId?: string | null; beforeId?: string | null }) =>
      api.post<NoteSummary>(`/notes/${id}/move`, body),
    remove: (id: string) => api.del(`/notes/${id}`),
    revisions: (id: string) => api.get<NoteRevisionSummary[]>(`/notes/${id}/revisions`),
    revision: (id: string, revisionId: string) => api.get<NoteRevision>(`/notes/${id}/revisions/${revisionId}`),
    backlinks: (type: string, id: string) => api.get<Backlink[]>(`/backlinks/${type}/${id}`),
  },

  tags: (q?: string, limit = 50, signal?: AbortSignal) => api.get<TagCount[]>('/tags', { q, limit }, signal),

  references: {
    suggest: (q: string, types?: string, limit = 12, signal?: AbortSignal) =>
      api.get<Reference[]>('/references/suggest', { q, types, limit }, signal),
    /** `refs`: `type:id` pairs. */
    resolve: (refs: string[]) => api.get<Reference[]>('/references/resolve', { refs: refs.join(',') }),
    broken: () => api.get<BrokenReference[]>('/references/broken'),
  },

  layouts: {
    get: (key: string) => api.get<ViewLayout | null>(`/layouts/${key}`),
    put: (key: string, data: ViewLayoutData, baseVersion?: number) =>
      api.put<ViewLayout>(`/layouts/${key}`, { data, ...(baseVersion ? { baseVersion } : {}) }, { retries: 0, track: false }),
  },

  documents: {
    list: (q: { topicId?: string; type?: string; q?: string; cursor?: string; limit?: number }) =>
      api.page<DocumentMeta>('/documents', q),
    get: (id: string) => api.get<DocumentMeta>(`/documents/${id}`),
    create: (body: DocumentCreate) => api.post<DocumentMeta>('/documents', body),
    update: (id: string, body: DocumentUpdate) => api.patch<DocumentMeta>(`/documents/${id}`, body),
    remove: (id: string) => api.del(`/documents/${id}`),
    link: (id: string, download: boolean) =>
      api.post<{ url: string; expiresAt: string }>(`/documents/${id}/link`, { download }),
    contentPath: (id: string) => `/documents/${id}/content`,
    // Large files: upload in parts.
    startUpload: (id: string) => api.post<UploadStart>(`/documents/${id}/uploads`, {}, { retries: 0 }),
    uploadPartPath: (id: string, part: number, token: string) =>
      `/documents/${id}/uploads/parts/${part}?token=${encodeURIComponent(token)}`,
    completeUpload: (id: string, token: string, parts: UploadedPart[]) =>
      api.post<DocumentMeta>(`/documents/${id}/uploads/complete`, { token, parts }),
    abortUpload: (id: string, token: string) => api.post(`/documents/${id}/uploads/abort`, { token }, { retries: 0, track: false }),
  },

  readings: {
    list: (q: { status?: string; topicId?: string; overdue?: string; q?: string; sort?: string; cursor?: string; limit?: number }) =>
      api.page<Reading>('/readings', q),
    get: (id: string) => api.get<Reading>(`/readings/${id}`),
    create: (body: ReadingCreate) => api.post<Reading>('/readings', body),
    update: (id: string, body: ReadingUpdate) => api.patch<Reading>(`/readings/${id}`, body),
    remove: (id: string) => api.del(`/readings/${id}`),
  },

  plans: {
    list: (status?: string) => api.get<Plan[]>('/plans', { status }),
    upcoming: () => api.get<UpcomingGoal[]>('/plans/upcoming'),
    get: (id: string) => api.get<PlanDetail>(`/plans/${id}`),
    create: (body: PlanCreate) => api.post<Plan>('/plans', body),
    update: (id: string, body: PlanUpdate) => api.patch<Plan>(`/plans/${id}`, body),
    remove: (id: string) => api.del(`/plans/${id}`),
    addItem: (planId: string, body: PlanItemCreate) => api.post<PlanItem>(`/plans/${planId}/items`, body),
    updateItem: (planId: string, itemId: string, body: PlanItemUpdate) =>
      api.patch<PlanItem>(`/plans/${planId}/items/${itemId}`, body),
    removeItem: (planId: string, itemId: string) => api.del(`/plans/${planId}/items/${itemId}`),
  },

  study: {
    list: (q: { from?: string; to?: string; topicId?: string; cursor?: string; limit?: number }) =>
      api.page<StudySession>('/study-sessions', q),
    stats: (q: { from: string; to: string; tzOffset: number }) => api.get<StudyStats>('/study-sessions/stats', q),
    create: (body: StudySessionCreate) => api.post<StudySession>('/study-sessions', body),
    update: (id: string, body: StudySessionUpdate) => api.patch<StudySession>(`/study-sessions/${id}`, body),
    remove: (id: string) => api.del(`/study-sessions/${id}`),
  },

  concepts: {
    list: (topicId?: string) => api.get<Concept[]>('/concepts', { topicId }),
    get: (id: string) => api.get<Concept>(`/concepts/${id}`),
    create: (body: ConceptCreate) => api.post<Concept>('/concepts', body),
    update: (id: string, body: ConceptUpdate) => api.patch<Concept>(`/concepts/${id}`, body),
    remove: (id: string) => api.del(`/concepts/${id}`),
  },

  relations: {
    list: (entityType: string, entityId: string) =>
      api.get<RelationWithTitles[]>('/relations', { entityType, entityId }),
    create: (body: RelationCreate) => api.post<RelationWithTitles>('/relations', body),
    update: (id: string, body: RelationUpdate) => api.patch(`/relations/${id}`, body),
    remove: (id: string) => api.del(`/relations/${id}`),
  },

  mindMaps: {
    list: (q?: MindMapListQuery) => api.get<MindMapSummary[]>('/mind-maps', q),
    get: (id: string) => api.get<MindMap>(`/mind-maps/${id}`),
    create: (body: MindMapCreate) => api.post<MindMap>('/mind-maps', body),
    update: (id: string, body: MindMapUpdate) => api.patch<MindMapSummary>(`/mind-maps/${id}`, body, { retries: 0 }),
    remove: (id: string) => api.del(`/mind-maps/${id}`),
  },

  graph: (q: { types?: string; topicId?: string; structure?: string }) => api.get<Graph>('/graph', q),
  dashboard: () => api.get<Dashboard>('/dashboard'),
  search: (q: string, types?: string, limit = 20, signal?: AbortSignal) =>
    api.get<SearchResult[]>('/search', { q, types, limit }, signal),

  favorites: {
    list: () => api.get<Favorite[]>('/favorites'),
    add: (entityType: FavoriteEntityType, entityId: string) => api.post<Favorite>('/favorites', { entityType, entityId }),
    remove: (entityType: FavoriteEntityType, entityId: string) => api.del(`/favorites/${entityType}/${entityId}`),
  },

  activity: {
    list: (cursor?: string) => api.page<ActivityEvent>('/activity', { cursor, limit: 50 }),
    view: (entityType: string, entityId: string) =>
      api.post('/activity/view', { entityType, entityId }, { track: false, retries: 0 }),
  },

  settings: {
    list: () => api.get<Setting[]>('/settings'),
    put: (key: SettingKey, value: unknown, baseVersion?: number) =>
      api.put<Setting>(`/settings/${key}`, { value, ...(baseVersion ? { baseVersion } : {}) }),
  },

  trash: {
    list: () => api.get<TrashItem[]>('/trash'),
    restore: (type: string, id: string) => api.post<{ count: number }>('/trash/restore', { type, id }),
    purge: (type: string, id: string) => api.del<{ count: number }>(`/trash/${type}/${id}`),
    empty: () => api.post<{ count: number }>('/trash/empty'),
  },

  backup: {
    manifest: () => api.get<BackupManifest>('/backup/manifest'),
    exportPage: (table: BackupTableName, cursor?: string) =>
      api.get<{ table: string; rows: Record<string, unknown>[]; nextCursor: string | null }>(
        `/backup/export/${table}`,
        { cursor },
      ),
    createImport: (mode: ImportMode, manifest: BackupManifest) =>
      api.post<{ jobId: string }>('/backup/imports', { mode, manifest }),
    chunk: (jobId: string, seq: number, table: BackupTableName, rows: Record<string, unknown>[]) =>
      api.post<{ accepted: number }>(`/backup/imports/${jobId}/chunks`, { seq, table, rows }),
    commit: (jobId: string, chunkCount: number, confirm?: string) =>
      api.post<ImportResult>(`/backup/imports/${jobId}/commit`, { chunkCount, ...(confirm ? { confirm } : {}) }),
    cancel: (jobId: string) => api.del(`/backup/imports/${jobId}`),
  },

  speech: {
    list: (q: { topicId?: string; cursor?: string; limit?: number } = {}) => api.page<SpeechAttemptSummary>('/speech/attempts', q),
    get: (id: string) => api.get<SpeechAttempt>(`/speech/attempts/${id}`),
    create: (body: SpeechAttemptCreate) => api.post<SpeechAttempt>('/speech/attempts', body),
    remove: (id: string) => api.del(`/speech/attempts/${id}`),
    evaluate: (id: string, force = false) =>
      api.post<SpeechAttempt>(`/speech/attempts/${id}/evaluate`, { force }, { retries: 0, track: false }),
    path: (today: string) => api.get<SpeechPathState>('/speech/path', { today }),
    practice: (body: SpeechPracticeCreate) => api.post<SpeechPracticeResult>('/speech/practice', body),
    feedback: (body: SpeechFeedbackRequest) => api.post<SpeechFeedback>('/speech/feedback', body, { retries: 0, track: false }),
    questions: (id: string, force = false) => api.post<SpeechAttempt>(`/speech/attempts/${id}/questions`, { force }, { retries: 0, track: false }),
    variants: (skill: SkillId) => api.get<VariantExercise[]>('/speech/variants', { skill }),
    uploadAudio: async (id: string, wav: Uint8Array<ArrayBuffer>) => {
      const res = await request('PUT', `/speech/attempts/${id}/audio`, { rawBody: new Blob([wav], { type: 'audio/wav' }), headers: { 'Content-Type': 'audio/wav' }, retries: 0 });
      return ((await res.json()) as { data: SpeechAttempt }).data;
    },
    audio: (id: string) => api.blob(`/speech/attempts/${id}/audio`),
    fullEvaluation: (id: string, force = false) =>
      api.post<SpeechAttempt>(`/speech/attempts/${id}/full-evaluation`, { force }, { retries: 0, track: false }),
    projects: () => api.get<SpeechProject[]>('/speech/projects'),
    project: (id: string) => api.get<SpeechProject>(`/speech/projects/${id}`),
    createProject: (body: SpeechProjectCreate) => api.post<SpeechProject>('/speech/projects', body),
    updateProject: (id: string, body: SpeechProjectUpdate) => api.patch<SpeechProject>(`/speech/projects/${id}`, body, { retries: 0 }),
    removeProject: (id: string) => api.del(`/speech/projects/${id}`),
    pushStatus: () => api.get<PushStatus>('/speech/push'),
    subscribePush: (body: PushSubscriptionInput) => api.post<PushStatus>('/speech/push/subscriptions', body),
    unsubscribePush: (endpoint: string) => api.post<PushStatus>('/speech/push/unsubscribe', { endpoint }),
    testPush: () => api.post<{ sent: number }>('/speech/push/test'),
  },

  review: {
    summary: (today: string) => api.get<ReviewSummary>('/review/summary', { today }),
    stats: (today: string, tzOffset: number) => api.get<ReviewStats>('/review/stats', { today, tzOffset }),
    /** `topicIds`: each one with all its descendants; empty = everything. */
    scope: (topicIds: string[], today: string) => api.get<ReviewScopeInfo>('/review/scope', { today, topicIds: topicIds.join(',') || undefined }),
    queue: (q: { topicIds: string[]; mode: string; today: string; limit?: number }) =>
      api.get<ReviewQueue>('/review/queue', { mode: q.mode, today: q.today, limit: q.limit, topicIds: q.topicIds.join(',') || undefined }),
    cards: (q: { topicIds?: string[]; noteId?: string; kind?: string; status?: string; q?: string; cursor?: string; limit?: number }) =>
      api.page<ReviewCard>('/review/cards', { ...q, topicIds: q.topicIds?.join(',') || undefined }),
    card: (id: string) => api.get<ReviewCard>(`/review/cards/${id}`),
    createCards: (body: ReviewCardCreate) => api.post<ReviewCard[]>('/review/cards', body),
    updateCard: (id: string, body: ReviewCardUpdate) => api.patch<ReviewCard>(`/review/cards/${id}`, body),
    removeCard: (id: string) => api.del(`/review/cards/${id}`),
    /** Not retried by the client: the outbox keeps answers given without internet. */
    answer: (id: string, body: ReviewAnswer) => api.post<ReviewAnswerResult>(`/review/cards/${id}/answer`, body, { retries: 0 }),
    evaluate: (id: string, body: { answer: string; prompt?: string }) =>
      api.post<ReviewEvaluation>(`/review/cards/${id}/evaluate`, body, { retries: 0, track: false }),
    help: (id: string) => api.post<ReviewHelp>(`/review/cards/${id}/help`, {}, { retries: 0, track: false }),
    variants: (cardIds: string[]) => api.post<ReviewVariants>('/review/variants', { cardIds }, { retries: 0, track: false }),
    generate: (body: ReviewGenerate) => api.post<ReviewGenerateResult>('/review/generate', body, { retries: 0, track: false }),
    proposals: (q: { batchId?: string } = {}) => api.get<ReviewProposal[]>('/review/proposals', q),
    decide: (body: ReviewProposalDecision) => api.post<{ created: ReviewCard[]; discarded: number }>('/review/proposals/decide', body),
    sessions: (limit = 10) => api.get<ReviewSession[]>('/review/sessions', { limit }),
    startSession: (body: ReviewSessionCreate) => api.post<ReviewSession>('/review/sessions', body),
    session: (id: string) => api.get<ReviewSessionSummary>(`/review/sessions/${id}`),
    finishSession: (id: string, seconds: number) => api.post<ReviewSessionSummary>(`/review/sessions/${id}/finish`, { seconds }),
    recall: (body: ReviewRecallCreate) => api.post<ReviewRecall>('/review/recalls', body, { retries: 0, track: false }),
    recalls: (topicId?: string) => api.get<ReviewRecall[]>('/review/recalls', { topicId }),
  },

  transcriptions: {
    /** One dictated segment; not counted in the sync indicator (nothing is saved). */
    create: (body: TranscriptionCreate) => api.post<Transcription>('/transcriptions', body, { track: false }),
  },

  ai: {
    status: () => api.get<AiStatus>('/ai/status'),
    /**
     * One chat turn. Never retried automatically (a turn costs tokens); the
     * user retries with the same messageId, which the API answers only once.
     */
    chat: (body: AiChatRequest) => api.post<AiChatResponse>('/ai/chat', body, { retries: 0, track: false }),
    /** The same turn, streamed: progress and text arrive in `onEvent` (status, tool, delta, reset). */
    chatStream: (body: AiChatRequest, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal) =>
      postStream<AiChatResponse>('/ai/chat/stream', body, onEvent, signal),
    index: () => api.get<AiIndexStatus>('/ai/index'),
    /** One indexing batch of what changed (`more`: call again). */
    syncIndex: (body: { reset?: boolean; settle?: boolean } = {}) => api.post<AiIndexSync>('/ai/index/sync', body, { retries: 0, track: false }),
    conversations: () => api.get<AiConversationSummary[]>('/ai/conversations'),
    conversation: (id: string) => api.get<AiConversation>(`/ai/conversations/${id}`),
    removeConversation: (id: string) => api.del(`/ai/conversations/${id}`),
    confirm: (actionId: string) => api.post<AiActionDecision>(`/ai/actions/${actionId}/confirm`, {}, { retries: 0 }),
    reject: (actionId: string) => api.post<AiActionDecision>(`/ai/actions/${actionId}/reject`, {}, { retries: 0 }),
  },
};
