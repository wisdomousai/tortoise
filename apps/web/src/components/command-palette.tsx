import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { transport } from '@/lib/session';

/** Screens that bind each capability family; the palette routes a capability to its screen. */
const screens: readonly { prefix: string; to: '/projects' | '/inspection' | '/sync' }[] = [
  { prefix: 'inspection.sync.', to: '/sync' },
  { prefix: 'inspection.result.correct', to: '/sync' },
  { prefix: 'inspection.', to: '/inspection' },
  { prefix: 'project.', to: '/projects' },
  { prefix: 'task.', to: '/projects' },
];

/**
 * The human mirror of an agent's tool list: every capability this session may use, from the
 * same discovered contract that generates MCP tools. Operations the session's grant denies are
 * omitted; operations without a UI binding (integration-only) are never offered here.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: ['contract'],
    queryFn: () => transport.catalog(),
    enabled: open,
    staleTime: Infinity,
  });
  const operations = (catalog.data?.operations ?? []).filter(
    (operation) =>
      operation.ui.binding !== undefined &&
      (operation as { availability?: string }).availability !== 'denied',
  );
  const go = (to: (typeof screens)[number]['to']) => {
    onOpenChange(false);
    void navigate({ to });
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Capabilities">
      <CommandInput placeholder="Search capabilities and screens…" autoFocus />
      <CommandList>
        <CommandEmpty>No capability matches.</CommandEmpty>
        <CommandGroup heading="Screens">
          <CommandItem onSelect={() => go('/projects')}>Projects</CommandItem>
          <CommandItem onSelect={() => go('/inspection')}>Inspection lots</CommandItem>
          <CommandItem onSelect={() => go('/sync')}>Synchronization and rejections</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Capabilities">
          {operations.map((operation) => {
            const screen = screens.find((entry) => operation.id.startsWith(entry.prefix));
            return (
              <CommandItem
                key={operation.id}
                value={`${operation.id} ${operation.description ?? ''}`}
                disabled={!screen}
                onSelect={() => screen && go(screen.to)}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-xs">{operation.id}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {operation.description}
                  </span>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
