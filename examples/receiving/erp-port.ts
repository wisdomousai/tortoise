import { fileTargetPort } from '@agent-native/connector-files';
import type { SystemOfRecordPort } from '@agent-native/integration';
import type { FolderPort } from '@agent-native/kernel/plugin';
import { asnLineSchema, erpFolders, type AsnLine } from './contracts/erp-target';
import { goodsReceipt } from './handlers/erp-target';

/** CSV columns of a goods receipt file, in order. */
const receiptColumns = ['delivery', 'purchaseOrder', 'sku', 'counted', 'reason', 'note'] as const;

/**
 * The ERP through its exchange folders. Each goods receipt is one CSV file named after its
 * effect; the ERP answers with `<effect id>.json` in the receipts folder. Its advance shipping
 * notice exports are CSV files in the inbox, one line per row. A row that does not fit the line
 * schema fails the import, so a malformed export is reported instead of half applied.
 */
export function erpPort(
  folders: FolderPort,
  options: { readonly quietMs?: number } = {},
): SystemOfRecordPort<AsnLine> {
  return fileTargetPort<AsnLine>({
    target: 'erp',
    folders,
    drop: {
      drop: erpFolders.drop,
      receipts: erpFolders.receipts,
      format: 'csv',
      encode(effect) {
        if (effect.type !== goodsReceipt)
          return {
            rejected: { code: 'UNSUPPORTED', message: `No file format for ${effect.type}` },
          };
        const payload = effect.payload as Record<string, unknown>;
        return {
          records: [Object.fromEntries(receiptColumns.map((column) => [column, payload[column]]))],
        };
      },
    },
    feed: {
      inbox: erpFolders.inbox,
      format: 'csv',
      ...(options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
      map: (row, source) => {
        // An export without the inspect column asks for no inspection.
        const { inspect, ...line } = row as Record<string, string>;
        const parsed = asnLineSchema.safeParse({
          ...line,
          expected: Number(line.expected),
          ...(inspect ? { inspect: inspect === 'true' } : {}),
        });
        if (!parsed.success)
          throw new Error(`${source.file} row ${source.index + 1} is not a notice line`);
        return parsed.data;
      },
    },
  });
}
