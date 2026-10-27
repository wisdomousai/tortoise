import { ApplicationError } from '@agent-native/contracts';
import { jsonResponse, readJsonBody } from '@agent-native/adapters/http';
import type { HostedApplication } from '@agent-native/kernel/application';
import type { ExecutionContext } from '@agent-native/runtime';
import { credentialDigest, newCredential, type AttemptLimit } from '@agent-native/host/enrollment';
import { peerLinkOperations as ops } from '../contracts';

/** What the routes and the authenticator need once the host listens; undefined before `start`. */
export interface PeerCaller {
  readonly application: HostedApplication;
  readonly workspaceId: string;
  /** The local owner narrowed to the redeem and resolve operations. */
  readonly context: ExecutionContext;
}

/**
 * POST /api/v1/peer/enroll `{ code, application, publicKey, contract? }`: the calling
 * application's half of enrollment, before it has a credential. The route generates the
 * credential, redeems the code with the credential's digest and the caller's public key through
 * the runtime, and returns the credential once with the audience its assertions must name and
 * this application's contract. A crash between commit and response leaves a peer record whose
 * credential nobody holds; the person enrolls again and revokes it.
 */
export async function enroll(
  request: Request,
  caller: PeerCaller | undefined,
  limit: AttemptLimit,
) {
  if (request.method !== 'POST') throw new ApplicationError('NOT_FOUND', 'Unknown route');
  if (!caller) throw new ApplicationError('UNAVAILABLE', 'The application is starting');
  limit.check();
  const body = await readJsonBody(request);
  const token = newCredential();
  try {
    const receipt = await caller.application.invokeRaw(
      {
        operation: ops.enrollmentRedeem.id,
        input: {
          code: typeof body.code === 'string' ? body.code : '',
          tokenDigest: credentialDigest(token),
          application: body.application,
          publicKey: body.publicKey,
          ...(body.contract === undefined ? {} : { contract: body.contract }),
        },
        idempotencyKey: `peer-enroll:${crypto.randomUUID()}`,
      },
      { ...caller.context, channel: 'http' },
    );
    const { peer } = receipt.result as { peer: { id: string; audience: string } };
    return jsonResponse(
      {
        token,
        peer: { id: peer.id, audience: peer.audience },
        contract: caller.application.discover(caller.context).application,
      },
      201,
      { 'Cache-Control': 'no-store' },
    );
  } catch (error) {
    limit.fail();
    throw error;
  }
}
