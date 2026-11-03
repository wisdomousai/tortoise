import { DEFAULT_PAGE, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { DEFAULT_CALIBRATION_DAYS } from '../contracts/tool-calibration-due';
import type { AppState } from '../domain';
import { handler, now, type Services } from './context';

const DAY_MS = 24 * 60 * 60 * 1000;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tools not retired whose calibration date is on or before today plus `days`, soonest first.
 * Today is the UTC date of the instance clock: the instance keeps no site time zone, and
 * `calibrationDue` is a plain date. Every member sees every tool (the policy's caller gate keeps
 * everyone else out), so the filters run on all rows, then the count, then the page. Dates of the
 * form YYYY-MM-DD compare as text in calendar order.
 */
export function toolCalibrationDueHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.toolCalibrationDue, (input, ctx) => {
      const days = input.days ?? DEFAULT_CALIBRATION_DAYS;
      const through = new Date(now(ctx) + days * DAY_MS).toISOString().slice(0, 10);
      const rows = Object.values(ctx.state.tools)
        .filter((tool) => tool.status !== 'retired')
        .filter((tool) => tool.calibrationDue !== undefined && tool.calibrationDue <= through)
        // The asset tag is unique, so tools due on the same day keep one order across pages.
        .sort(
          (a, b) =>
            compare(a.calibrationDue!, b.calibrationDue!) || compare(a.assetTag, b.assetTag),
        );
      const offset = input.offset ?? 0;
      const items = rows.slice(offset, offset + (input.limit ?? DEFAULT_PAGE));
      return { items, total: rows.length, through };
    }),
  ];
}
