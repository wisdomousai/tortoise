import { Platform } from 'react-native';
import { ClipboardList, ImageOff, RefreshCw } from 'lucide-react-native';
import { defineNativeScreens } from '@agent-native/frame-native/screens';
import { hubLinkNativeScreens } from '@agent-native/hub-link/plugin-screens-native';
import { intentScannerScreens } from '@agent-native/intent-scanner/plugin-screens-native';
import { AssignmentScreen } from './ui-native/assignment';
import { AssignmentsScreen } from './ui-native/assignments';
import { CaptureScreen } from './ui-native/capture';
import { FieldStatus, SyncScreen, UnplacedScreen } from './ui-native/captures';
import { scannerProfile } from './ui-native/shared';
import manifest from './manifest';

export default defineNativeScreens({
  manifest,
  title: 'Asset survey',
  home: '/assignments',
  routes: [
    { path: '/assignments', title: 'Assignments', component: AssignmentsScreen },
    { path: '/assignment', title: 'Assignment', component: AssignmentScreen },
    { path: '/capture', title: 'Capture', component: CaptureScreen },
    { path: '/unplaced', title: 'Unplaced', component: UnplacedScreen },
    { path: '/sync', title: 'Sync', component: SyncScreen },
  ],
  navigation: [
    { to: '/assignments', label: 'Assignments', icon: ClipboardList },
    { to: '/unplaced', label: 'Unplaced', icon: ImageOff },
    { to: '/sync', label: 'Sync', icon: RefreshCw },
  ],
  capabilityScreens: [
    { prefix: 'field.assignment.', to: '/assignments' },
    { prefix: 'field.node.', to: '/assignments' },
    { prefix: 'field.capture.', to: '/sync' },
    { prefix: 'field.hub.', to: '/sync' },
  ],
  status: FieldStatus,
  plugins:
    Platform.OS === 'android'
      ? [hubLinkNativeScreens, intentScannerScreens(scannerProfile)]
      : [hubLinkNativeScreens],
});
