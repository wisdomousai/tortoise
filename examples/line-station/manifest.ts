import { defineManifest } from '@agent-native/host/manifest';
import { deviceConfigModule } from '@agent-native/devices/contracts';
import { lineStationModule } from './contracts';

/** Browser-safe identity of the line-station application: stations plus device configuration. */
export default defineManifest({
  id: 'line-station',
  title: 'Line stations',
  modules: [lineStationModule, deviceConfigModule],
});
