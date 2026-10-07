import { FakeQualitySystem } from '../../../examples/quality-inspection/fake-sor';
import type { StationBridgeConfig } from './station-bridge';

/**
 * Demo only: the reference runs against the deterministic in-memory quality system, so it needs no
 * enterprise credentials. `DEMO_QUALITY_LOCKED_LOTS` (comma-separated lot numbers) simulates
 * another SoR user holding a lock, so forwarded records for those lots are rejected.
 * `DEMO_QUALITY_UNAVAILABLE=1` makes every delivery fail transiently. A deploying application
 * replaces this with its real adapter; the framework never reads these variables.
 */
export function demoSystemOfRecord(env: Record<string, string | undefined> = process.env) {
  const systemOfRecord = new FakeQualitySystem();
  for (const lot of (env.DEMO_QUALITY_LOCKED_LOTS ?? '').split(',').filter(Boolean))
    systemOfRecord.lock(lot.trim());
  if (env.DEMO_QUALITY_UNAVAILABLE === '1') systemOfRecord.faults = { unavailable: true };
  return systemOfRecord;
}

/**
 * Demo only: bridge the simulated filler HMI when `STATION_HMI_URL` names it (start it with
 * `bun run dev:hmi`). Counters come from `STATION_VISION_BASE_URL` + `STATION_VISION_MODEL` (a
 * local vision model), `STATION_PERCEPTION_WORKER` (JSON array command), or, with
 * `STATION_SIMULATOR=1` (the HMI is the simulator), from its ground truth; the simulator also
 * reports local input then. Explicit configuration only; a
 * deploying application passes its own station list, and the framework never reads these.
 */
export function demoStations(
  env: Record<string, string | undefined> = process.env,
): StationBridgeConfig[] {
  const hmiUrl = env.STATION_HMI_URL;
  if (!hmiUrl) return [];
  const counters: StationBridgeConfig['counters'] =
    env.STATION_VISION_BASE_URL && env.STATION_VISION_MODEL
      ? {
          kind: 'vision',
          baseUrl: env.STATION_VISION_BASE_URL,
          model: env.STATION_VISION_MODEL,
          allowedHosts: (env.STATION_VISION_ALLOWED_HOSTS ?? '').split(',').filter(Boolean),
          reads: Number(env.STATION_VISION_READS ?? 3),
        }
      : env.STATION_PERCEPTION_WORKER
        ? {
            kind: 'worker',
            command: JSON.parse(env.STATION_PERCEPTION_WORKER) as [string, ...string[]],
          }
        : env.STATION_SIMULATOR === '1'
          ? { kind: 'simulator' }
          : { kind: 'none' };
  return [
    {
      station: env.STATION_ID ?? 'line-1',
      hmiUrl,
      ...(env.STATION_PROFILE ? { profilePath: env.STATION_PROFILE } : {}),
      localInputProbe: env.STATION_SIMULATOR === '1',
      counters,
      observeMs: Number(env.STATION_OBSERVE_MS ?? 1_000),
    },
  ];
}
