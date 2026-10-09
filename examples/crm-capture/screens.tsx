import { Building2, Search } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import manifest from './manifest';
import { AccountScreen } from './ui/account';
import { AccountsScreen } from './ui/accounts';
import { SearchScreen } from './ui/search';
import { SyncBadge } from './ui/sync-badge';

/** Find in the CRM, the accounts this workspace follows, and one account's activities. */
export default defineScreens({
  title: manifest.title,
  home: '/search',
  routes: [
    { path: 'search', component: SearchScreen },
    { path: 'accounts', component: AccountsScreen },
    { path: 'accounts/$accountId', component: AccountScreen },
  ],
  navigation: [
    { to: '/search', label: 'Find in CRM', icon: Search },
    { to: '/accounts', label: 'Accounts', icon: Building2 },
  ],
  capabilityScreens: [
    { prefix: 'crm.account.search', to: '/search' },
    { prefix: 'crm.account.lookup', to: '/search' },
    { prefix: 'crm.account.adopt', to: '/search' },
    { prefix: 'crm.contact.', to: '/search' },
    { prefix: 'crm.', to: '/accounts' },
  ],
  status: SyncBadge,
  plugins: [complianceScreens],
});
