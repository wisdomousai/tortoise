import { ClipboardCheck, Factory, PackageCheck, TriangleAlert } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import { complianceScreens } from '@tortoise/compliance/plugin-screens';
import { driverScreens } from '@tortoise/connector-driver/plugin-screens';
import { peerLinkScreens } from '@tortoise/peer-link/plugin-screens';
import manifest from './manifest';
import { inspectionRequestRoutes } from './ui/inspection-requests';
import { LotsScreen } from './ui/inspection';
import { CaptureScreen } from './ui/capture';
import { AttentionScreen } from './ui/sync';
import { PlantScreen } from './ui/plant';
import { PlantContext, RejectionCount, SyncBadge } from './ui/sync-status';

/**
 * The quality-inspection screens: lots to measure, the capture station, inspection requests from
 * other applications, records the quality system rejected, plant access and peers. The sidebar names the plant and role and counts rejections.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/inspection',
  routes: [
    { path: 'inspection', component: LotsScreen },
    { path: 'inspection/$lotId', component: CaptureScreen },
    ...inspectionRequestRoutes,
    { path: 'attention', component: AttentionScreen },
    { path: 'plant', component: PlantScreen },
  ],
  navigation: [
    { to: '/inspection', label: 'Lots', icon: ClipboardCheck },
    { to: '/inspection-requests', label: 'Inspection requests', icon: PackageCheck },
    { to: '/attention', label: 'Needs attention', icon: TriangleAlert, badge: RejectionCount },
    { to: '/plant', label: 'Plant', icon: Factory },
  ],
  capabilityScreens: [
    { prefix: 'inspection.sync.', to: '/attention' },
    { prefix: 'inspection.result.correct', to: '/attention' },
    { prefix: 'inspection.request.', to: '/inspection-requests' },
    { prefix: 'inspection.plant.', to: '/plant' },
    { prefix: 'inspection.metrics.', to: '/plant' },
    { prefix: 'inspection.', to: '/inspection' },
  ],
  context: PlantContext,
  status: SyncBadge,
  plugins: [complianceScreens, driverScreens, peerLinkScreens],
});
