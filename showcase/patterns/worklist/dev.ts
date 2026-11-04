import { resolve } from 'node:path';

/**
 * Run by `bun run dev:web` before the launch. It binds the `lab-peer` destination to the
 * assignments pattern on 127.0.0.1:4362, which runs from its own directory. An explicit
 * `TORTOISE_DEPLOYMENT_POLICY` wins.
 */
process.env.TORTOISE_DEPLOYMENT_POLICY ??= resolve(import.meta.dir, 'deployment-policy.dev.json');
