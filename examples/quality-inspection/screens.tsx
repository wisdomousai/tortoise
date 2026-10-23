import { ClipboardCheck, Factory, PackageCheck, TriangleAlert } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import { driverScreens } from '@agent-native/connector-driver/plugin-screens';
import { peerLinkScreens } from '@agent-native/peer-link/plugin-screens';
import manifest from './manifest';
import { arrivalRoutes } from './ui/arrivals';
import { LotsScreen } from './ui/inspection';
import { CaptureScreen } from './ui/capture';
import { AttentionScreen } from './ui/sync';
import { PlantScreen } from './ui/plant';
import { PlantContext, RejectionCount, SyncBadge } from './ui/sync-status';

/**
 * The quality-inspection screens: lots to measure, the capture station, arrivals announced by
 * other applications, records the quality system rejected, plant access and peers. The sidebar names the plant and role and counts rejections.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/inspection',
  routes: [
    { path: 'inspection', component: LotsScreen },
    { path: 'inspection/$lotId', component: CaptureScreen },
    ...arrivalRoutes,
    { path: 'attention', component: AttentionScreen },
    { path: 'plant', component: PlantScreen },
  ],
  navigation: [
    { to: '/inspection', label: 'Lots', icon: ClipboardCheck },
    { to: '/arrivals', label: 'Arrivals', icon: PackageCheck },
    { to: '/attention', label: 'Needs attention', icon: TriangleAlert, badge: RejectionCount },
    { to: '/plant', label: 'Plant', icon: Factory },
  ],
  capabilityScreens: [
    { prefix: 'inspection.sync.', to: '/attention' },
    { prefix: 'inspection.result.correct', to: '/attention' },
    { prefix: 'inspection.arrival.', to: '/arrivals' },
    { prefix: 'inspection.plant.', to: '/plant' },
    { prefix: 'inspection.metrics.', to: '/plant' },
    { prefix: 'inspection.', to: '/inspection' },
  ],
  context: PlantContext,
  status: SyncBadge,
  plugins: [complianceScreens, driverScreens, peerLinkScreens],
});
