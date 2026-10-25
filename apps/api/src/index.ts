import { createApp } from './app';
import { routeModules } from './modules';
import { runMaintenance } from './maintenance';
import { syncAllUsers } from './modules/assistant/knowledge-index';
import { scanAllUsers } from './modules/links/service';
import { runReviewReminders } from './modules/review/reminders';
import { runReminders } from './modules/speech/push';

export { AssistantTools } from './modules/assistant/entrypoint';

const app = createApp(routeModules);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    // "*/10 * * * *": semantic index of what changed (then the suggested links of what was indexed) and the daily reminders; the daily trigger: housekeeping.
    ctx.waitUntil(
      controller.cron.startsWith('*/10')
        ? Promise.all([syncAllUsers(env).then(() => scanAllUsers(env)), runReminders(env), runReviewReminders(env)])
        : runMaintenance(env),
    );
  },
} satisfies ExportedHandler<Env>;
