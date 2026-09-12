import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-8">
      <div className="text-center">
        <p className="text-sm text-ink-dim dark:text-ink-dim-dark">404</p>
        <h1 className="mt-2 text-xl font-semibold">There is no page here.</h1>
        <a href="/" className="mt-4 inline-block text-sm text-beacon hover:underline">
          Back to the dashboard
        </a>
      </div>
    </div>
  );
}
