import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run by `bun run dev:web` before the launch. It writes a site policy that binds the `fleet`
 * destination to the fleet example on 127.0.0.1:4340 (`LAB_FLEET_URL` to change it) and the
 * `fleet-releases` folder to a new directory. Both go in a temporary directory, because a folder
 * binding is an absolute path. An explicit `AGENT_NATIVE_SITE_POLICY` wins.
 */
const directory = mkdtempSync(join(tmpdir(), 'test-requests-site-'));
const releases = join(directory, 'fleet-releases');
mkdirSync(releases);
const fleet = process.env.LAB_FLEET_URL ?? 'http://127.0.0.1:4340';
const policy = join(directory, 'site-policy.json');
writeFileSync(
  policy,
  JSON.stringify(
    {
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      // Release files, such as the compiled binary, are larger than the guard's 32 MiB default.
      destinations: { fleet: { url: fleet, maxResponseBytes: 268_435_456 } },
      folders: { 'fleet-releases': { path: releases } },
    },
    null,
    2,
  ),
);
process.env.AGENT_NATIVE_SITE_POLICY ??= policy;
console.log(`Fleet: ${fleet}; staged releases: ${releases}`);
