import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { RoutedScan } from '@tortoise/devices';
import { deviceOperations } from '@tortoise/devices/contracts';
import type { LiveBindings } from '@tortoise/react/query';
import { ScanPrompt, type ScanOutcome } from '@/components/scan-prompt';
import { KeyBurstFilter } from '@/hooks/use-operator-keys';
import { useScanner } from '@/hooks/use-scanner';
import { client, live } from '@/lib/session';
import { operations } from '../contracts';
import type { Tool } from '../contracts/tool';
import { counterIntents, counterProfile, counterRoutes, counterStation } from '../scanner';
import { scannerPath } from './scanner-setup';

/** The counter terminal and the badge screen, both from the station sign-in plugin. */
export const terminalPath = '/terminal';
const badgesPath = '/badges';

/**
 * Open a tool at the counter terminal. Another screen passes the tool in the `tool` search
 * parameter; the terminal shows it once an attendant is signed in.
 */
export function useOpenAtTerminal() {
  const navigate = useNavigate();
  return (toolId: string) => navigate({ to: terminalPath, search: { tool: toolId } } as never);
}

/** Check-out forms that take a badge scan; the open counter registers one while it shows. */
const badgeTakers = new Set<(badge: string) => void>();

/** Receive the counter's badge scans while mounted. */
export function useBadgeScans(take: (badge: string) => void) {
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    const taker = (badge: string) => latest.current(badge);
    badgeTakers.add(taker);
    return () => void badgeTakers.delete(taker);
  }, []);
}

/** Give a badge scan to the open check-out form, which fills its borrower. */
export function takeBadge(badge: string): ScanOutcome {
  if (badgeTakers.size === 0)
    return { value: badge, ok: false, message: 'Open an available tool to lend it.' };
  for (const take of badgeTakers) take(badge);
  return { value: badge, ok: true, message: 'Borrower filled. Check the form, then check out.' };
}

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Hold a scanner's keystroke burst back from the page. `KeyBurstFilter` marks each key that follows
 * the previous one within its window as part of a burst. Outside a text field such a key reaches
 * nothing, so a scan never fires a shortcut, opens a focused row or presses a focused button. In a
 * text field only the burst's Enter or Tab is held back: the scan never submits the form, and a
 * person's fast typing is never lost. The characters stay in the field, as the wedge source leaves
 * them. The wedge source listens on the same target and phase, so it still reads every key.
 */
function useBurstGuard(enabled: boolean, maxGapMs: number) {
  useEffect(() => {
    if (!enabled) return;
    const filter = new KeyBurstFilter(Math.max(50, maxGapMs));
    const listener = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (filter.push(event.key, event.timeStamp) !== 'drop') return;
      if (editable(event.target) && event.key.length === 1) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, [enabled, maxGapMs]);
}

/** A client that reads tools: the terminal's session, or the signed-in attendant's. */
type ToolReader = Pick<typeof client, 'query'>;

/**
 * The counter's keyboard-wedge scans, read through `reader` and `bindings`. A tool's asset tag is
 * looked up and handed to `onTool`; a badge goes to `onBadge`, which says what it did. A scan only
 * opens a tool or fills a field, so the attendant still submits every command. The station's
 * saved wedge profile and routes replace the defaults in `scanner.ts`. `openTool` takes a typed
 * asset tag the same way.
 */
export function useCounterScans({
  reader,
  bindings,
  enabled,
  onTool,
  onBadge,
}: {
  reader: ToolReader;
  bindings: LiveBindings;
  enabled: boolean;
  onTool: (tool: Tool) => unknown;
  onBadge: (badge: string) => ScanOutcome;
}) {
  const config = useQuery(
    bindings.liveQueryOptions(deviceOperations.configGet, { station: counterStation }),
  );
  const profile =
    config.data?.scanners.find((scanner) => scanner.transport === 'wedge') ?? counterProfile;
  const routes = config.data?.routes.length ? config.data.routes : counterRoutes;
  const [last, setLast] = useState<ScanOutcome>();
  // Only the latest tool scan may open a tool, so a slow lookup cannot open an older one.
  const lookup = useRef(0);
  useBurstGuard(enabled, profile.maxGapMs);

  const openTool = async (assetTag: string) => {
    const current = ++lookup.current;
    setLast({ value: assetTag, ok: true, message: 'Looking up the tool' });
    try {
      const listed = await reader.query(operations.toolList, { search: assetTag, limit: 5 });
      if (current !== lookup.current) return;
      const tool = listed.data.items.find((item) => item.assetTag === assetTag);
      if (!tool) {
        setLast({ value: assetTag, ok: false, message: 'No tool has this tag.' });
        return;
      }
      setLast({ value: assetTag, ok: true, message: `Opened ${tool.description}` });
      await onTool(tool);
    } catch {
      if (current === lookup.current)
        setLast({ value: assetTag, ok: false, message: 'The tool could not be looked up.' });
    }
  };
  const route = ({ intent, value }: RoutedScan) => {
    if (intent === counterIntents.tool) void openTool(value);
    else if (intent === counterIntents.badge) setLast(onBadge(value));
    else setLast({ value, ok: false, message: `The counter has no action for ${intent} scans.` });
  };
  const scanner = useScanner({
    profile,
    routes,
    enabled,
    // Every scan is reported here first; a routed scan replaces this outcome in `route`.
    onScan: (scan) => setLast({ value: scan.data, ok: false, message: 'Unknown code' }),
    onRoute: route,
  });
  return { last, error: scanner.error, openTool };
}

/**
 * The counter's scanner, docked beside every screen. It reads as the terminal's session. A tool's
 * asset tag opens that tool at the counter terminal, where an attendant signs in to lend or take
 * it back. A badge fills nothing here: check-out forms exist only at the terminal. The panel
 * pauses where a screen reads the scanner itself: the Scanner screen's setup block, the terminal
 * (the badge at sign-in, then the counter's own scans) and the badge field of the Badges screen.
 */
export function CounterScanner() {
  const openAtTerminal = useOpenAtTerminal();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const enabled = ![scannerPath, terminalPath, badgesPath].includes(path);
  const scans = useCounterScans({
    reader: client,
    bindings: live,
    enabled,
    onTool: (tool) => openAtTerminal(tool.id),
    onBadge: (badge) => ({ value: badge, ok: false, message: 'Lend tools at the terminal.' }),
  });

  return (
    <aside
      aria-label="Counter scanner"
      className="border-t px-4 py-5 lg:w-80 lg:border-t-0 lg:border-l"
    >
      <div className="space-y-3 lg:sticky lg:top-5">
        <ScanPrompt
          prompt={enabled ? 'Scan a tool' : 'Scanner paused'}
          hint={
            enabled
              ? 'A tool tag opens the tool at the terminal.'
              : path === scannerPath
                ? 'The setup on this screen reads the scanner.'
                : 'This screen reads the scanner.'
          }
          last={enabled ? scans.last : undefined}
        />
        {scans.error && <p className="text-sm text-destructive">{scans.error}</p>}
      </div>
    </aside>
  );
}
