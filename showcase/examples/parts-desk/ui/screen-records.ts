/**
 * The records a screen shows and the person has selected on it, as the assistant panel names them
 * to the next run: the header's label, the `<kind>:<id>` the panel's UI session selects, and the
 * requests the composer offers. Pure, so a unit test reads it without a browser.
 */
import type { Inquiry } from '../contracts/inquiry';
import type { Part } from '../contracts/part';
import type { Quote } from '../contracts/quote';

export type ScreenRecord =
  | {
      readonly kind: 'transformer';
      readonly id: string;
      readonly serial: string;
      readonly customerName?: string;
    }
  | {
      readonly kind: 'inquiry';
      readonly id: string;
      readonly caller: string;
      readonly subject: string;
      readonly serial?: string;
      readonly status: Inquiry['status'];
    }
  | {
      readonly kind: 'part';
      readonly id: string;
      readonly partNumber: string;
      readonly description: string;
      readonly stock: number;
    }
  | {
      readonly kind: 'quote';
      readonly id: string;
      readonly number: string;
      readonly serial: string;
      readonly status: Quote['status'];
      /** A discount the person entered on the screen and has not saved, in percent. */
      readonly enteredPercent?: number;
    };

/** The most requests the composer offers. */
export const MAX_REQUESTS = 3;

export const transformerRecord = (transformer: {
  id: string;
  serial: string;
  customerName?: string | undefined;
}): ScreenRecord => ({
  kind: 'transformer',
  id: transformer.id,
  serial: transformer.serial,
  ...(transformer.customerName ? { customerName: transformer.customerName } : {}),
});

export const inquiryRecord = (inquiry: Inquiry): ScreenRecord => ({
  kind: 'inquiry',
  id: inquiry.id,
  caller: inquiry.caller,
  subject: inquiry.subject,
  status: inquiry.status,
  ...(inquiry.transformerSerial ? { serial: inquiry.transformerSerial } : {}),
});

export const partRecord = (part: Part): ScreenRecord => ({
  kind: 'part',
  id: part.id,
  partNumber: part.partNumber,
  description: part.description,
  stock: part.stock,
});

/** The quote, with the discount of the screen's unsaved changes when a draft has one. */
export function quoteRecord(quote: Quote, unsaved?: { percent: number }): ScreenRecord {
  const entered =
    quote.status === 'draft' &&
    unsaved &&
    unsaved.percent > 0 &&
    unsaved.percent !== quote.discountPercent
      ? unsaved.percent
      : undefined;
  return {
    kind: 'quote',
    id: quote.id,
    number: quote.number,
    serial: quote.transformerSerial,
    status: quote.status,
    ...(entered === undefined ? {} : { enteredPercent: entered }),
  };
}

/** What the panel's header shows of the record, such as "TR-40417 · Stadtwerke Nordhafen". */
export function recordLabel(record: ScreenRecord): string {
  switch (record.kind) {
    case 'transformer':
      return record.customerName ? `${record.serial} · ${record.customerName}` : record.serial;
    case 'inquiry':
      return `Call from ${record.caller} · ${record.subject}`;
    case 'part':
      return `${record.partNumber} · ${record.description}`;
    case 'quote':
      return `${record.number} · ${record.status} for ${record.serial}`;
  }
}

/**
 * The records as the selection of the panel's UI session, each once. The reads of these records
 * return no revision, so each is observed at revision 0, the only one the host accepts for them.
 */
export function screenResources(records: readonly ScreenRecord[]) {
  const ids = [...new Set(records.map((record) => `${record.kind}:${record.id}`))];
  return ids.map((id) => ({ id, revision: 0 }));
}

/** The requests one record suggests, the most specific first. */
function requestsOf(record: ScreenRecord): string[] {
  switch (record.kind) {
    case 'transformer':
      return [
        `Which HV bushings fit ${record.serial}?`,
        `Which tap changer parts fit ${record.serial}, and are they in stock?`,
        `Which quotes are open for ${record.serial}?`,
      ];
    case 'inquiry':
      return [
        record.subject,
        ...(record.serial && record.status === 'open'
          ? [`Prepare a quote for the call from ${record.caller} about ${record.serial}`]
          : []),
      ];
    case 'part':
      return [
        `Which transformers does ${record.partNumber} fit?`,
        record.stock === 0
          ? `${record.partNumber} is out of stock. Which part can replace it?`
          : `How many ${record.partNumber} are in stock, and what is the lead time?`,
      ];
    case 'quote':
      return record.status === 'draft'
        ? [
            ...(record.enteredPercent === undefined
              ? []
              : [`Discount ${record.number} by ${record.enteredPercent} percent`]),
            `Which parts on ${record.number} are in stock?`,
            `Submit ${record.number}`,
          ]
        : [`Which parts on ${record.number} are in stock?`];
  }
}

/**
 * Up to three requests drawn from the records, in turn: the first request of each record, then
 * the second of each, so the record a screen shows and the person's selection each get one.
 */
export function screenRequests(records: readonly ScreenRecord[]): string[] {
  const lists = records.map(requestsOf);
  const requests: string[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let turn = 0; turn < longest; turn++)
    for (const list of lists) {
      const request = list[turn];
      if (request && !requests.includes(request)) requests.push(request);
      if (requests.length === MAX_REQUESTS) return requests;
    }
  return requests;
}
