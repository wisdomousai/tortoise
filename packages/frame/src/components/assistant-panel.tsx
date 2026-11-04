import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouterState } from '@tanstack/react-router';
import {
  Bot,
  MessageSquarePlus,
  PanelRightClose,
  SendHorizontal,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import { Accounts, type AgentSelection } from '@/components/accounts';
import { Transcript } from '@/components/assistant-transcript';
import { Button } from '@/components/ui/button';
import { NativeDialog } from '@/components/ui/native-dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  useAgents,
  useAssistantConversation,
  useHostHarnesses,
  type AssistantConversation,
} from '@/lib/assistant-conversation';
import { useCompact } from '@/lib/compact';
import { cn } from '@/lib/utils';

const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 384;
const WIDTH_KEY = 'tortoise.assistant.width';
const AGENT_KEY = 'tortoise.assistant.agent';
const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

/** A stored preference. Storage can be off or full, so it falls back. */
function preference(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function setPreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The preference then lasts as long as the page.
  }
}

/** Whether the sheet is open on a compact viewport, shared by the bar's button and the panel. */
let sheetOpen = false;
const sheetListeners = new Set<() => void>();
function setSheetOpen(open: boolean) {
  sheetOpen = open;
  for (const listener of sheetListeners) listener();
}
function useSheetOpen() {
  return useSyncExternalStore(
    (change) => {
      sheetListeners.add(change);
      return () => sheetListeners.delete(change);
    },
    () => sheetOpen,
  );
}

/** The button in the compact bar that opens the assistant as a sheet; the `asideButton`. */
export function AssistantButton() {
  return (
    <button
      type="button"
      aria-label="Open assistant"
      onClick={() => setSheetOpen(true)}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-sidebar-accent"
    >
      <Bot className="size-5" aria-hidden />
    </button>
  );
}

/**
 * The agent the panel talks to and the harness that runs it. The first agent of the catalog, or
 * the one the person picked last; the host's own model when it serves one, else the
 * deterministic demo, until the person picks an account.
 */
function useChoice() {
  const agents = useAgents();
  const harnesses = useHostHarnesses();
  const [agentId, setAgentId] = useState(() => preference(AGENT_KEY));
  const [picked, setPicked] = useState<AgentSelection>();
  const agent = agents.find((candidate) => candidate.id === agentId) ?? agents[0];
  const host = harnesses.data ?? [];
  const harness: AgentSelection =
    picked ??
    (host.some((entry) => entry.available) ? { local: true } : { harnessId: 'deterministic' });
  return {
    agents,
    agent,
    host,
    harness,
    pickAgent(id: string) {
      setAgentId(id);
      setPreference(AGENT_KEY, id);
    },
    pickHarness: setPicked,
  };
}
type Choice = ReturnType<typeof useChoice>;

/**
 * The line under the title with what the next run sees of the current screen: the first record,
 * how many more there are, and the control that leaves them out of the next run or includes them
 * again. A screen that publishes no record shows no line.
 */
function ContextLine({ screen }: { screen: AssistantConversation['screen'] }) {
  const [first, ...more] = screen.records;
  if (!first) return null;
  const labels = screen.records.map((record) => record.label ?? record.id);
  return (
    <div
      role="group"
      aria-label="What the next run sees"
      className="flex h-8 items-center gap-1.5 border-t px-3 text-xs"
    >
      <span className="shrink-0 text-muted-foreground">
        {screen.included ? 'Sees' : 'Left out'}
      </span>
      <span
        title={labels.join('\n')}
        className={cn(
          'min-w-0 truncate font-medium',
          !screen.included && 'text-muted-foreground line-through',
        )}
      >
        {labels[0]}
      </span>
      {more.length > 0 && (
        <span className="shrink-0 text-muted-foreground tabular-nums">+{more.length}</span>
      )}
      {screen.included ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          aria-label="Leave out of the next run"
          title="Leave out of the next run"
          onClick={screen.leaveOut}
        >
          <X aria-hidden />
        </Button>
      ) : (
        <Button size="xs" variant="ghost" className="ml-auto" onClick={screen.include}>
          Include
        </Button>
      )}
    </div>
  );
}

function Header({
  choice,
  conversation,
  settings,
  onSettings,
  onCollapse,
  onClose,
}: {
  choice: Choice;
  conversation: AssistantConversation;
  settings: boolean;
  onSettings: () => void;
  onCollapse?: () => void;
  onClose?: () => void;
}) {
  return (
    <header className="shrink-0 border-b">
      <div className="flex h-11 items-center gap-1 px-2">
        <Bot className="ml-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {choice.agents.length > 1 ? (
          <NativeSelect
            aria-label="Agent"
            className="h-8 min-w-0 flex-1 text-sm font-semibold"
            value={choice.agent?.id ?? ''}
            onChange={(event) => choice.pickAgent(event.target.value)}
          >
            {choice.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.title}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {choice.agent?.title ?? 'Assistant'}
          </h2>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New conversation"
          title="New conversation"
          disabled={!conversation.turns.length && !conversation.draft}
          onClick={conversation.clear}
        >
          <MessageSquarePlus aria-hidden />
        </Button>
        <Button
          size="icon-sm"
          variant={settings ? 'secondary' : 'ghost'}
          aria-label="Harness"
          aria-pressed={settings}
          title="Harness"
          onClick={onSettings}
        >
          <Settings2 aria-hidden />
        </Button>
        {onCollapse && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Collapse assistant"
            title="Collapse"
            onClick={onCollapse}
          >
            <PanelRightClose aria-hidden />
          </Button>
        )}
        {onClose && (
          <Button size="icon-sm" variant="ghost" aria-label="Close assistant" onClick={onClose}>
            <X aria-hidden />
          </Button>
        )}
      </div>
      <ContextLine screen={conversation.screen} />
    </header>
  );
}

