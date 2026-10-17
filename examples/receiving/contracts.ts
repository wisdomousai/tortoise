import { defineAgent, defineModule, proposalOperations } from '@agent-native/contracts';
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
  ...proposalOperations,
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
        'List counted delivery lines. For each whose counted quantity differs from the expected one and that has no reason, read it and propose delivery.classify with the likely reason (short, over, damaged or wrong-item) and a short note, with resource delivery:<id> and the line revision you read as baseRevisions. A person accepts or rejects each proposal. Never propose counts or postings.',
      operations: ['delivery.list', 'delivery.get', 'delivery.classify', 'proposal.list'],
      model: 'any',
      output: 'propose',
      budgets: { turns: 8, toolCalls: 30, wallTimeMs: 180_000 },
    }),
  ],
  requirements: {
    network: [
      // scaffold:network
    ],
  },
});
