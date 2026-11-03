import { expect, test } from 'bun:test';
import type { Inquiry } from '../contracts/inquiry';
import type { Part } from '../contracts/part';
import type { Quote } from '../contracts/quote';
import {
  inquiryRecord,
  partRecord,
  quoteRecord,
  recordLabel,
  screenRequests,
  screenResources,
  transformerRecord,
} from '../ui/screen-records';

// What the assistant panel offers and names for the records a screen publishes, without a
// browser. The browser test (`e2e/assistant.pw.ts`) sends one from the transformer screen.

const transformer = transformerRecord({
  id: 't1',
  serial: 'TR-40417',
  customerName: 'Stadtwerke Nordhafen',
});
const inquiry: Inquiry = {
  id: 'i1',
  caller: 'J. Weber',
  customerId: 'c1',
  transformerSerial: 'TR-40417',
  subject: 'Two HV bushings after a flashover',
  status: 'open',
  createdBy: 'owner',
  createdAt: 0,
};
const part: Part = {
  id: 'p1',
  partNumber: 'BSH-145-1250',
  description: 'HV bushing 145 kV 1250 A, OIP',
  category: 'bushing',
  assembly: 'hv-bushings',
  fits: ['PTX-40'],
  unitPrice: 1_480_000,
  stock: 3,
  leadTimeDays: 42,
  createdBy: 'owner',
  createdAt: 0,
};
const quote: Quote = {
  id: 'q1',
  number: 'Q-00003',
  customerId: 'c1',
  transformerSerial: 'TR-40417',
  lines: [
    {
      partNumber: 'BSH-145-1250',
      description: 'HV bushing 145 kV 1250 A, OIP',
      quantity: 2,
      unitPrice: 1_480_000,
    },
  ],
  discountPercent: 0,
  status: 'draft',
  total: 2_960_000,
  createdBy: 'owner',
  createdAt: 0,
};

test('a transformer offers its bushings, tap changer parts and open quotes, under its serial and utility', () => {
  expect(recordLabel(transformer)).toBe('TR-40417 · Stadtwerke Nordhafen');
  expect(screenRequests([transformer])).toEqual([
    'Which HV bushings fit TR-40417?',
    'Which tap changer parts fit TR-40417, and are they in stock?',
    'Which quotes are open for TR-40417?',
  ]);
  expect(recordLabel(transformerRecord({ id: 't1', serial: 'TR-40417' }))).toBe('TR-40417');
});

test('an inquiry offers its subject, and a quote for the call while it is open and names a serial', () => {
  expect(recordLabel(inquiryRecord(inquiry))).toBe(
    'Call from J. Weber · Two HV bushings after a flashover',
  );
  expect(screenRequests([inquiryRecord(inquiry)])).toEqual([
    'Two HV bushings after a flashover',
    'Prepare a quote for the call from J. Weber about TR-40417',
  ]);
  expect(screenRequests([inquiryRecord({ ...inquiry, status: 'quoted' })])).toEqual([
    'Two HV bushings after a flashover',
  ]);
  const { transformerSerial: _, ...withoutSerial } = inquiry;
  expect(screenRequests([inquiryRecord(withoutSerial)])).toEqual([
    'Two HV bushings after a flashover',
  ]);
});

test('a part offers the transformers it fits, and its stock or a replacement when it has none', () => {
  expect(recordLabel(partRecord(part))).toBe('BSH-145-1250 · HV bushing 145 kV 1250 A, OIP');
  expect(screenRequests([partRecord(part)])).toEqual([
    'Which transformers does BSH-145-1250 fit?',
    'How many BSH-145-1250 are in stock, and what is the lead time?',
  ]);
  expect(screenRequests([partRecord({ ...part, stock: 0 })])).toEqual([
    'Which transformers does BSH-145-1250 fit?',
    'BSH-145-1250 is out of stock. Which part can replace it?',
  ]);
});

test('a draft quote offers the discount the person entered, its stock and the submit; a sent one its stock', () => {
  expect(recordLabel(quoteRecord(quote))).toBe('Q-00003 · draft for TR-40417');
  expect(screenRequests([quoteRecord(quote, { percent: 12 })])).toEqual([
    'Discount Q-00003 by 12 percent',
    'Which parts on Q-00003 are in stock?',
    'Submit Q-00003',
  ]);
  // No unsaved discount, or the one already saved: nothing to discount.
  expect(screenRequests([quoteRecord(quote)])).toEqual([
    'Which parts on Q-00003 are in stock?',
    'Submit Q-00003',
  ]);
  expect(screenRequests([quoteRecord({ ...quote, discountPercent: 5 }, { percent: 5 })])).toEqual([
    'Which parts on Q-00003 are in stock?',
    'Submit Q-00003',
  ]);
  const submitted = quoteRecord({ ...quote, status: 'submitted' }, { percent: 12 });
  expect(screenRequests([submitted])).toEqual(['Which parts on Q-00003 are in stock?']);
  expect(recordLabel(submitted)).toBe('Q-00003 · submitted for TR-40417');
});

test('several records take turns up to three requests, and each is selected once at revision 0', () => {
  const records = [transformer, inquiryRecord(inquiry), partRecord(part), partRecord(part)];
  expect(screenRequests(records)).toEqual([
    'Which HV bushings fit TR-40417?',
    'Two HV bushings after a flashover',
    'Which transformers does BSH-145-1250 fit?',
  ]);
  expect(screenResources(records)).toEqual([
    { id: 'transformer:t1', revision: 0 },
    { id: 'inquiry:i1', revision: 0 },
    { id: 'part:p1', revision: 0 },
  ]);
  expect(screenRequests([])).toEqual([]);
});
