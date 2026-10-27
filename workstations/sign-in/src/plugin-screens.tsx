import { IdCard, ScanLine } from 'lucide-react';
import { definePluginScreens } from '@agent-native/frame/plugin-screens';
import { BadgesScreen } from './ui/badges';
import { SeatScreen, type SeatOptions } from './ui/seat';

export {
  useOperatorSession,
  type OperatorSession,
  type OperatorSessionRecord,
} from './ui/operator-session';
export type { SeatOptions } from './ui/seat';

/**
 * The seat screen at `/seat`, where operators sign in with badge and PIN and then work as
 * themselves on `options.work`, and the badge screen at `/badges`, where the admin enrolls and
 * revokes badges.
 */
export function stationSignInScreens(options: SeatOptions) {
  return definePluginScreens({
    id: 'station-sign-in',
    routes: [
      { path: 'seat', component: () => <SeatScreen {...options} /> },
      { path: 'badges', component: BadgesScreen },
    ],
    navigation: [
      { to: '/seat', label: 'Seat', icon: ScanLine },
      { to: '/badges', label: 'Badges', icon: IdCard },
    ],
    capabilityScreens: [{ prefix: 'station.', to: '/badges' }],
  });
}
