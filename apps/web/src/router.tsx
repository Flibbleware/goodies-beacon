import type { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { appLayoutRoute } from './routes/app-layout.js';
import { candidateRoute } from './routes/candidate.js';
import { candidatesRoute } from './routes/candidates.js';
import { dashboardRoute } from './routes/dashboard.js';
import { itemRoute } from './routes/item.js';
import { editItemRoute, newItemRoute } from './routes/item-editor.js';
import { itemsRoute } from './routes/items.js';
import { loginRoute } from './routes/login.js';
import { rootRoute } from './routes/root.js';
import { settingsRoute } from './routes/settings.js';
import { wishesRoute } from './routes/wishes.js';

/**
 * Routes are declared in code rather than generated from the filesystem: there are few of them,
 * and a generated route tree is a build step and a checked-in artefact to keep in step.
 */
const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    dashboardRoute,
    candidatesRoute,
    candidateRoute,
    itemsRoute,
    newItemRoute,
    itemRoute,
    editItemRoute,
    wishesRoute,
    settingsRoute,
  ]),
]);

export function buildRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient } });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}
