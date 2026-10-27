import { useParams } from '@tanstack/react-router';
import { CapabilityForm } from '@/components/capability-form';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

/** One inspection request: what was received, and closing it with the incoming inspection outcome. */
function InspectionRequestScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <div className="space-y-8">
      <RecordScreen title="Inspection request" get={operations.inspectionRequestGet} />
      <section aria-label="Outcome" className="space-y-3">
        <h2 className="text-base font-medium">Outcome</h2>
        <CapabilityForm
          capability={operations.inspectionRequestClose}
          fixed={{ id }}
          submitLabel="Close request"
        />
      </section>
    </div>
  );
}

/** Goods other applications sent for incoming inspection, and one inspection request. */
export const inspectionRequestRoutes = [
  {
    path: 'inspection-requests',
    component: () => (
      <CollectionScreen
        title="Inspection requests"
        list={operations.inspectionRequestList}
        columns={['purchaseOrder', 'supplier', 'sku', 'quantity', 'status', 'outcome']}
        open={(row) => `/inspection-requests/${String(row.id)}`}
      />
    ),
  },
  { path: 'inspection-requests/$id', component: InspectionRequestScreen },
];
