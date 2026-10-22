import { Archive, ClipboardList, FileText, ListTree, ScanEye } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import { deviceLinkScreens } from '@agent-native/device-link/plugin-screens';
import manifest from './manifest';
import { AssignmentsScreen } from './ui/assignments';
import { CaptureScreen } from './ui/capture';
import { DocumentsScreen } from './ui/documents';
import { FilingScreen } from './ui/filing';
import { NodeScreen } from './ui/node';
import { ReviewScreen, ReviewScreenCompact } from './ui/review';
import { StructureScreen } from './ui/structure';
import { SurveyStatus } from './ui/survey-status';

/** The hub: prepare the structure, send field work, review what comes back, file it. */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/structure',
  routes: [
    { path: 'structure', component: StructureScreen },
    { path: 'structure/$nodeId', component: NodeScreen },
    { path: 'documents', component: DocumentsScreen },
    { path: 'assignments', component: AssignmentsScreen },
    { path: 'review', component: ReviewScreen, compact: ReviewScreenCompact },
    { path: 'review/$captureId', component: CaptureScreen },
    { path: 'filing', component: FilingScreen },
  ],
  navigation: [
    { to: '/structure', label: 'Structure', icon: ListTree },
    { to: '/documents', label: 'Documents', icon: FileText },
    { to: '/assignments', label: 'Assignments', icon: ClipboardList },
    { to: '/review', label: 'Review', icon: ScanEye },
    { to: '/filing', label: 'Filing', icon: Archive },
  ],
  capabilityScreens: [
    { prefix: 'structure.', to: '/structure' },
    { prefix: 'document.', to: '/documents' },
    { prefix: 'assignment.', to: '/assignments' },
    { prefix: 'capture.', to: '/review' },
    { prefix: 'extraction.', to: '/review' },
    { prefix: 'filing.', to: '/filing' },
    { prefix: 'eam.', to: '/filing' },
  ],
  status: SurveyStatus,
  plugins: [complianceScreens, deviceLinkScreens],
});
