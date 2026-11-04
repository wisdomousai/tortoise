import { ClipboardCheck, Inbox, List, Network, TriangleAlert } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import { complianceScreens } from '@tortoise/compliance/plugin-screens';
import { peerLinkScreens } from '@tortoise/peer-link/plugin-screens';
import manifest from './manifest';
import { deliveryRoutes } from './ui/delivery';
import { ErpScreen } from './ui/erp-target';
import { QualityScreen } from './ui/quality';
import { ApprovalsScreen } from './ui/approvals';
import { ReconcileScreen } from './ui/reconcile';
// scaffold:imports

/**
 * The Goods receiving screens: delivery lines, open approval requests, held receipts, the ERP
 * exchange, quality inspection and peers.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/deliveries',
  routes: [
    ...deliveryRoutes,
    { path: 'erp', component: ErpScreen },
    { path: 'quality', component: QualityScreen },
    { path: 'approvals', component: ApprovalsScreen },
    { path: 'reconcile', component: ReconcileScreen },
    // scaffold:routes
  ],
  navigation: [
    { to: '/deliveries', label: 'Deliveries', icon: List },
    { to: '/approvals', label: 'Approvals', icon: Inbox },
    { to: '/reconcile', label: 'Held receipts', icon: TriangleAlert },
    { to: '/erp', label: 'ERP', icon: Network },
    { to: '/quality', label: 'Quality', icon: ClipboardCheck },
    // scaffold:navigation
  ],
  capabilityScreens: [
    { prefix: 'delivery.', to: '/deliveries' },
    { prefix: 'approval.', to: '/approvals' },
    { prefix: 'reconciliation.', to: '/reconcile' },
    { prefix: 'erp.', to: '/erp' },
    { prefix: 'quality.', to: '/quality' },
    // scaffold:capability-screens
  ],
  plugins: [complianceScreens, peerLinkScreens],
});