/**
 * A growing text area: Enter sends, Shift+Enter breaks the line, Stop cancels the running run.
 */
function Composer({ conversation }: { conversation: AssistantConversation }) {
  const { draft, setDraft, sending, active, error } = conversation;
  return (
    <form
      className="space-y-1.5 border-t p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void conversation.send();
      }}
    >
      {error && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-end gap-1.5">
        <Textarea
          aria-label="Message"
          rows={1}
          maxLength={8000}
          placeholder="Ask the agent"
          disabled={!conversation.agentId}
          className="max-h-40 min-h-8 resize-none py-1.5 text-[0.8rem] md:text-[0.8rem]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void conversation.send();
          }}
        />
        {active ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void conversation.stop()}
          >
            <Square aria-hidden />
            Stop
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
            <SendHorizontal aria-hidden />
            Send
          </Button>
        )}
      </div>
    </form>
  );
}

/** What the panel shows before the first message of a conversation. */
function Empty({ choice }: { choice: Choice }) {
  if (!choice.agent)
    return <p className="text-xs text-muted-foreground">This application declares no agent.</p>;
  return (
    <div className="space-y-1.5 text-xs text-muted-foreground">
      <p>
        {choice.agent.title} sees the records of this screen and works through the commands and
        queries it was given, under your permissions.
      </p>
      {choice.harness.harnessId === 'deterministic' && (
        <p>
          The deterministic demo runs no model: send a script such as{' '}
          <code className="font-mono">{'{"commands": [], "text": "Hello"}'}</code>.
        </p>
      )}
    </div>
  );
}

/**
 * The panel's content, shared by the docked aside and the compact sheet. The conversation lives
 * here, so it survives navigation, collapsing and the sheet; the host keeps it across reloads.
 */
function Panel({
  conversation,
  choice,
  onCollapse,
  onClose,
}: {
  conversation: AssistantConversation;
  choice: Choice;
  onCollapse?: () => void;
  onClose?: () => void;
}) {
  const [settings, setSettings] = useState(false);
  const [accountError, setAccountError] = useState<string>();
  return (
    <>
      <Header
        choice={choice}
        conversation={conversation}
        settings={settings}
        onSettings={() => setSettings((open) => !open)}
        {...(onCollapse ? { onCollapse } : {})}
        {...(onClose ? { onClose } : {})}
      />
      {settings && (
        <div className="shrink-0 space-y-1.5 border-b p-2">
          <Accounts
            selection={choice.harness}
            onSelect={(selection) => {
              setAccountError(undefined);
              choice.pickHarness(selection);
            }}
            onError={setAccountError}
            host={choice.host}
          />
          {accountError && (
            <p role="alert" className="px-1 text-xs text-destructive">
              {accountError}
            </p>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Transcript conversation={conversation} empty={<Empty choice={choice} />} />
      </div>
      <Composer conversation={conversation} />
    </>
  );
}

/**
 * The left edge of the docked panel: drag it, or use the arrow keys, to set the width between
 * 320 and 640 pixels. The width is stored when the drag ends.
 */
function ResizeHandle({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const latest = useRef(width);
  latest.current = width;
  const set = (next: number) => {
    const clamped = clampWidth(next);
    onWidth(clamped);
    return clamped;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize assistant"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none outline-none hover:bg-primary/30 focus-visible:bg-primary/40"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: latest.current };
      }}
      onPointerMove={(event) => {
        // Dragging the left edge to the left widens the panel.
        if (drag.current) set(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = undefined;
        setPreference(WIDTH_KEY, String(latest.current));
      }}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
        if (!step) return;
        event.preventDefault();
        setPreference(WIDTH_KEY, String(set(latest.current + step)));
      }}
    />
  );
}

/**
 * The assistant panel, an application's `aside` (with `AssistantButton` as its `asideButton`).
 * Docked at the right of every screen, it is resizable by its left edge and collapses to a rail.
 * On a compact viewport it opens as a full-height sheet from the button in the bar and closes when
 * a link in it navigates. It talks to the application's agent definitions through the run route;
 * screens hand it their records with `useAssistantContext`.
 */
export function AssistantPanel() {
  const choice = useChoice();
  const body = { choice, conversation: useAssistantConversation(choice.agent?.id, choice.harness) };
  const compact = useCompact();
  const open = useSheetOpen();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const stored = Number(preference(WIDTH_KEY));
    return stored ? clampWidth(stored) : DEFAULT_WIDTH;
  });
  const location = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    setSheetOpen(false);
  }, [location]);

  if (compact)
    return (
      <NativeDialog
        open={open}
        onOpenChange={setSheetOpen}
        label="Assistant"
        className="m-0 ml-auto h-full max-h-none w-full max-w-md rounded-none bg-card text-card-foreground"
      >
        <div className="flex h-full flex-col">
          <Panel {...body} onClose={() => setSheetOpen(false)} />
        </div>
      </NativeDialog>
    );
  if (collapsed)
    return (
      <aside aria-label="Assistant" className="border-l bg-card">
        <div className="sticky top-0 flex h-screen w-11 flex-col items-center py-2">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Open assistant"
            title="Assistant"
            onClick={() => setCollapsed(false)}
          >
            <Bot aria-hidden />
          </Button>
        </div>
      </aside>
    );
  return (
    <aside aria-label="Assistant" className="border-l bg-card" style={{ width }}>
      <div className="sticky top-0 flex h-screen flex-col">
        <ResizeHandle width={width} onWidth={setWidth} />
        <Panel {...body} onCollapse={() => setCollapsed(true)} />
      </div>
    </aside>
  );
}
