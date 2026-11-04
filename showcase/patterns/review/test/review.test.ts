import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@tortoise/contracts';
import { openEmbeddedInstance } from '@tortoise/host';
import { directDriver, runScenarios, type BehavioralScenario } from '@tortoise/testing';
import { featureConformance } from '@tortoise/testing/features';
import { createTestRequestsReviewApplication } from '../application';
import { reviewFeature, type ReviewAccess } from '../features/review/feature';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const lena = { workspaceId: 'local', principalId: 'lena' };
const mia = { workspaceId: 'local', principalId: 'mia' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

describe('review feature conformance', () => {
  const review = {
    id: 'v1',
    subject: 'test-request:r1',
    revision: 1,
    verdict: 'approved' as const,
    comment: '',
    reviewer: 'reviewer',
    reviewedAt: 0,
  };
  const allowAll: ReviewAccess = { allows: () => true, authorOf: () => 'author' };
  const denyAll: ReviewAccess = { allows: () => false, authorOf: () => undefined };
  for (const check of featureConformance(reviewFeature(), {
    allowAll,
    denyAll,
    sampleSlice: { reviews: { v1: review } },
    requests: [
      { operation: 'review.list', input: { subject: 'test-request:r1' } },
      {
        operation: 'review.sign',
        input: { subject: 'test-request:r2', verdict: 'approved', comment: '' },
      },
    ],
    events: [
      {
        cursor: 1,
        resource: 'review:v1',
        revision: 1,
        type: 'changed',
        operation: 'review.sign',
      },
    ],
    personOnly: ['review.sign'],
  }))
    test(check.name, check.run);
});

async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'pattern-review-'));
  let id = 0;
  const instance = await openEmbeddedInstance(
    createTestRequestsReviewApplication({
      members: { lena: 'technician', mia: 'technician', viewer: 'viewer' },
      services: { newId: () => `r${++id}`, now: () => 1_000 + id },
    }),
    { workspacePath: join(directory, 'workspace') },
  );
  cleanup.push(async () => {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  return instance;
}

const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => {
      const { code, message } = errorEnvelope(error);
      return `${code} ${message}`;
    },
  );
const sign = (verdict: 'approved' | 'rejected', revision: number, comment = '') => ({
  operation: 'review.sign',
  input: { subject: 'test-request:r1', verdict, comment },
  expectedRevisions: { 'test-request:r1': revision },
});

const scenarios: BehavioralScenario[] = [
  {
    name: 'a second technician approves a request at the revision they read',
    async run(driver) {
      await driver.command(
        {
          operation: 'test-request.submit',
          input: {
            sample: 'OS-24-0417',
            transformer: 'TR-40517',
            description: 'Gas alarm after a load increase',
            method: 'IEC 60567 dissolved gas analysis',
          },
        },
        localUser,
      );
      const signed = await driver.command(sign('approved', 1, 'Method fits the gas alarm'), lena);
      expect(signed.result).toMatchObject({
        id: 'r2',
        subject: 'test-request:r1',
        revision: 1,
        verdict: 'approved',
        reviewer: 'lena',
      });
      const listed = await driver.query(
        { operation: 'review.list', input: { subject: 'test-request:r1' } },
        viewer,
      );
      expect((listed.data as { items: { reviewer: string }[] }).items).toMatchObject([
        { reviewer: 'lena' },
      ]);
    },
  },
  {
    name: 'the requester cannot sign their own request, and a reviewer signs a revision once',
    async run(driver) {
      expect(await refused(driver.command(sign('approved', 1), localUser))).toBe(
        'FORBIDDEN SELF_REVIEW',
      );
      expect(await refused(driver.command(sign('rejected', 1), lena))).toStartWith('CONFLICT');
    },
  },
  {
    name: 'a signature on a changed revision conflicts, and the changed request is signed again',
    async run(driver) {
      await driver.command(
        {
          operation: 'test-request.update',
          input: { id: 'r1', method: 'IEC 60156 breakdown voltage' },
          expectedRevisions: { 'test-request:r1': 1 },
        },
        localUser,
      );
      expect(await refused(driver.command(sign('approved', 1), mia))).toStartWith('CONFLICT');
      const signed = await driver.command(
        sign('rejected', 2, 'Breakdown voltage needs a sealed glass bottle'),
        mia,
      );
      expect(signed.result).toMatchObject({ revision: 2, verdict: 'rejected', reviewer: 'mia' });
      // Lena signed revision 1; the change lets her sign revision 2.
      const again = await driver.command(sign('approved', 2), lena);
      expect(again.result).toMatchObject({ revision: 2, reviewer: 'lena' });
    },
  },
  {
    name: 'viewers read signatures but cannot sign, and non-members reach neither',
    async run(driver) {
      expect(await refused(driver.command(sign('approved', 2), viewer))).toStartWith('FORBIDDEN');
      expect(
        await refused(
          driver.command(
            {
              operation: 'review.sign',
              input: { subject: 'test-request:missing', verdict: 'approved' },
            },
            mia,
          ),
        ),
      ).toStartWith('FORBIDDEN');
      expect(
        await refused(
          driver.query(
            { operation: 'review.list', input: { subject: 'test-request:r1' } },
            stranger,
          ),
        ),
      ).toStartWith('FORBIDDEN');
    },
  },
];

test('the review scenarios hold on the embedded instance', async () => {
  const instance = await open();
  await runScenarios(scenarios, directDriver(instance.application));
});
