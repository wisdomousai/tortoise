import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

/** Default screens for customers; replace either route with a purpose-built screen. */
export const customerRoutes = [
  {
    path: 'customers',
    component: () => (
      <CollectionScreen
        title="Customers"
        list={operations.customerList}
        create={operations.customerCreate}
        open={(row) => `/customers/${String(row.id)}`}
      />
    ),
  },
  {
    path: 'customers/$id',
    component: () => (
      <RecordScreen
        title="Customer"
        get={operations.customerGet}
        update={operations.customerUpdate}
      />
    ),
  },
];
