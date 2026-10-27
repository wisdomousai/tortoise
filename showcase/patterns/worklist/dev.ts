import { resolve } from 'node:path';

/**
 * Run by `bun run dev:web` before the launch. It binds the `lab-peer` destination to the
 * assignments pattern on 127.0.0.1:4362, which runs from its own directory. An explicit
 * `AGENT_NATIVE_SITE_POLICY` wins.
 */
process.env.AGENT_NATIVE_SITE_POLICY ??= resolve(import.meta.dir, 'site-policy.dev.json');
