import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';

test('an operator enrolls a site, assigns it a channel and sees it drift from that channel', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), 'fleet-e2e-'));
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' } }),
  );
  const host = await startService('@agent-native/fleet', join(directory, 'workspace'), {
    AGENT_NATIVE_SITE_POLICY: policy,
  });
  const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
  const api = (credential: string, path: string, body: unknown, type = 'application/json') =>
    fetch(host.origin + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': type },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  try {
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Health', level: 1 })).toBeVisible();
    await expect(page.getByText('No site needs a look.')).toBeVisible();

    // Enroll: the operator creates the code; the test plays the site that redeems it.
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Devices' })
      .click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Plant 4');
    await page.getByRole('button', { name: 'Create code' }).click();
    const code = (await page.getByLabel('Enrollment code').textContent())!.replaceAll('-', '');
    const enrolled = await fetch(`${host.origin}/api/v1/link/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const { token: site } = (await enrolled.json()) as { token: string };
    const report = await api(site, '/api/v1/commands/fleet.site.report', {
      input: {
        application: 'plant',
        instance: 'e2e',
        at: Date.now(),
        outbox: {
          pending: 3,
          held: 0,
          upstream: 0,
          targets: [{ target: 'erp', pending: 3, held: 0, upstream: 0 }],
        },
      },
      idempotencyKey: 'report-1',
    });
    expect(report.status).toBe(200);

    // A build pipeline publishes a release with the operator's credential.
    const bytes = 'plant binary';
    const blob = (await (
      await api(token, '/api/v1/blobs', bytes, 'application/octet-stream')
    ).json()) as {
      digest: string;
      size: number;
    };
    const manifest = {
      format: 1,
      application: 'plant',
      version: '2.0.0',
      platform: 'linux-x64',
      createdAt: new Date().toISOString(),
      storageSchema: 1,
      catalogDigest: 'a'.repeat(64),
      requirements: { network: [], devices: [], processes: [] },
      files: [
        {
          path: 'plant',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: blob.size,
        },
      ],
    };
    const published = await api(token, '/api/v1/commands/release.publish', {
      input: {
        release: {
          id: '2.0.0',
          version: '2.0.0',
          manifest,
          signature: { keyId: 'k', signature: 's' },
        },
        files: [blob],
      },
      idempotencyKey: 'publish-1',
    });
    expect(published.status).toBe(200);

    const sections = page.getByRole('navigation', { name: 'Sections' });
    await sections.getByRole('link', { name: 'Channels' }).click();
    await page.getByRole('textbox', { name: 'Id', exact: true }).fill('stable');
    await page.getByRole('textbox', { name: 'Release', exact: true }).fill('2.0.0');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'stable' })).toBeVisible();

    await sections.getByRole('link', { name: 'Sites' }).click();
    const row = page.getByRole('row').filter({ hasText: 'plant' });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole('textbox', { name: /^Label/ }).fill('Plant 4');
    await page.getByRole('textbox', { name: /^Channel/ }).fill('stable');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('definition').filter({ hasText: /^stable$/ })).toBeVisible();

    await sections.getByRole('link', { name: 'Health' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Release drift' })).toBeVisible();
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
