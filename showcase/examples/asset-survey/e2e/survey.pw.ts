import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../../tests/e2e/service';
import { samplePhoto } from '../fixtures/nameplates';

type Host = Awaited<ReturnType<typeof startService>>;

/** A field phone without the app: pair through the enrollment route, then use the hub API. */
async function pairPhone(host: Host) {
  const { token } = JSON.parse(await readFile(host.connectionFile, 'utf8')) as { token: string };
  const localUser = (operation: string, input: unknown) =>
    fetch(`${host.origin}/api/v1/commands/${operation}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input, idempotencyKey: crypto.randomUUID() }),
    }).then((response) => response.json() as Promise<{ result: Record<string, string> }>);
  const { result } = await localUser('link.enrollment.create', {
    label: 'Field phone',
    kind: 'field-sync',
  });
  const redeemed = (await (
    await fetch(`${host.origin}/api/v1/link/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: result.code }),
    })
  ).json()) as { token: string };
  const device = (path: string, body: BodyInit, type = 'application/json') =>
    fetch(host.origin + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${redeemed.token}`, 'content-type': type },
      body,
    });
  return {
    async capture(id: string, assignmentId: string, nodeId: string, jpeg: Uint8Array) {
      const upload = await device('/api/v1/blobs', jpeg as Uint8Array<ArrayBuffer>, 'image/jpeg');
      const photo = await upload.json();
      const input = {
        id,
        assignmentId,
        subject: nodeId,
        body: { kind: 'nameplate', photos: [photo], codes: [], note: '', takenAt: Date.now() },
      };
      expect(
        (
          await device(
            '/api/v1/commands/assignment.survey.report',
            JSON.stringify({ input, idempotencyKey: id }),
          )
        ).ok,
      ).toBe(true);
    },
    async inbound() {
      const response = await device(
        '/api/v1/queries/assignment.inbound',
        JSON.stringify({ input: {} }),
      );
      return (
        (await response.json()) as {
          data: {
            items: { id: string; instructions: { nodes: { id: string; designation: string }[] } }[];
          };
        }
      ).data.items;
    },
  };
}

async function addNode(page: Page, parent: string, designation: string, name: string) {
  await page.getByLabel('Parent', { exact: true }).selectOption({ label: parent });
  await page.getByLabel('Designation').fill(designation);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Add node' }).click();
  await expect(
    page.getByRole('list', { name: 'Structure' }).getByRole('button', { name: designation }),
  ).toBeVisible();
}

test('prepare, send to a phone, review what the model read and file it into the EAM', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-survey-'));
  const host = await startService('@tortoise/asset-survey', workspace);
  try {
    await page.goto(host.launchUrl);
    await expect(page.getByRole('heading', { name: 'Structure' })).toBeVisible();
    await addNode(page, 'No parent (root)', '=G1', 'Generator 1');
    await addNode(page, '=G1 Generator 1', '=G1-QM1', 'Cooling water valve');
    // The scheme's rules are checked by the hub and shown where the designation was typed.
    await page.getByLabel('Designation').fill('G1Q3');
    await page.getByLabel('Name').fill('Bad');
    await page.getByRole('button', { name: 'Add node' }).click();
    await expect(page.getByRole('form', { name: 'Add node' }).getByRole('alert')).toContainText(
      'IEC 81346',
    );

    const phone = await pairPhone(host);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await nav.getByRole('link', { name: 'Assignments' }).click();
    await page.getByRole('button', { name: 'New survey' }).click();
    const form = page.getByRole('form', { name: 'New Survey' });
    await form.getByLabel('Title').fill('Nameplates of =G1');
    await form.getByLabel('Assignee').selectOption({ label: 'Field phone' });
    await form.getByText('=G1', { exact: true }).click();
    await form.getByRole('button', { name: 'Create and send' }).click();
    const survey = page.getByRole('listitem', { name: 'Nameplates of =G1' });
    await expect(survey.getByText('sent', { exact: true })).toBeVisible();

    const [assignment] = await phone.inbound();
    const valve = assignment!.instructions.nodes.find((node) => node.designation === '=G1-QM1')!;
    // The valve's plate is rusted across the serial, so the reading doubts it.
    await phone.capture('cap-1', assignment!.id, valve.id, await samplePhoto('valve'));
    await expect(survey.getByText('1 to review')).toBeVisible();

    await nav.getByRole('link', { name: 'Review' }).click();
    await page.getByRole('list', { name: 'Captures' }).getByRole('link').first().click();
    await page.getByRole('button', { name: 'Read with the model' }).click();
    const proposal = page.getByRole('form', { name: 'Proposal' });
    await expect(proposal).toBeVisible({ timeout: 10_000 });
    await expect(proposal.getByText('1 value to check against the photo.')).toBeVisible();
    const flagged = proposal.locator('input[aria-invalid="true"]');
    await expect(flagged).toHaveCount(1);
    await expect(flagged).toHaveValue('BF-0093-221');
    await proposal.getByRole('textbox', { name: 'serial' }).fill('BF-0093-224');
    await proposal.getByRole('button', { name: 'Accept onto the node' }).click();
    await expect(page.getByText(/Accepted by/)).toBeVisible();

    await page.getByRole('link', { name: 'Cooling water valve' }).click();
    await expect(page.getByText('BF-0093-224')).toBeVisible();
    await expect(page.getByText('corrected by reviewer')).toBeVisible();
    await page.getByRole('button', { name: 'Create an asset' }).click();
    await expect(
      page.getByRole('list', { name: 'Filings' }).getByText(/Filed as EAM-2001/),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('EAM EAM-2001')).toBeVisible();
    // No deployment policy binds the export process here, so the export waits.
    await page.getByRole('button', { name: 'Export to the export directory' }).click();
    await expect(
      page.getByRole('list', { name: 'Filings' }).getByText('Waiting for the export'),
    ).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('the review queue is one column of large rows at tablet width', async ({ page }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-survey-'));
  const host = await startService('@tortoise/asset-survey', workspace);
  try {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(host.launchUrl);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('dialog', { name: 'Navigation' })
      .getByRole('link', { name: 'Review' })
      .click();
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(page.getByText('Captures from the field.')).toBeHidden();
    await expect(page.getByText('Nothing here.')).toBeVisible();
  } finally {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
