import type { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { appLayoutRoute } from './routes/app-layout.js';
import { dashboardRoute } from './routes/dashboard.js';
import { loginRoute } from './routes/login.js';
import { rootRoute } from './routes/root.js';
import { settingsRoute } from './routes/settings.js';

/**
 * Routes are declared in code rather than generated from the filesystem: there are few of them,
 * and a generated route tree is a build step and a checked-in artefact to keep in step.
 */
const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([dashboardRoute, settingsRoute]),
]);

export function buildRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient } });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}
