import {
  defineAgent,
  defineModule,
  approvalOperations,
  reconciliationOperations,
} from '@agent-native/contracts';
import { deliveryOperations } from './contracts/delivery';
import { erpSend, erpTarget } from './contracts/erp-target';
// scaffold:imports

/** Every operation of the Goods receiving module, by key. Browser-safe. */
export const operations = {
  ...deliveryOperations,
  erpSettle: erpTarget.settle,
  erpSync: erpTarget.sync,
  erpStatus: erpTarget.status,
  erpSend,
  ...approvalOperations,
  ...reconciliationOperations,
  // scaffold:operations
} as const;

export const receivingModule = defineModule({
  id: 'receiving',
  capabilities: Object.values(operations),
  agents: [
    defineAgent({
      id: 'receiving.discrepancy',
      title: 'Discrepancy classifier',
      instructions:
        'List counted delivery lines. For each whose counted quantity differs from the expected one and that has no reason, read it and request approval for delivery.classify with the likely reason (short, over, damaged or wrong-item) and a short note, with resource delivery:<id> and the line revision you read as baseRevisions. A person approves or rejects each request. Never request approval for counts or postings.',
      operations: ['delivery.list', 'delivery.get', 'delivery.classify', 'approval.list'],
      model: 'any',
      output: 'request-approval',
      budgets: { turns: 8, toolCalls: 30, wallTimeMs: 180_000 },
    }),
  ],
  requirements: {
    network: [
      // scaffold:network
    ],
  },
});
