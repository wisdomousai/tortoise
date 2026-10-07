import { FakeQualitySystem } from '../../../examples/quality-inspection/fake-sor';

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
