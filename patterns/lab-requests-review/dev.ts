/**
 * Development launch: before the host opens the workspace, add `lena` as a second technician and
 * submit one test request as her through the embedded instance, so the local owner has a request
 * someone else wrote to review. The submission has a fixed idempotency key, so a relaunch adds
 * nothing. A workspace created before this script has no `lena`; delete `.workspace` to reseed.
 */
import { join } from 'node:path';
import { openEmbeddedInstance } from '@agent-native/host';
import { createLabRequestsReviewApplication } from './application';

const workspacePath = process.env.WORKSPACE_PATH ?? join(import.meta.dir, '.workspace');
const instance = await openEmbeddedInstance(
  createLabRequestsReviewApplication({ members: { lena: 'technician' } }),
  { workspacePath },
);
try {
  await instance.application.invokeRaw(
    {
      operation: 'test-request.submit',
      input: {
        specimen: 'B-1042-03',
        description: 'Tensile strength of the weld coupon',
        method: 'ASTM E8 tensile test',
      },
      idempotencyKey: 'dev-seed-lena-1',
    },
    { workspaceId: 'local', principalId: 'lena' },
  );
} catch (error) {
  console.warn(
    `No review request seeded (${(error as Error).message}); delete .workspace to reseed.`,
  );
} finally {
  await instance.close();
}
