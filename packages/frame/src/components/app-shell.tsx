import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Menu, Search } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Kbd } from '@/components/ui/kbd';
import { NativeDialog } from '@/components/ui/native-dialog';
import { CommandPalette } from '@/components/command-palette';
import { OsProvenanceNotice } from '@/components/os-provenance';
import { useBuild } from '@/lib/build';
import { useCompact } from '@/lib/compact';
import { useShownProvenance } from '@/lib/os-deliveries';
import { useScreens } from '@/screens-context';
import { cn } from '@/lib/utils';

/**
 * Title, context, palette button, sidebar slot, navigation and status, with the build's
 * best-before date when it has one: the shell's panel.
 */
function ShellPanel({ onFind }: { onFind: () => void }) {
  const { title, navigation, context: Context, sidebar: Sidebar, status: Status } = useScreens();
  const build = useBuild();
  return (
    <>
      <div className="px-2">
        <a href="#/" className="block text-[0.95rem] font-semibold tracking-tight">
          {title ?? 'Application'}
        </a>
        {Context ? (
          <div className="mt-0.5 text-xs text-sidebar-muted">
            <Context />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onFind}
        className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1">Find an action</span>
        <Kbd className="bg-sidebar-accent text-sidebar-muted">⌘K</Kbd>
      </button>
      {Sidebar ? <Sidebar /> : null}
      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {navigation.map(({ to, label, icon: Icon, badge: Badge }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            activeProps={{
              className: 'bg-sidebar-accent text-sidebar-foreground font-medium',
              'aria-current': 'page',
            }}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{label}</span>
            {Badge ? <Badge /> : null}
          </Link>
        ))}
      </nav>
      <div className="mt-auto space-y-2 rounded-lg bg-white/5 p-3 text-xs text-sidebar-muted">
        {Status ? <Status /> : null}
        {build?.bestBefore ? <p>Best before {build.bestBefore}</p> : null}
        <a
          className="inline-block underline-offset-4 hover:text-sidebar-foreground hover:underline"
          href="/api/v1/contract"
          target="_blank"
          rel="noreferrer"
        >
          Interaction contract ↗
        </a>
      </div>
    </>
  );
}

/**
 * On a narrow viewport: a bar with the title, a menu button that opens the panel as a sheet, and
 * the palette button. The sheet closes when a link in it navigates.
 */
function CompactBar({ onFind }: { onFind: () => void }) {
  const { title } = useScreens();
  const [menu, setMenu] = useState(false);
  const location = useRouterState({ select: (state) => state.location.href });
  useEffect(() => setMenu(false), [location]);
  const control =
    'flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-sidebar-accent';
  return (
    <header className="sticky top-0 z-10 flex items-center gap-1 bg-sidebar px-2 py-1 text-sidebar-foreground">
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setMenu(true)}
        className={control}
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <a href="#/" className="flex-1 truncate px-1 font-semibold tracking-tight">
        {title ?? 'Application'}
      </a>
      <button type="button" aria-label="Find an action" onClick={onFind} className={control}>
        <Search className="size-5" aria-hidden />
      </button>
      <NativeDialog
        open={menu}
        onOpenChange={setMenu}
        label="Navigation"
        className="m-0 h-full max-h-none w-72 max-w-[85vw] rounded-none bg-sidebar text-sidebar-foreground"
      >
        <aside className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
          <ShellPanel onFind={onFind} />
        </aside>
      </NativeDialog>
    </header>
  );
}

/**
 * Application frame: the hosted application's name and context, its navigation with live badges,
 * an optional sidebar section, the status slot, the capability palette (⌘K) and where a screen the
 * OS opened came from. On a narrow viewport the sidebar becomes a bar and a menu sheet. Every slot
 * is a component the application declares, so it reads authorized queries like any screen. Shadow
 * this file in the starter (`src/components/app-shell.tsx`) to restyle it.
 */
export function AppShell() {
  const [palette, setPalette] = useState(false);
  const compact = useCompact();
  const origin = useShownProvenance();
  const build = useBuild();
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const find = () => setPalette(true);
  return (
    <div className="grid min-h-screen grid-cols-1 content-start lg:grid-cols-[16rem_1fr] lg:content-stretch">
      {compact ? (
        <CompactBar onFind={find} />
      ) : (
        <div className="bg-sidebar">
          <aside className="flex flex-col gap-5 px-3 py-5 text-sidebar-foreground lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
            <ShellPanel onFind={find} />
          </aside>
        </div>
      )}
      <main className="min-w-0 space-y-4 px-4 py-5 lg:px-10 lg:py-8">
        {origin.shown ? (
          <OsProvenanceNotice provenance={origin.shown.provenance} onDismiss={origin.dismiss} />
        ) : null}
        {build?.pastBestBefore ? (
          <Alert className="border-warning/50">
            <AlertTitle role="status">
              This build is past its best-before date of {build.bestBefore}.
            </AlertTitle>
            <AlertDescription>
              Everything keeps working. A new release resets the date.
            </AlertDescription>
          </Alert>
        ) : null}
        <Outlet />
      </main>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}

/**
 * A count beside a navigation label. Renders nothing at zero so an empty queue stays quiet;
 * `tone="attention"` marks work that is waiting on a person.
 */
export function NavigationCount({
  count,
  tone = 'neutral',
  label,
}: {
  count: number | undefined;
  tone?: 'neutral' | 'attention';
  /** Read by screen readers after the count, for example "rejected". */
  label?: string;
}) {
  if (!count) return null;
  return (
    <span
      className={
        tone === 'attention'
          ? 'min-w-5 rounded-full bg-destructive px-1.5 text-center text-[0.7rem] font-semibold leading-5 text-white tabular-nums'
          : 'min-w-5 rounded-full bg-white/10 px-1.5 text-center text-[0.7rem] leading-5 text-sidebar-foreground tabular-nums'
      }
    >
      {count}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}

/**
 * A titled section in the sidebar slot, for live lists such as projects. The application renders
 * it from `ApplicationScreens.sidebar`, inside the query context like any screen.
 */
export function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  /** A small control beside the title, for example "New". */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-3 pb-1">
        <h2 className="text-[0.7rem] font-semibold tracking-wider text-sidebar-muted uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A sidebar entry styled like the navigation, marked current when `active`. */
export function SidebarLink({
  to,
  params,
  active,
  className,
  children,
}: {
  to: string;
  params?: Record<string, string>;
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      params={params as never}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground',
        active && 'bg-sidebar-accent font-medium text-sidebar-foreground',
        className,
      )}
    >
      {children}
    </Link>
  );
}
