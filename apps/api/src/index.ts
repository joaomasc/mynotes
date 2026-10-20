import { createApp } from './app';
import { routeModules } from './modules';
import { runMaintenance } from './maintenance';
import { syncAllUsers } from './modules/assistant/knowledge-index';

const app = createApp(routeModules);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    // "*/10 * * * *": semantic index of what changed; the daily trigger: housekeeping.
    ctx.waitUntil(controller.cron.startsWith('*/10') ? syncAllUsers(env) : runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
