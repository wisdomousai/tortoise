import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { CommandPalette } from '@/components/command-palette';
import { useScreens } from '@/screens-context';
import { cn } from '@/lib/utils';

/**
 * Application frame: the hosted application's name and context, its navigation with live badges,
 * an optional sidebar section, the status slot and the capability palette (⌘K). Every slot is a
 * component the application declares, so it reads authorized queries like any screen. Shadow this
 * file in the starter (`src/components/app-shell.tsx`) to restyle it.
 */
export function AppShell() {
  const { title, navigation, context: Context, sidebar: Sidebar, status: Status } = useScreens();
  const [palette, setPalette] = useState(false);
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
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[16rem_1fr]">
      <div className="bg-sidebar">
        <aside className="flex flex-col gap-5 px-3 py-5 text-sidebar-foreground lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
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
            onClick={() => setPalette(true)}
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
            <a
              className="inline-block underline-offset-4 hover:text-sidebar-foreground hover:underline"
              href="/api/v1/contract"
              target="_blank"
              rel="noreferrer"
            >
              Interaction contract ↗
            </a>
          </div>
        </aside>
      </div>
      <main className="min-w-0 px-5 py-6 lg:px-10 lg:py-8">
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
