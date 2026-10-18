import { Inbox, List, Network, TriangleAlert } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import manifest from './manifest';
import { deliveryRoutes } from './ui/delivery';
import { ErpScreen } from './ui/erp-target';
import { ApprovalsScreen } from './ui/approvals';
import { ReconcileScreen } from './ui/reconcile';
// scaffold:imports

/** The Goods receiving screens: delivery lines, open approval requests, held receipts and the ERP exchange. */
export default defineScreens({
  title: manifest.title,
  home: '/deliveries',
  routes: [
    ...deliveryRoutes,
    { path: 'erp', component: ErpScreen },
    { path: 'approvals', component: ApprovalsScreen },
    { path: 'reconcile', component: ReconcileScreen },
    // scaffold:routes
  ],
  navigation: [
    { to: '/deliveries', label: 'Deliveries', icon: List },
    { to: '/approvals', label: 'Approvals', icon: Inbox },
    { to: '/reconcile', label: 'Held receipts', icon: TriangleAlert },
    { to: '/erp', label: 'ERP', icon: Network },
    // scaffold:navigation
  ],
  capabilityScreens: [
    { prefix: 'delivery.', to: '/deliveries' },
    { prefix: 'approval.', to: '/approvals' },
    { prefix: 'reconciliation.', to: '/reconcile' },
    { prefix: 'erp.', to: '/erp' },
    // scaffold:capability-screens
  ],
  plugins: [complianceScreens],
});
