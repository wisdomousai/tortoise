import { Factory, ShieldCheck } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { StationScreen, StationsScreen } from './ui/station';
import { StationKitScreen } from './ui/station-kit';
import { StationBridgeScreen, StationDevicesScreen } from './ui/station-admin';
import { SecurityScreen } from '@/components/security-screen';

/**
 * The line-station screens: the station list, the glove surface, scanner setup (device.*), the
 * bridge view and the operator primitive gallery (`station/kit`).
 */
export default defineScreens({
  home: '/station',
  routes: [
    { path: 'station', component: StationsScreen },
    { path: 'station/kit', component: StationKitScreen },
    { path: 'station/$stationId', component: StationScreen },
    { path: 'station/$stationId/devices', component: StationDevicesScreen },
    { path: 'station/$stationId/bridge', component: StationBridgeScreen },
    { path: 'security', component: SecurityScreen },
  ],
  navigation: [
    { to: '/station', label: 'Stations', icon: Factory },
    { to: '/security', label: 'Security', icon: ShieldCheck },
  ],
  capabilityScreens: [
    { prefix: 'line.station.', to: '/station' },
    { prefix: 'assurance.', to: '/security' },
  ],
});
