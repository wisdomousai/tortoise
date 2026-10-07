import { useEffect, useState } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import {
  ClipboardCheck,
  Factory,
  FolderKanban,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { CommandPalette } from '@/components/command-palette';
import { SyncBadge } from '@/components/sync-status';
import { cn } from '@/lib/utils';

const navigation = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/inspection', label: 'Inspection', icon: ClipboardCheck },
  { to: '/station', label: 'Stations', icon: Factory },
  { to: '/sync', label: 'Synchronization', icon: RefreshCw },
  { to: '/security', label: 'Security', icon: ShieldCheck },
] as const;

/** Application frame: navigation, the capability palette (⌘K) and live sync state. */
export function AppShell() {
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
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[15rem_1fr]">
      <div className="bg-sidebar">
        <aside className="flex flex-col gap-6 px-4 py-5 text-sidebar-foreground lg:sticky lg:top-0 lg:h-screen">
          <a
            href="#/"
            className="flex items-center gap-2 px-2 text-sm font-semibold tracking-tight"
          >
            <span aria-hidden className="text-lg">
              ◈
            </span>
            Agent Native
          </a>
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-left text-sm text-sidebar-muted hover:text-sidebar-foreground"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1">Find a capability</span>
            <Kbd className="bg-sidebar text-sidebar-muted">⌘K</Kbd>
          </button>
          <nav aria-label="Sections" className="flex flex-col gap-1">
            {navigation.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
                activeProps={{ className: 'bg-sidebar-accent text-sidebar-foreground' }}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto space-y-3 px-2 text-xs text-sidebar-muted">
            <SyncBadge />
            <p>
              <span className="mr-1.5 inline-block size-2 rounded-full bg-success" aria-hidden />
              Local authority. UI, agents and tools share one contract.
            </p>
            <a
              className="underline-offset-4 hover:text-sidebar-foreground hover:underline"
              href="/api/v1/contract"
              target="_blank"
              rel="noreferrer"
            >
              Explore the interaction contract ↗
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
