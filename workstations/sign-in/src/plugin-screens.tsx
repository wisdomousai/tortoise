import { IdCard, ScanLine } from 'lucide-react';
import { definePluginScreens } from '@agent-native/frame/plugin-screens';
import { BadgesScreen } from './ui/badges';
import { TerminalScreen, type TerminalOptions } from './ui/terminal';

export {
  useOperatorSession,
  type OperatorSession,
  type OperatorSessionRecord,
} from './ui/operator-session';
export type { TerminalOptions } from './ui/terminal';

/**
 * The terminal screen at `/terminal`, where operators sign in with badge and PIN and then work as
 * themselves on `options.work`, and the badge screen at `/badges`, where the admin enrolls and
 * revokes badges.
 */
export function stationSignInScreens(options: TerminalOptions) {
  return definePluginScreens({
    id: 'station-sign-in',
    routes: [
      { path: 'terminal', component: () => <TerminalScreen {...options} /> },
      { path: 'badges', component: BadgesScreen },
    ],
    navigation: [
      { to: '/terminal', label: 'Terminal', icon: ScanLine },
      { to: '/badges', label: 'Badges', icon: IdCard },
    ],
    capabilityScreens: [{ prefix: 'station.', to: '/badges' }],
  });
}
