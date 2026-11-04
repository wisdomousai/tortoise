import { Cpu } from 'lucide-react';
import { definePluginScreens } from '@tortoise/frame/plugin-screens';
import { DriverScreen } from './components/driver-screen';

/**
 * The driver plugin's screen: driver status at `/drivers`, a sidebar entry, and the palette
 * target for `driver.*`. Built from the starter's stock primitives (`@/components/ui/*`).
 */
export const driverScreens = definePluginScreens({
  id: 'driver',
  routes: [{ path: 'drivers', component: DriverScreen }],
  navigation: [{ to: '/drivers', label: 'Drivers', icon: Cpu }],
  capabilityScreens: [{ prefix: 'driver.', to: '/drivers' }],
});
