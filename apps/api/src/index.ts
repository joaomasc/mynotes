import { createApp } from './app';
import { routeModules } from './modules';
import { runMaintenance } from './maintenance';

const app = createApp(routeModules);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
