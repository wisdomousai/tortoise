import { ApplicationError, type ContractApplication } from '@agent-native/contracts';
import { jsonResponse, readJsonBody } from '@agent-native/adapters/http';
import { createPeerCall, PeerCallError } from '@agent-native/integration';
import type { NetworkPort } from '@agent-native/kernel/plugin';
import type { ExecutionContext } from '@agent-native/runtime';
import { generateAssertionKey } from '../assertion';
import { enrollPath, peerLinkOperations as ops } from '../contracts';
import type { PeerCaller } from '../inbound/routes';
import type { OutboundTarget } from '../service';
import type { Outbound } from './link';
import type { ConnectionSecrets } from './secrets';

export interface ConnectOptions {
  readonly targets: ReadonlyMap<string, OutboundTarget>;
  readonly secrets: ConnectionSecrets;
  readonly network: () => NetworkPort;
  readonly outbound: Outbound;
  readonly caller: () => PeerCaller | undefined;
}

/**
 * Connect to the peer target with the code its owner read out, as `context`.
 *
 * Ordering: the caller is authorized first, by listing connections as themself, so a person who
 * may not connect never spends the code. Then a new key pair is generated and the code redeemed
 * at the target's enrollment route through the network port; the credential and private key go
 * to the secret store; the connection is recorded as the caller. A crash after the redemption
 * leaves a peer record there that nobody uses (its owner revokes it) and, at worst, a secret
 * here without its record, which the next request deletes.
 */
export async function connect(
  { target, code }: { readonly target: string; readonly code: string },
  context: ExecutionContext,
  options: ConnectOptions,
): Promise<{ readonly connection: Record<string, unknown> }> {
  const caller = options.caller();
  if (!caller) throw new ApplicationError('UNAVAILABLE', 'The application is starting');
  const declared = options.targets.get(target);
  await caller.application.queryRaw({ operation: ops.connectionList.id, input: {} }, context);
  if (!declared) throw new ApplicationError('INVALID_INPUT', `${target} is not a peer target here`);
  if (!code)
    throw new ApplicationError('INVALID_INPUT', 'Enter the code from the other application');

  const key = await generateAssertionKey();
  const own = caller.application.discover(caller.context).application;
  const peer = createPeerCall({ client: () => options.network().client(declared.destination) });
  let answer: {
    token: string;
    peer: { id: string; audience: string };
    contract: ContractApplication;
  };
  try {
    answer = await peer.post(enrollPath, {
      code,
      application: own.id,
      publicKey: key.publicKey,
      contract: { ...own },
    });
  } catch (error) {
    if (error instanceof PeerCallError && error.kind === 'answered' && error.envelope)
      throw new ApplicationError(
        error.envelope.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAVAILABLE',
        `${target} refused the code: ${error.envelope.message}`,
      );
    throw new ApplicationError('UNAVAILABLE', `${target} could not be reached`);
  }
  if (answer.contract?.id !== declared.application)
    throw new ApplicationError(
      'CONFLICT',
      `The code was issued by ${answer.contract?.id ?? 'an unknown application'}, not ${declared.application}; ask its owner to revoke this enrollment`,
    );
  const secret = { peerId: answer.peer.id, token: answer.token, privateKey: key.privateKey };
  await options.secrets.write(target, secret);
  const receipt = await caller.application.invokeRaw(
    {
      operation: ops.connectionRecord.id,
      input: {
        target,
        peerId: answer.peer.id,
        audience: answer.peer.audience,
        contract: {
          id: answer.contract.id,
          contractVersion: answer.contract.contractVersion,
          digest: answer.contract.digest,
        },
      },
      idempotencyKey: `peer-connect:${crypto.randomUUID()}`,
    },
    context,
  );
  options.outbound.hold(target, secret, answer.peer.audience);
  return receipt.result as { connection: Record<string, unknown> };
}

/** POST /api/v1/peer/connect `{ target, code }`, as a person signed in here. */
export async function connectRoute(
  request: Request,
  context: ExecutionContext,
  options: ConnectOptions,
) {
  if (request.method !== 'POST') throw new ApplicationError('NOT_FOUND', 'Unknown route');
  const body = await readJsonBody(request);
  const result = await connect(
    {
      target: typeof body.target === 'string' ? body.target : '',
      code: typeof body.code === 'string' ? body.code : '',
    },
    context,
    options,
  );
  return jsonResponse(result, 201, { 'Cache-Control': 'no-store' });
}
