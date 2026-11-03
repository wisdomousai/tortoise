import { useSyncExternalStore } from 'react';
import { MAX_LINES, type Quote } from '../contracts/quote';

/** One line the desk is writing: the part, how many, and the price the lookup showed. */
export interface DraftLine {
  partNumber: string;
  description: string;
  unitPrice: number;
  quantity: number;
}

/**
 * A quote the desk is writing and has not saved: a new quote for one transformer, under
 * `newQuoteKey(serial)`, or unsaved changes to a stored draft, under its id. It lives in this
 * browser tab only. The instance copies descriptions and prices from the parts again when a
 * command saves the lines, so a stale price here never reaches a quote.
 */
export interface QuoteDraft {
  serial: string;
  customerId: string;
  inquiryId?: string;
  lines: DraftLine[];
  percent: number;
  reason: string;
  /** A message for the quote screen, such as a discount the instance refused after the create. */
  notice?: string;
  /** The prefill an assistant run prepared this draft from, for the builder's prepared form. */
  preparedId?: string;
}

export const MAX_QUANTITY = 99;
export const newQuoteKey = (serial: string) => `new:${serial}`;
/** The person's changes to the form an assistant run prepared for the transformer. */
export const preparedQuoteKey = (serial: string) => `prepared:${serial}`;

const STORAGE_KEY = 'parts-desk:quote-drafts';
const storage = typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
const listeners = new Set<() => void>();

function load(): Record<string, QuoteDraft> {
  try {
    return JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') as Record<string, QuoteDraft>;
  } catch {
    return {};
  }
}

let drafts = load();

function commit(next: Record<string, QuoteDraft>) {
  drafts = next;
  storage?.setItem(STORAGE_KEY, JSON.stringify(drafts));
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Every unsaved quote of this tab, by key. */
export const useQuoteDrafts = () =>
  useSyncExternalStore(
    subscribe,
    () => drafts,
    () => drafts,
  );

/** The unsaved quote under `key`, if there is one. */
export const useQuoteDraft = (key: string) => useQuoteDrafts()[key];

/** Replace the unsaved quote under `key`, or drop it. */
export function setQuoteDraft(key: string, draft: QuoteDraft | undefined) {
  const { [key]: _dropped, ...rest } = drafts;
  commit(draft ? { ...rest, [key]: draft } : rest);
}

/** Change the unsaved quote under `key`, starting from `start` when there is none. */
export function changeQuoteDraft(
  key: string,
  start: () => QuoteDraft,
  change: (draft: QuoteDraft) => QuoteDraft,
) {
  setQuoteDraft(key, change(drafts[key] ?? start()));
}

/** A line's quantity, kept within what a quote line takes. */
export const clampQuantity = (quantity: number) =>
  Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity) || 1));

/** One more of `part` on the draft: a new line, or one more on its line. */
export function withPart(draft: QuoteDraft, part: Omit<DraftLine, 'quantity'>): QuoteDraft {
  const line = draft.lines.find((candidate) => candidate.partNumber === part.partNumber);
  if (line)
    return {
      ...draft,
      lines: draft.lines.map((candidate) =>
        candidate === line
          ? { ...candidate, quantity: clampQuantity(candidate.quantity + 1) }
          : candidate,
      ),
    };
  if (draft.lines.length >= MAX_LINES) return draft;
  return { ...draft, lines: [...draft.lines, { ...part, quantity: 1 }] };
}

/** The `quote.create` input an assistant run prepared, as far as the quote builder shows it. */
export interface PreparedQuote {
  readonly serial: string;
  readonly inquiryId?: string;
  readonly lines: readonly { readonly partNumber: string; readonly quantity: number }[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The quote a `quote.create` prefill asks for, or undefined when the input names no whole serial
 * or holds a line without a part number and a quantity. The builder quotes for the transformer's
 * own utility, so the prefill's customerId is not read; the instance checks every field again
 * when the person creates the draft.
 */
export function preparedQuote(input: unknown): PreparedQuote | undefined {
  if (!isObject(input) || typeof input.transformerSerial !== 'string') return undefined;
  const serial = input.transformerSerial.trim().toUpperCase();
  if (!/^TR-\d{5}$/.test(serial) || !Array.isArray(input.lines)) return undefined;
  const lines = input.lines.map((line) =>
    isObject(line) && typeof line.partNumber === 'string' && typeof line.quantity === 'number'
      ? { partNumber: line.partNumber.trim().toUpperCase(), quantity: line.quantity }
      : undefined,
  );
  if (lines.some((line) => line === undefined)) return undefined;
  return {
    serial,
    ...(typeof input.inquiryId === 'string' ? { inquiryId: input.inquiryId } : {}),
    lines: lines as PreparedQuote['lines'],
  };
}

/**
 * The prepared quote as a draft of the builder, starting from `start`: each line takes the
 * description and price of the part the lookup found for the transformer, and a part named twice
 * takes one line. A part the lookup did not find does not fit the transformer, so it is left out
 * and named in `left`.
 */
export function draftFromPrepared(
  prepared: PreparedQuote,
  start: QuoteDraft,
  parts: readonly Omit<DraftLine, 'quantity'>[],
  preparedId: string,
): { draft: QuoteDraft; left: string[] } {
  const left: string[] = [];
  let draft: QuoteDraft = {
    ...start,
    lines: [],
    preparedId,
    ...(prepared.inquiryId ? { inquiryId: prepared.inquiryId } : {}),
  };
  for (const { partNumber, quantity } of prepared.lines) {
    const part = parts.find((candidate) => candidate.partNumber === partNumber);
    if (!part) {
      if (!left.includes(partNumber)) left.push(partNumber);
      continue;
    }
    const line = draft.lines.find((candidate) => candidate.partNumber === partNumber);
    const lines = line
      ? draft.lines.map((candidate) =>
          candidate === line
            ? { ...candidate, quantity: clampQuantity(candidate.quantity + quantity) }
            : candidate,
        )
      : draft.lines.length < MAX_LINES
        ? [
            ...draft.lines,
            {
              partNumber,
              description: part.description,
              unitPrice: part.unitPrice,
              quantity: clampQuantity(quantity),
            },
          ]
        : draft.lines;
    draft = { ...draft, lines };
  }
  return { draft, left };
}

/** The lines as a command takes them: the part and how many; the instance copies the prices. */
export const linesInput = (lines: readonly DraftLine[]) =>
  lines.map(({ partNumber, quantity }) => ({ partNumber, quantity }));

/** A stored quote as a starting point for changes. */
export const fromQuote = (quote: Quote): QuoteDraft => ({
  serial: quote.transformerSerial,
  customerId: quote.customerId,
  ...(quote.inquiryId ? { inquiryId: quote.inquiryId } : {}),
  lines: quote.lines.map((line) => ({ ...line })),
  percent: quote.discountPercent,
  reason: quote.discountReason ?? '',
});

/** Whether the lines differ from the stored ones in part or quantity; prices are copied again. */
export const linesChanged = (draft: QuoteDraft, quote: Quote) =>
  draft.lines.length !== quote.lines.length ||
  draft.lines.some(
    (line, index) =>
      line.partNumber !== quote.lines[index]?.partNumber ||
      line.quantity !== quote.lines[index]?.quantity,
  );

/** Whether the discount or its reason differs from the stored one. */
export const discountChanged = (draft: QuoteDraft, quote: Quote) =>
  draft.percent !== quote.discountPercent || draft.reason.trim() !== (quote.discountReason ?? '');
