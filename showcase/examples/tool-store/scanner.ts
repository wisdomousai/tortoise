import { defaultWedgeProfile, type ScanRoute } from '@tortoise/devices';
import { borrowerPattern } from './contracts/loan';
import { assetTagPattern } from './contracts/tool';

/**
 * The counter's scanner configuration. Browser-safe. The device feature stores profiles and routes
 * per station; Tool Store has one station, the store counter. Until an attendant saves a profile
 * or routes for it, the counter uses the ones below.
 */
export const counterStation = 'counter';

/** A keyboard-wedge scanner as it comes out of the box: US layout, Enter after each code. */
export const counterProfile = defaultWedgeProfile('counter-wedge', 'Counter scanner');

/**
 * Scan intents the counter handles. `tool` opens the tool's counter screen from any screen;
 * `badge` fills the borrower of the check-out form on that screen. Neither submits a command.
 */
// #region routes
export const counterIntents = { tool: 'tool', badge: 'badge' } as const;

/** The counter's routes, matched with the same patterns the tool and loan records enforce. */
export const counterRoutes: readonly ScanRoute[] = [
  { intent: counterIntents.tool, pattern: assetTagPattern.source },
  { intent: counterIntents.badge, pattern: borrowerPattern.source },
];
// #endregion routes
