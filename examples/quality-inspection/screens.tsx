import { ClipboardCheck, Factory, TriangleAlert } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { assuranceScreens } from '@agent-native/assurance/plugin-screens';
import manifest from './manifest';
import { LotsScreen } from './ui/inspection';
import { CaptureScreen } from './ui/capture';
import { AttentionScreen } from './ui/sync';
import { PlantScreen } from './ui/plant';
import { PlantContext, RejectionCount, SyncBadge } from './ui/sync-status';

/**
 * The quality-inspection screens: lots to measure, the capture station, records the quality
 * system rejected, and plant access. The sidebar names the plant and role and counts rejections.
 */
export default defineScreens({
  title: manifest.title,
  home: '/inspection',
  routes: [
    { path: 'inspection', component: LotsScreen },
    { path: 'inspection/$lotId', component: CaptureScreen },
    { path: 'attention', component: AttentionScreen },
    { path: 'plant', component: PlantScreen },
  ],
  navigation: [
    { to: '/inspection', label: 'Lots', icon: ClipboardCheck },
    { to: '/attention', label: 'Needs attention', icon: TriangleAlert, badge: RejectionCount },
    { to: '/plant', label: 'Plant', icon: Factory },
  ],
  capabilityScreens: [
    { prefix: 'inspection.sync.', to: '/attention' },
    { prefix: 'inspection.result.correct', to: '/attention' },
    { prefix: 'inspection.plant.', to: '/plant' },
    { prefix: 'inspection.metrics.', to: '/plant' },
    { prefix: 'inspection.', to: '/inspection' },
  ],
  context: PlantContext,
  status: SyncBadge,
  plugins: [assuranceScreens],
});
