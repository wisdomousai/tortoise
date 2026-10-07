import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { InspectionScreen } from './ui/inspection';
import { CaptureScreen } from './ui/capture';
import { SyncScreen } from './ui/sync';
import { SyncBadge } from './ui/sync-status';

/** The quality-inspection screens: lots, capture, synchronization and the sync badge. */
export default defineScreens({
  home: '/inspection',
  routes: [
    { path: 'inspection', component: InspectionScreen },
    { path: 'inspection/$lotId', component: CaptureScreen },
    { path: 'sync', component: SyncScreen },
  ],
  navigation: [
    { to: '/inspection', label: 'Inspection', icon: ClipboardCheck },
    { to: '/sync', label: 'Synchronization', icon: RefreshCw },
  ],
  capabilityScreens: [
    { prefix: 'inspection.sync.', to: '/sync' },
    { prefix: 'inspection.result.correct', to: '/sync' },
    { prefix: 'inspection.', to: '/inspection' },
  ],
  status: SyncBadge,
});
