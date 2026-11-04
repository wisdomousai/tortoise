import { resolve } from 'node:path';
import { FakeLims } from './fake-lims';

/**
 * Run by `bun run dev:web` before the launch. It starts the fake LIMS on 127.0.0.1:4371 and binds
 * the LIMS destination to it. Its `/control/*` routes act as the LIMS's staff; the README lists
 * them. An explicit `TORTOISE_DEPLOYMENT_POLICY` wins.
 */
const url = new FakeLims().start(4371);
process.env.TORTOISE_DEPLOYMENT_POLICY ??= resolve(import.meta.dir, 'deployment-policy.dev.json');
console.log(`Fake LIMS: ${url} (controls under /control/)`);
