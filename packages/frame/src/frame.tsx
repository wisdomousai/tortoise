import { useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from '@tanstack/react-router';
import type { ApplicationScreens } from '@agent-native/frame/screens';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import { ScreensProvider } from '@/screens-context';
import { live, queryClient } from '@/lib/session';

/**
 * Code-based routes from the application's screens keep the registry explicit: each route names
 * the capabilities it binds, which is what the generated contract's `ui.binding` points to.
 * Hash history: the local authority serves a flat static directory without SPA fallbacks, and
 * Electron loads the same build; deep links still work on reload.
 */
function createFrameRouter(screens: ApplicationScreens) {
  const rootRoute = createRootRoute({ component: AppShell });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: screens.home });
    },
  });
  // Static segments rank above `$param` ones (`station/kit` before `station/$stationId`).
  const routes = screens.routes.map((screen) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: screen.path.replace(/^\//, ''),
      component: screen.component,
    }),
  );
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...routes]),
    history: createHashHistory(),
    defaultPreload: 'intent',
  });
}

function LiveInvalidation() {
  live.useLiveInvalidation(queryClient);
  return null;
}

/** The web frame for one application: session-scoped query cache, live invalidation, routing. */
export function Frame({ screens }: { screens: ApplicationScreens }) {
  const router = useMemo(() => createFrameRouter(screens), [screens]);
  return (
    <QueryClientProvider client={queryClient}>
      <LiveInvalidation />
      <ScreensProvider value={screens}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ScreensProvider>
    </QueryClientProvider>
  );
}
