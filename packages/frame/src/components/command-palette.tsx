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
import { screenForCapability } from '@agent-native/frame/screens';
import { transport } from '@/lib/session';
import { useScreens } from '@/screens-context';

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
  const screens = useScreens();
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
  const go = (to: string) => {
    onOpenChange(false);
    void navigate({ to });
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Capabilities">
      <CommandInput placeholder="Search capabilities and screens…" autoFocus />
      <CommandList>
        <CommandEmpty>No capability matches.</CommandEmpty>
        <CommandGroup heading="Screens">
          {screens.navigation.map((item) => (
            <CommandItem key={item.to} onSelect={() => go(item.to)}>
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Capabilities">
          {operations.map((operation) => {
            const screen = screenForCapability(screens, operation.id);
            return (
              <CommandItem
                key={operation.id}
                value={`${operation.display?.label ?? ''} ${operation.id} ${operation.description ?? ''}`}
                disabled={!screen}
                onSelect={() => screen && go(screen)}
              >
                <div className="flex min-w-0 flex-col">
                  {operation.display?.label && (
                    <span className="text-sm">{operation.display.label}</span>
                  )}
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
