import { ApplicationError } from '@agent-native/contracts';
import { jsonResponse, readJsonBody } from '@agent-native/adapters/http';
import type { HostedApplication } from '@agent-native/kernel/application';
import type { ExecutionContext } from '@agent-native/runtime';
import { deviceLinkOperations as ops } from '../contracts';
import { credentialDigest, newCredential, type AttemptLimit } from '@agent-native/host/enrollment';

/** What the routes need once the host listens; undefined before `start`. */
export interface LinkCaller {
  readonly application: HostedApplication;
  readonly workspaceId: string;
  /** The local owner narrowed to the redeem and resolve operations. */
  readonly context: ExecutionContext;
}

/**
 * POST /api/v1/link/enroll `{ code }`: the device's half of pairing, before it has a credential.
 * The route generates the credential, redeems the code with the credential's digest through the
 * runtime, and returns the credential once. A crash between commit and response leaves a device
 * record whose credential nobody holds; the person enrolls again and revokes it.
 */
export async function enroll(
  request: Request,
  caller: LinkCaller | undefined,
  limit: AttemptLimit,
) {
  if (request.method !== 'POST') throw new ApplicationError('NOT_FOUND', 'Unknown route');
  if (!caller) throw new ApplicationError('UNAVAILABLE', 'The hub is starting');
  limit.check();
  const body = await readJsonBody(request);
  const code = typeof body.code === 'string' ? body.code : '';
  const token = newCredential();
  try {
    const receipt = await caller.application.invokeRaw(
      {
        operation: ops.enrollmentRedeem.id,
        input: { code, tokenDigest: credentialDigest(token) },
        idempotencyKey: `enroll:${crypto.randomUUID()}`,
      },
      { ...caller.context, channel: 'http' },
    );
    const { device } = receipt.result as { device: { id: string; label: string; kind: string } };
    return jsonResponse(
      { token, device: { id: device.id, label: device.label, kind: device.kind } },
      201,
      { 'Cache-Control': 'no-store' },
    );
  } catch (error) {
    limit.fail();
    throw error;
  }
}
