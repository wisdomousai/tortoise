import { useParams } from '@tanstack/react-router';
import { CapabilityForm } from '@/components/capability-form';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { ProposalReview } from '@/components/proposal-review';
import { operations } from '../contracts';

export const reasonOf = (proposal: { operation: string; input: Record<string, unknown> }) =>
  proposal.operation === 'delivery.classify'
    ? `Reason: ${String(proposal.input.reason)}${proposal.input.note ? ` (${String(proposal.input.note)})` : ''}`
    : proposal.operation;

/** One line: the default record view, then counting, the discrepancy reason and posting. */
function DeliveryScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <div className="space-y-8">
      <RecordScreen title="Delivery" get={operations.deliveryGet} />
      <section aria-label="Count" className="space-y-3">
        <h2 className="text-base font-medium">Count</h2>
        <CapabilityForm
          capability={operations.deliveryReceive}
          fixed={{ id }}
          submitLabel="Record count"
        />
      </section>
      <ProposalReview
        title="Proposed reason"
        list={operations.proposalList}
        accept={operations.proposalAccept}
        reject={operations.proposalReject}
        resource={`delivery:${id}`}
        describe={reasonOf}
      />
      <section aria-label="Discrepancy reason" className="space-y-3">
        <h2 className="text-base font-medium">Discrepancy reason</h2>
        <CapabilityForm
          capability={operations.deliveryClassify}
          fixed={{ id }}
          submitLabel="Save reason"
        />
      </section>
      <section aria-label="Post to the ERP" className="space-y-3">
        <h2 className="text-base font-medium">Goods receipt</h2>
        <CapabilityForm
          capability={operations.erpSend}
          fixed={{ id }}
          submitLabel="Post goods receipt"
        />
      </section>
    </div>
  );
}

/** The default list of delivery lines, and the line screen. */
export const deliveryRoutes = [
  {
    path: 'deliveries',
    component: () => (
      <CollectionScreen
        title="Deliveries"
        list={operations.deliveryList}
        columns={['purchaseOrder', 'supplier', 'sku', 'expected', 'counted', 'status']}
        open={(row) => `/deliveries/${String(row.id)}`}
      />
    ),
  },
  { path: 'deliveries/$id', component: DeliveryScreen },
];
