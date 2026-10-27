import { z } from 'zod';
import {
  defineCapability,
  defineTarget,
  deliveryStatusSchema,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';
import { fileExchange } from '@agent-native/connector-files/contracts';
import { deliverySchema } from './delivery';

/** What the ERP's advance shipping notice export carries for one line. */
export const asnLineSchema = deliverySchema.pick({
  id: true,
  purchaseOrder: true,
  supplier: true,
  sku: true,
  description: true,
  expected: true,
  inspect: true,
});
export type AsnLine = z.output<typeof asnLineSchema>;

/**
 * The ERP as a system of record reached through shared folders: it exports advance shipping
 * notices, and picks up one goods receipt file per posted line and answers with a receipt.
 */
export const erpTarget = defineTarget({
  target: 'erp',
  resourceType: 'ErpSync',
  settles: ['delivery'],
  feed: { item: asnLineSchema, max: 100, changes: ['delivery'] },
  status: { pending: z.number().int(), accepted: z.number().int(), rejected: z.number().int() },
  descriptions: {
    settle: 'Integration principal only: record the ERP outcome for a posted goods receipt.',
    sync: 'Integration principal only: apply advance shipping notice lines from the ERP and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize goods receipts to the ERP: waiting, accepted and rejected, and the last notice import.',
  },
});

/** The folders shared with the ERP, by folder ID; the site policy binds each to a directory. */
export const erpFolders = {
  inbox: 'erp-asn',
  drop: 'erp-goods-receipts',
  receipts: 'erp-receipts',
} as const;

export const erpExchange = fileExchange({
  id: 'erp-exchange',
  target: erpTarget.target,
  description:
    'Folders shared with the ERP: advance shipping notices in, goods receipts out, receipts back.',
  folders: erpFolders,
  dataClasses: ['delivery'],
});

export const erpSend = defineCapability({
  id: 'erp.send',
  kind: 'command',
  description:
    'Post the goods receipt of a counted delivery line to the ERP. It is written to the exchange folder after this commit; sync status shows when the ERP accepts or rejects it. Editors only; an uncounted line, a discrepancy without a reason, or a receipt still waiting conflicts.',
  input: jsonSchema(z.strictObject({ id: recordKeySchema })),
  output: jsonSchema(z.strictObject({ id: recordKeySchema, sync: deliveryStatusSchema })),
  permission: { action: 'send', resourceType: 'ErpSync' },
  dependencies: ['delivery'],
  integration: { target: 'erp', delivery: 'outbox' },
  ui: { binding: 'erp.send' },
});
