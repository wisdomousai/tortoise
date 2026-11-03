import { useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { holdRunPrefill } from '@/lib/os-deliveries';
import { live } from '@/lib/session';
import type { UiSessionHandlers } from '@/lib/ui-session';
import { operations } from '../contracts';
import type { UiNote } from './assistant-run';
import { preparedQuote } from './quote-drafts';
import { selectOnScreen } from './screen-context';

/** The screen that shows a record, and the record's name for the chip. */
interface RecordScreen {
  readonly name: string;
  readonly to: string;
  readonly search?: Readonly<Record<string, string>>;
}

/**
 * Where `<kind>:<id>` opens, read as the person: a transformer by its serial, a quote and a part on
 * their own screens, and a call on its transformer's screen, which shows the call, or on Inquiries
 * when it names no transformer. Throws for a record the person may not read or a kind no screen
 * shows, so the intent is rejected.
 */
async function recordScreen(queryClient: QueryClient, resource: string): Promise<RecordScreen> {
  const at = resource.indexOf(':');
  const [kind, id] = [resource.slice(0, at), resource.slice(at + 1)];
  // The cached snapshot when a screen read the record already, else a read through the instance.
  const read = async <C extends Parameters<typeof live.liveQueryOptions>[0]>(capability: C) =>
    (await queryClient.fetchQuery(live.liveQueryOptions(capability, { id } as never))).data;
  switch (kind) {
    case 'transformer': {
      const transformer = await read(operations.transformerGet);
      return { name: transformer.serial, to: `/transformers/${transformer.serial}` };
    }
    case 'quote': {
      const quote = await read(operations.quoteGet);
      return { name: quote.number, to: `/quotes/${quote.id}` };
    }
    case 'part': {
      const part = await read(operations.partGet);
      return { name: part.partNumber, to: `/parts/${part.id}` };
    }
    case 'inquiry': {
      const inquiry = await read(operations.inquiryGet);
      const name = `call from ${inquiry.caller}`;
      return inquiry.transformerSerial
        ? {
            name,
            to: `/transformers/${inquiry.transformerSerial}`,
            search: { inquiry: inquiry.id },
          }
        : { name, to: '/inquiries' };
    }
  }
  throw new Error(`No screen shows ${kind} records`);
}

/**
 * The handlers of the panel's UI session, and what each one received. The panel sits beside the
 * routes, so it applies a run's intents for every screen:
 *
 * - `ui.open` opens the record's screen (`recordScreen`).
 * - `ui.select` selects the record on the screen shown, as the person's checkbox does, and is
 *   rejected when that screen does not show it (`selectOnScreen`).
 * - `ui.prepare` on `quote.create` holds the input for the quote builder's `usePreparedInput` and
 *   opens the builder for its transformer, a route of its own. Nothing is created until the person
 *   clicks Create draft. Any other command's form is rejected, since no screen of the desk fills it.
 *
 * Each handler notes what it received and whether it applied it, for the run the panel sent last
 * (`runOf`), since the run's events name the call but not its input.
 */
export function useAssistantIntents(runOf: () => string | undefined) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [notes, setNotes] = useState<readonly UiNote[]>([]);
  const note = (entry: Omit<UiNote, 'runId'>) => {
    const runId = runOf();
    setNotes((noted) => [...noted, { ...entry, runId }]);
  };
  const go = (screen: RecordScreen) =>
    router.navigate({
      to: screen.to,
      ...(screen.search ? { search: screen.search } : {}),
    } as never);

  const handlers: UiSessionHandlers = {
    async open(resource) {
      try {
        const screen = await recordScreen(queryClient, resource);
        await go(screen);
        note({
          tool: 'ui.open',
          name: screen.name,
          to: screen.to,
          accepted: true,
          ...searchOf(screen),
        });
      } catch (error) {
        note({ tool: 'ui.open', name: resource, accepted: false });
        throw error;
      }
    },
    async select(resource) {
      let accepted = false;
      try {
        selectOnScreen(resource);
        accepted = true;
      } finally {
        const name = await recordScreen(queryClient, resource).then(
          (screen) => screen.name,
          () => resource,
        );
        note({ tool: 'ui.select', name, accepted });
      }
    },
    // #region prepare
    async prepare(operation, input, id) {
      const quote = operation === operations.quoteCreate.id ? preparedQuote(input) : undefined;
      if (!quote) {
        note({ tool: 'ui.prepare', name: '', operation, accepted: false });
        throw new Error(`No screen fills the form of ${operation}`);
      }
      holdRunPrefill(id, operation, input);
      const screen: RecordScreen = {
        name: quote.serial,
        to: '/quotes/new',
        search: { serial: quote.serial, ...(quote.inquiryId ? { inquiry: quote.inquiryId } : {}) },
      };
      await go(screen);
      note({
        tool: 'ui.prepare',
        name: quote.serial,
        operation,
        lines: quote.lines.length,
        to: screen.to,
        accepted: true,
        ...searchOf(screen),
      });
    },
    // #endregion prepare
  };
  return { handlers, notes, clearNotes: () => setNotes([]) };
}

const searchOf = (screen: RecordScreen) => (screen.search ? { search: screen.search } : {});
