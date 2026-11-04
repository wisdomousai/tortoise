import { Smartphone } from 'lucide-react';
import { definePluginScreens } from '@tortoise/frame/plugin-screens';
import { DevicesScreen } from './ui/devices';

/** The device list with enrollment, its sidebar entry and palette target for `link.*`. */
export const deviceLinkScreens = definePluginScreens({
  id: 'device-link',
  routes: [{ path: 'devices', component: DevicesScreen }],
  navigation: [{ to: '/devices', label: 'Devices', icon: Smartphone }],
  capabilityScreens: [{ prefix: 'link.', to: '/devices' }],
});
