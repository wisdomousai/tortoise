import { z } from 'zod';
import type { ScanEvent } from './decode';

/**
 * Deterministic mapping from scans to intents. Device configuration names, for example, that
 * `^WO\d{7}$` is a work order and GS1 AI 00 is a pallet; the station then opens the order or
 * confirms the pallet without a model turn. Routes are plain JSON so they are stored per station
 * through the device configuration module and reviewed like any other configuration.
 */
export const scanRouteSchema = z.strictObject({
  /** Intent name the application handles, such as `order` or `material`. */
  intent: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9.-]*$/),
  /** Match a GS1 element by AI; the element value becomes the routed value. */
  gs1Ai: z
    .string()
    .regex(/^\d{2,4}$/)
    .optional(),
  /** Match the payload with a regular expression; group 1, when present, is the value. */
  pattern: z.string().min(1).max(200).optional(),
  /** Restrict to symbologies as reported by the scanner or camera. */
  symbologies: z.array(z.string().max(32)).max(16).optional(),
});
export type ScanRoute = z.infer<typeof scanRouteSchema>;

export interface RoutedScan {
  readonly intent: string;
  readonly value: string;
  readonly event: ScanEvent;
}

/** Compile routes once; invalid patterns fail here, at configuration time, not on a scan. */
export function createScanRouter(routes: readonly ScanRoute[]) {
  const compiled = routes.map((route) => {
    if (!route.gs1Ai && !route.pattern)
      throw new Error(`Scan route ${route.intent} needs gs1Ai or pattern`);
    return { route, pattern: route.pattern ? new RegExp(route.pattern, 'u') : undefined };
  });
  return {
    /** First matching route wins, so put specific routes before general ones. */
    route(event: ScanEvent): RoutedScan | undefined {
      for (const { route, pattern } of compiled) {
        if (route.symbologies && !route.symbologies.includes(event.symbology ?? 'unknown'))
          continue;
        if (route.gs1Ai) {
          const value = event.gs1?.valid ? event.gs1.values[route.gs1Ai] : undefined;
          if (value === undefined) continue;
          if (pattern && !pattern.test(value)) continue;
          return { intent: route.intent, value, event };
        }
        const match = pattern!.exec(event.data);
        if (match) return { intent: route.intent, value: match[1] ?? match[0], event };
      }
      return undefined;
    },
  };
}
