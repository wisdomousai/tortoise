import { Archive, ClipboardList, FileText, Inbox, ListTree, ScanEye } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import { complianceScreens } from '@tortoise/compliance/plugin-screens';
import { deviceLinkScreens } from '@tortoise/device-link/plugin-screens';
import { workflowsScreens } from '@tortoise/workflows/plugin-screens';
import manifest from './manifest';
import { AssignmentsScreen } from './ui/assignments';
import { ReadingScreen, SurveyScreen } from './ui/assignments/survey';
import { CaptureScreen } from './ui/capture';
import { DocumentsScreen } from './ui/documents';
import { FilingScreen } from './ui/filing';
import { MyWorkScreen } from './ui/my-work';
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
    { path: 'assignments/$assignmentId', component: SurveyScreen },
    { path: 'review', component: ReviewScreen, compact: ReviewScreenCompact },
    { path: 'review/$captureId', component: CaptureScreen },
    { path: 'review/readings/$reportId', component: ReadingScreen },
    { path: 'filing', component: FilingScreen },
    { path: 'work', component: MyWorkScreen },
  ],
  navigation: [
    { to: '/structure', label: 'Structure', icon: ListTree },
    { to: '/documents', label: 'Documents', icon: FileText },
    { to: '/assignments', label: 'Assignments', icon: ClipboardList },
    { to: '/review', label: 'Review', icon: ScanEye },
    { to: '/filing', label: 'Filing', icon: Archive },
    { to: '/work', label: 'My work', icon: Inbox },
  ],
  capabilityScreens: [
    { prefix: 'structure.', to: '/structure' },
    { prefix: 'document.', to: '/documents' },
    { prefix: 'assignment.survey.report', to: '/work' },
    { prefix: 'assignment.extraction.report', to: '/work' },
    { prefix: 'assignment.inbound', to: '/work' },
    { prefix: 'assignment.complete', to: '/work' },
    { prefix: 'assignment.extraction.accept', to: '/review' },
    { prefix: 'assignment.extraction.', to: '/assignments' },
    { prefix: 'assignment.report.', to: '/review' },
    { prefix: 'assignment.survey.accept', to: '/review' },
    { prefix: 'assignment.model.', to: '/review' },
    { prefix: 'assignment.', to: '/assignments' },
    { prefix: 'approval.', to: '/structure' },
    { prefix: 'capture.', to: '/review' },
    { prefix: 'survey.', to: '/assignments' },
    { prefix: 'filing.', to: '/filing' },
    { prefix: 'eam.', to: '/filing' },
  ],
  status: SurveyStatus,
  plugins: [complianceScreens, deviceLinkScreens, workflowsScreens],
});
