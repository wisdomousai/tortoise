import { ClipboardCheck, ClipboardList, Factory, List, ListChecks } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import { complianceScreens } from '@tortoise/compliance/plugin-screens';
import { stationSignInScreens } from '@tortoise/workstation-sign-in/plugin-screens';
import manifest from './manifest';
import { borrowerPattern } from './contracts/loan';
import { counterStation } from './scanner';
import { toolRoutes } from './ui/tool';
import { loanRoutes } from './ui/loan';
import { handoverScreens } from './features/handover/screens';
import { CounterScanner, terminalPath } from './ui/counter-scanner';
import { CounterTerminal } from './ui/counter';
import { deviceScreens } from './ui/scanner-setup';
import { EamScreen } from './ui/eam-target';
import { ApprovalsScreen } from './ui/approvals';
import { cycleCountRoutes } from './ui/cycle-count-assignments';
// scaffold:imports

/** An attendant left alone at the terminal this long is signed out. */
const COUNTER_IDLE_MS = 5 * 60_000;

/**
 * The Tool Store screens. The counter and the overdue list are behind attendant sign-in at the
 * counter terminal (`/terminal`); the local user enrolls badges on `/badges`.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/tools',
  routes: [
    ...toolRoutes,
    ...loanRoutes,
    { path: 'eam', component: EamScreen },
    { path: 'approvals', component: ApprovalsScreen },
    ...cycleCountRoutes,
    // scaffold:routes
  ],
  navigation: [
    { to: '/tools', label: 'Tools', icon: List },
    { to: '/loans', label: 'Loans', icon: List },
    { to: '/eam', label: 'EAM', icon: Factory },
    { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
    { to: '/assignments/cycle-counts', label: 'Cycle counts', icon: ClipboardList },
    { to: '/assignments/my-cycle-counts', label: 'My cycle counts', icon: ListChecks },
    // scaffold:navigation
  ],
  capabilityScreens: [
    { prefix: 'tool.', to: '/tools' },
    { prefix: 'tool.check-out', to: terminalPath },
    { prefix: 'tool.return', to: terminalPath },
    { prefix: 'tool.update', to: terminalPath },
    { prefix: 'loan.overdue', to: terminalPath },
    { prefix: 'loan.', to: '/loans' },
    { prefix: 'eam.', to: '/eam' },
    // The reconciliation feature's held deliveries are all EAM repair orders.
    { prefix: 'reconciliation.', to: '/eam' },
    // An attendant retires a tool by approving the repair triage agent's request.
    { prefix: 'tool.retire', to: '/approvals' },
    { prefix: 'approval.', to: '/approvals' },
    // Accepting a cycle count report sets tools missing or available again.
    { prefix: 'tool.mark-', to: '/assignments/cycle-counts' },
    { prefix: 'assignment.cycle-count.', to: '/assignments/cycle-counts' },
    { prefix: 'assignment.cycle-count.report', to: '/assignments/my-cycle-counts' },
    { prefix: 'assignment.', to: '/assignments/cycle-counts' },
    { prefix: 'assignment.inbound', to: '/assignments/my-cycle-counts' },
    { prefix: 'assignment.complete', to: '/assignments/my-cycle-counts' },
    { prefix: 'assignee.', to: '/assignments/cycle-counts' },
    // scaffold:capability-screens
  ],
  // The counter's scanner, docked beside every screen so a tool's tag opens it at the terminal.
  aside: CounterScanner,
  features: [
    handoverScreens,
    deviceScreens,
    // scaffold:features
  ],
  plugins: [
    complianceScreens,
    // The attendant's badge carries the employee number, E and six digits, as a borrower's does.
    stationSignInScreens({
      terminal: counterStation,
      work: CounterTerminal,
      idleMs: COUNTER_IDLE_MS,
      badgePattern: borrowerPattern.source,
    }),
  ],
});
