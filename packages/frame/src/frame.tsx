import { useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  type AnyRoute,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
} from '@tanstack/react-router';
import type { ApplicationScreens, ScreenRoute } from '@agent-native/frame/screens';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import { ScreensProvider } from '@/screens-context';
import { useCompact } from '@/lib/compact';
import { useBrowserOsInput } from '@/lib/os-browser';
import { useOsDeliveries } from '@/lib/os-deliveries';
import { live, queryClient } from '@/lib/session';

/** A screen's component, or its compact variant on a narrow viewport. */
const routeComponent = (screen: ScreenRoute) => {
  const { component: Wide, compact: Compact } = screen;
  if (!Compact) return Wide;
  return function Responsive() {
    return useCompact() ? <Compact /> : <Wide />;
  };
};

/**
 * Code-based routes from the application's screens keep the registry explicit: each route names
 * the capabilities it binds, which is what the generated contract's `ui.binding` points to.
 * Hash history: the local instance serves a flat static directory without SPA fallbacks, and
 * Electron loads the same build; deep links still work on reload.
 */
/**
 * Every layout's parent: submits the links and files the browser launched the page with, and
 * takes what OS requests asked the frame to open or prefill.
 */
function FrameRoot({ screens }: { screens: ApplicationScreens }) {
  useBrowserOsInput();
  useOsDeliveries(screens);
  return <Outlet />;
}

function createFrameRouter(screens: ApplicationScreens) {
  const rootRoute = createRootRoute({ component: () => <FrameRoot screens={screens} /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: screens.home });
    },
  });
  // Pathless layouts add no URL segment, so a screen keeps its path whether it renders in the
  // shell (sidebar and palette) or full window (a station screen that owns the display).
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'shell',
    component: AppShell,
  });
  const fullRoute = createRoute({ getParentRoute: () => rootRoute, id: 'full' });
  const routesIn = (layout: 'shell' | 'full', parent: AnyRoute) =>
    // Static segments rank above `$param` ones (`station/kit` before `station/$stationId`).
    screens.routes
      .filter((screen) => (screen.layout ?? 'shell') === layout)
      .map((screen) =>
        createRoute({
          getParentRoute: () => parent,
          path: screen.path.replace(/^\//, ''),
          component: routeComponent(screen),
        }),
      );
  return createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      shellRoute.addChildren(routesIn('shell', shellRoute)),
      fullRoute.addChildren(routesIn('full', fullRoute)),
    ]),
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
