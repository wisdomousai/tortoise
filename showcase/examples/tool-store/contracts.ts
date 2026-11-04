import { defineModule } from '@tortoise/contracts';
import { toolOperations } from './contracts/tool';
import { loanOperations } from './contracts/loan';
import { toolCheckOut } from './contracts/tool-check-out';
import { toolReturn } from './contracts/tool-return';
import { loanOverdue } from './contracts/loan-overdue';
import { eamTarget } from './contracts/eam-target';
import { toolRetire } from './contracts/tool-retire';
import { repairTriageAgent } from './contracts/repair-triage-agent';
import { toolMarkFound, toolMarkMissing } from './contracts/tool-missing';
import { assigneeList } from './contracts/assignees';
export { assignmentOperations } from './contracts/assignments';
import { calibrationPull, toolCalibrationDue } from './contracts/tool-calibration-due';
// scaffold:imports

/** Every operation of the Tool Store module, by key. Browser-safe. */
export const operations = {
  ...toolOperations,
  ...loanOperations,
  toolCheckOut,
  toolReturn,
  loanOverdue,
  eamComplete: eamTarget.complete,
  eamSync: eamTarget.sync,
  eamStatus: eamTarget.status,
  toolRetire,
  toolMarkMissing,
  toolMarkFound,
  assigneeList,
  toolCalibrationDue,
  // scaffold:operations
} as const;

export const toolStoreModule = defineModule({
  id: 'tool-store',
  capabilities: Object.values(operations),
  requires: [
    'approval',
    // scaffold:requires
  ],
  agents: [
    repairTriageAgent,
    // scaffold:agents
  ],
  workflows: [calibrationPull],
  requirements: {
    network: [
      {
        id: 'eam-api',
        purpose:
          'Send repair orders for damaged returns to the plant EAM and pull the master data of the store tools.',
        direction: 'egress',
        scope: 'local',
        protocol: 'https',
        targets: [eamTarget.target],
        dataClasses: ['tool', 'repair-order'],
        availability: 'required',
        offline: 'queue',
      },
      // scaffold:network
    ],
  },
});
