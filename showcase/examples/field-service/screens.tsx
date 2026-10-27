import { Inbox } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import { webhookScreens } from '@agent-native/webhook/plugin-screens';
import manifest from './manifest';
import { WorkOrderList, WorkOrderScreen, WorkOrdersScreen } from './ui/work-orders';
import { PendingApprovalCount, ApprovalsScreen } from './ui/approvals';
import { workOrderPath, taskWorkOrderPath } from './ui/work-orders/shared';

/**
 * The field-service screens the web frame renders. The sidebar lists the work orders; each opens at
 * its own route, so a work order link survives a reload and the agent's UI session can select one.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/work-orders',
  routes: [
    { path: 'work-orders', component: WorkOrdersScreen },
    { path: 'work-orders/$workOrderId', component: WorkOrderScreen },
    { path: 'approvals', component: ApprovalsScreen },
  ],
  // The work order list in the sidebar is the main navigation; approval requests and plugin sections follow.
  navigation: [{ to: '/approvals', label: 'Approvals', icon: Inbox, badge: PendingApprovalCount }],
  capabilityScreens: [
    { prefix: 'work-order.', to: '/work-orders' },
    { prefix: 'task.', to: '/work-orders' },
    { prefix: 'approval.', to: '/approvals' },
  ],
  // Where a work order or task resource opens, for OS links and agent runs alike.
  resources: { 'work-order': workOrderPath, task: taskWorkOrderPath },
  sidebar: WorkOrderList,
  plugins: [complianceScreens, webhookScreens],
});
