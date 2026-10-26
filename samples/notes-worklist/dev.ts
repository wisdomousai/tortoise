import { resolve } from 'node:path';

/**
 * Run by `bun run dev:web` before the launch. It binds the `reviews-peer` destination to
 * notes-assignments on 127.0.0.1:4355, which runs from its own directory. An explicit
 * `AGENT_NATIVE_SITE_POLICY` wins.
 */
process.env.AGENT_NATIVE_SITE_POLICY ??= resolve(import.meta.dir, 'site-policy.dev.json');
