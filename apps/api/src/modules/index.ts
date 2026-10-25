import type { RouteModule } from '../app';
import { assistantRoutes } from './assistant/routes';
import { backupRoutes } from './backup/routes';
import { documentRoutes } from './documents/routes';
import { knowledgeRoutes } from './knowledge/routes';
import { linkRoutes } from './links/routes';
import { noteRoutes } from './notes/routes';
import { overviewRoutes } from './overview/routes';
import { planRoutes } from './plans/routes';
import { readingRoutes } from './readings/routes';
import { referenceRoutes } from './references/routes';
import { reviewRoutes } from './review/routes';
import { speechRoutes } from './speech/routes';
import { studyRoutes } from './study/routes';
import { topicRoutes } from './topics/routes';
import { transcriptionRoutes } from './transcriptions/routes';
import { trashRoutes } from './trash/routes';

/** All feature route modules, registered under /api/v1 (auth is built in). */
export const routeModules: RouteModule[] = [
  topicRoutes,
  noteRoutes,
  trashRoutes,
  documentRoutes,
  readingRoutes,
  planRoutes,
  studyRoutes,
  knowledgeRoutes,
  overviewRoutes,
  referenceRoutes,
  backupRoutes,
  transcriptionRoutes,
  assistantRoutes,
  speechRoutes,
  reviewRoutes,
  linkRoutes,
];
