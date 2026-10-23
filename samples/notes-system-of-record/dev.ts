import { resolve } from 'node:path';
import { FakePublisher } from './fake-publisher';

/**
 * Run by `bun run dev:web` before the launch. It starts the fake publisher on 127.0.0.1:4361 and
 * binds the publisher destination to it. Its `/control/*` routes act as the publisher's staff; the README
 * lists them. An explicit `AGENT_NATIVE_SITE_POLICY` wins.
 */
const url = new FakePublisher().start(4361);
process.env.AGENT_NATIVE_SITE_POLICY ??= resolve(import.meta.dir, 'site-policy.dev.json');
console.log(`Fake publisher: ${url} (controls under /control/)`);
