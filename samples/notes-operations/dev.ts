import { resolve } from 'node:path';

/**
 * Development only (`bun run dev` here): bind the telemetry destination to an OpenTelemetry
 * Collector on `127.0.0.1:4318`. Without a collector there, exports fail and the plugin reports
 * the error in its status; commands are unaffected. An explicit `AGENT_NATIVE_SITE_POLICY` wins.
 */
process.env.AGENT_NATIVE_SITE_POLICY ??= resolve(import.meta.dir, 'site-policy.dev.json');
