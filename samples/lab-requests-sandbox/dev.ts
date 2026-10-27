import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run by `bun run dev:web` before the launch. On Linux with bubblewrap at `/usr/bin/bwrap`
 * (`BWRAP` to change it), it writes a site policy that binds the analysis sandbox to it. Elsewhere
 * it writes none, and the request screen shows why the sandbox cannot run. An explicit
 * `AGENT_NATIVE_SITE_POLICY` wins.
 */
const bwrap = process.env.BWRAP ?? '/usr/bin/bwrap';
if (process.platform === 'linux' && existsSync(bwrap)) {
  const policy = join(mkdtempSync(join(tmpdir(), 'lab-requests-sandbox-')), 'site-policy.json');
  writeFileSync(
    policy,
    JSON.stringify(
      {
        profile: 'desktop-local',
        audit: { mode: 'best-effort' },
        processes: { 'analysis-tools': { executable: bwrap } },
      },
      null,
      2,
    ),
  );
  process.env.AGENT_NATIVE_SITE_POLICY ??= policy;
  console.log(`Analysis sandbox: ${bwrap}`);
} else {
  console.log('Analysis sandbox: unavailable without Linux bubblewrap');
}
