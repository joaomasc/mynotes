import { createApp } from './app';
import { routeModules } from './modules';
import { runMaintenance } from './maintenance';
import { syncAllUsers } from './modules/assistant/knowledge-index';
import { runReviewReminders } from './modules/review/reminders';
import { runReminders } from './modules/speech/push';

export { AssistantTools } from './modules/assistant/entrypoint';

const app = createApp(routeModules);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    // "*/10 * * * *": semantic index of what changed and the daily reminders (speaking, review); the daily trigger: housekeeping.
    ctx.waitUntil(
      controller.cron.startsWith('*/10') ? Promise.all([syncAllUsers(env), runReminders(env), runReviewReminders(env)]) : runMaintenance(env),
    );
  },
} satisfies ExportedHandler<Env>;
