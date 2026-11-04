import { resolve } from 'node:path';
import { startCollector } from '@tortoise/telemetry/testing';

const PORT = 4318;
const inUse = (error: unknown) => (error as { code?: string }).code === 'EADDRINUSE';

/**
 * Whether a listener already holds the port on every interface. macOS lets a loopback bind
 * succeed next to such a listener and take its loopback traffic, so a bind on `0.0.0.0` is tried
 * and released at once before the stand-in binds `127.0.0.1`.
 */
function heldOnEveryInterface() {
  try {
    Bun.listen({ hostname: '0.0.0.0', port: PORT, socket: { data() {} } }).stop(true);
    return false;
  } catch (error) {
    if (inUse(error)) return true;
    throw error;
  }
}

/** The collector stand-in, or nothing when an OpenTelemetry Collector already listens. */
function startDevCollector() {
  if (heldOnEveryInterface()) return undefined;
  try {
    return startCollector({ port: PORT });
  } catch (error) {
    if (inUse(error)) return undefined;
    throw error;
  }
}

/**
 * Development only (`bun run dev` here): bind the telemetry destination to `127.0.0.1:4318`
 * through `deployment-policy.dev.json`. A collector that already listens on 4318 receives the exports;
 * otherwise the stand-in from `@tortoise/telemetry/testing` accepts them in this process. An
 * explicit `TORTOISE_DEPLOYMENT_POLICY` wins, and then no stand-in starts.
 */
if (!process.env.TORTOISE_DEPLOYMENT_POLICY) {
  process.env.TORTOISE_DEPLOYMENT_POLICY = resolve(import.meta.dir, 'deployment-policy.dev.json');
  const collector = startDevCollector();
  console.log(
    collector
      ? `Telemetry: collector stand-in on ${collector.url}`
      : `Telemetry: exporting to the collector already on port ${PORT}`,
  );
}
