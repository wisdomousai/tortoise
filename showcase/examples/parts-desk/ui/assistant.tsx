import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { Bot, MessageSquarePlus, PanelRightClose, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeDialog } from '@/components/ui/native-dialog';
import { useCompact } from '@/lib/compact';
import { ContextLine } from './assistant-context';
import { Composer, Transcript } from './assistant-conversation';
import { useAssistantConversation, type AssistantConversation } from './assistant-session';

export const MIN_WIDTH = 320;
export const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 384;
const WIDTH_KEY = 'parts-desk.assistant.width';
const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

/** The width the person left the panel at. Storage can be off or full, so it falls back. */
function storedWidth() {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    return width ? clampWidth(width) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}
function storeWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // The width then lasts as long as the page.
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

/** The button in the compact bar that opens the assistant as a sheet. */
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

function Header({
  conversation,
  onCollapse,
  onClose,
}: {
  conversation: AssistantConversation;
  onCollapse?: () => void;
  onClose?: () => void;
}) {
  return (
    <header className="shrink-0 border-b">
      <div className="flex h-11 items-center gap-1 px-2">
        <Bot className="ml-1 size-4 text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">Assistant</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New conversation"
          title="New conversation"
          disabled={!conversation.messages.length && !conversation.draft}
          onClick={conversation.clear}
        >
          <MessageSquarePlus aria-hidden />
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

function Body({ conversation }: { conversation: AssistantConversation }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Transcript conversation={conversation} />
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
        storeWidth(latest.current);
      }}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
        if (!step) return;
        event.preventDefault();
        storeWidth(set(latest.current + step));
      }}
    />
  );
}

/**
 * The assistant panel, the `aside` of the screens. Docked at the right of every screen, it is
 * resizable by its left edge and collapses to a rail with the assistant's icon. On a compact
 * viewport it opens as a full-height sheet from the button in the bar, and closes when a link in
 * it navigates. The conversation lives here, so it survives navigation, collapsing and the sheet.
 * Its header shows the records of the current screen that the next run sees.
 */
export function AssistantAside() {
  const conversation = useAssistantConversation();
  const compact = useCompact();
  const open = useSheetOpen();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(storedWidth);
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
          <Header conversation={conversation} onClose={() => setSheetOpen(false)} />
          <Body conversation={conversation} />
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
        <Header conversation={conversation} onCollapse={() => setCollapsed(true)} />
        <Body conversation={conversation} />
      </div>
    </aside>
  );
}
