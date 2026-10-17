import { Inbox, List, Network } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import manifest from './manifest';
import { deliveryRoutes } from './ui/delivery';
import { ErpScreen } from './ui/erp-target';
import { ProposalsScreen } from './ui/proposals';
// scaffold:imports

/** The Goods receiving screens: delivery lines, open proposals and the ERP exchange. */
export default defineScreens({
  title: manifest.title,
  home: '/deliveries',
  routes: [
    ...deliveryRoutes,
    { path: 'erp', component: ErpScreen },
    { path: 'proposals', component: ProposalsScreen },
    // scaffold:routes
  ],
  navigation: [
    { to: '/deliveries', label: 'Deliveries', icon: List },
    { to: '/proposals', label: 'Proposals', icon: Inbox },
    { to: '/erp', label: 'ERP', icon: Network },
    // scaffold:navigation
  ],
  capabilityScreens: [
    { prefix: 'delivery.', to: '/deliveries' },
    { prefix: 'proposal.', to: '/proposals' },
    { prefix: 'erp.', to: '/erp' },
    // scaffold:capability-screens
  ],
  plugins: [complianceScreens],
});
