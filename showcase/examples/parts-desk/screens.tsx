import { Boxes, Building2, FileText, List, PhoneIncoming, Search, Zap } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import { complianceScreens } from '@tortoise/compliance/plugin-screens';
import manifest from './manifest';
import { inquiryRoutes } from './ui/inquiry';
import { customerRoutes } from './ui/customer';
import { transformerRoutes } from './ui/transformer';
import { partRoutes } from './ui/part';
import { quoteRoutes } from './ui/quote';
import { ApprovalsScreen } from './ui/approvals';
import { AssistantAside, AssistantButton } from './ui/assistant';
// scaffold:imports

/**
 * The Parts Desk screens. The desk works a call on Inquiries, the transformer, the parts lookup
 * and the quote builder; customers, the transformer register and the part catalog keep the
 * default list and record screens for the people who keep master data. The assistant panel is
 * docked beside every screen, and on a compact viewport opens from its button in the bar.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/inquiries',
  routes: [
    ...inquiryRoutes,
    ...customerRoutes,
    ...transformerRoutes,
    ...partRoutes,
    ...quoteRoutes,
    { path: 'approvals', component: ApprovalsScreen },
    // scaffold:routes
  ],
  navigation: [
    { to: '/inquiries', label: 'Inquiries', icon: PhoneIncoming },
    { to: '/parts', label: 'Parts', icon: Search },
    { to: '/quotes', label: 'Quotes', icon: FileText },
    { to: '/transformers', label: 'Transformers', icon: Zap },
    { to: '/customers', label: 'Customers', icon: Building2 },
    { to: '/parts/catalog', label: 'Part catalog', icon: Boxes },
    { to: '/approvals', label: 'Approvals', icon: List },
    // scaffold:navigation
  ],
  capabilityScreens: [
    { prefix: 'inquiry.', to: '/inquiries' },
    { prefix: 'customer.', to: '/customers' },
    { prefix: 'transformer.', to: '/transformers' },
    { prefix: 'transformer.find', to: '/inquiries' },
    { prefix: 'part.', to: '/parts/catalog' },
    { prefix: 'part.search', to: '/parts' },
    { prefix: 'quote.', to: '/quotes' },
    { prefix: 'approval.', to: '/approvals' },
    // scaffold:capability-screens
  ],
  features: [
    // scaffold:features
  ],
  plugins: [complianceScreens],
  aside: AssistantAside,
  asideButton: AssistantButton,
});
