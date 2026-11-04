import { Network } from 'lucide-react';
import { definePluginScreens } from '@tortoise/frame/plugin-screens';
import { PeersScreen } from './ui/peers';

/** The peer list with enrollment and subject mappings, its sidebar entry and palette target for `peer.*`. */
export const peerLinkScreens = definePluginScreens({
  id: 'peer-link',
  routes: [{ path: 'peers', component: PeersScreen }],
  navigation: [{ to: '/peers', label: 'Peers', icon: Network }],
  capabilityScreens: [{ prefix: 'peer.', to: '/peers' }],
});
