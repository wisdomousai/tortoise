import { Factory } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { automationScreens } from '@agent-native/automation/plugin-screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import { driverScreens } from '@agent-native/connector-driver/plugin-screens';
import manifest from './manifest';
import { MesStatus, StationScreen, StationsScreen } from './ui/station';
import { StationKitScreen } from './ui/station-kit';
import { StationBridgeScreen, StationDevicesScreen } from './ui/station-admin';

/**
 * The line-station screens: the station list, the glove surface (full window, no sidebar),
 * scanner setup (device.*), the bridge view and the operator primitive gallery (`station/kit`).
 */
export default defineScreens({
  title: manifest.title,
  home: '/station',
  routes: [
    { path: 'station', component: StationsScreen },
    { path: 'station/kit', component: StationKitScreen },
    { path: 'station/$stationId', component: StationScreen, layout: 'full' },
    { path: 'station/$stationId/devices', component: StationDevicesScreen },
    { path: 'station/$stationId/bridge', component: StationBridgeScreen },
  ],
  navigation: [{ to: '/station', label: 'Stations', icon: Factory }],
  capabilityScreens: [{ prefix: 'line.station.', to: '/station' }],
  status: MesStatus,
  plugins: [complianceScreens, automationScreens, driverScreens],
});
