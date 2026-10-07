import { QueryClientProvider } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import { ProjectsScreen } from '@/routes/projects';
import { InspectionScreen } from '@/routes/inspection';
import { CaptureScreen } from '@/routes/capture';
import { SyncScreen } from '@/routes/sync';
import { live, queryClient } from '@/lib/session';

// Code-based routes keep the screen registry explicit: each route names the capabilities it
// binds, which is what the generated contract's `ui.binding` metadata points to.
const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' });
  },
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'projects',
  component: ProjectsScreen,
});
const inspectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'inspection',
  component: InspectionScreen,
});
const captureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'inspection/$lotId',
  component: CaptureScreen,
});
const syncRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sync',
  component: SyncScreen,
});

// Hash history: the local authority serves a flat static directory without SPA fallbacks, and
// Electron loads the same build; deep links still work on reload.
const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    projectsRoute,
    inspectionRoute,
    captureRoute,
    syncRoute,
  ]),
  history: createHashHistory(),
  defaultPreload: 'intent',
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function LiveInvalidation() {
  live.useLiveInvalidation(queryClient);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveInvalidation />
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
