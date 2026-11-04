import { ApplicationError } from '@tortoise/contracts';
import type { HostedApplication } from '@tortoise/kernel/application';
import type { SecretStore } from '@tortoise/kernel/platform';
import type { ExecutionContext } from '@tortoise/runtime';
import { requestLaunch, type HubLaunch } from './attached';
import { enrollPath, hubLinkOperations as ops } from './contracts';
import type { Pairing } from './handlers';
import { hubOrigin, type Link } from './network';

const tokenName = 'device-token';

export interface PairingDependencies {
  readonly secrets: SecretStore;
  readonly fetch: typeof fetch;
  readonly now: () => number;
}

/** What the plugin screen and device management call. */
export interface HubLinkService {
  /** Exchange a code from the hub for this device's credential, then record the pairing. */
  pair(request: { readonly origin: string; readonly code: string }): Promise<Pairing>;
  /** Delete the credential and forget the hub. The hub keeps the device until it is revoked. */
  unpair(): Promise<void>;
  /**
   * A one-use address of the hub's own screens for this device, for a web view. The hub decides
   * what the session may do: an attached tablet acts as the person who enrolled it.
   */
  launch(): Promise<HubLaunch>;
}

const message = (error: unknown) =>
  error instanceof ApplicationError ? error.message : 'The hub could not be reached';

/** Post the code to the hub's enrollment route and return the credential it issues. */
async function exchange(fetchImpl: typeof fetch, origin: string, code: string) {
  const response = await fetchImpl(new URL(enrollPath, origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    redirect: 'error',
  }).catch(() => {
    throw new ApplicationError('UNAVAILABLE', `The hub at ${origin} could not be reached`);
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: string;
    device?: { id: string; label: string; kind: Pairing['kind'] };
    error?: { message?: string };
  };
  if (!response.ok || !body.token || !body.device)
    throw new ApplicationError(
      'FORBIDDEN',
      body.error?.message ?? `The hub refused the enrollment (${response.status})`,
    );
  return { token: body.token, device: body.device };
}

/**
 * Pairing on the device. The credential goes to the keystore before the pairing is recorded, so
 * a recorded pairing always has one; a crash in between leaves an unrecorded credential that the
 * next pairing overwrites. `current` is what the network port reads.
 */
export function createPairing(dependencies: PairingDependencies) {
  let link: Link | undefined;
  let runtime: { application: HostedApplication; context: ExecutionContext } | undefined;
  const record = async (input: { pairing: Pairing } | { error: string }) => {
    if (!runtime) throw new ApplicationError('UNAVAILABLE', 'The app is starting');
    await runtime.application.invokeRaw(
      { operation: ops.pairingRecord.id, input, idempotencyKey: crypto.randomUUID() },
      runtime.context,
    );
  };

  const service: HubLinkService = {
    async pair(request) {
      try {
        const origin = hubOrigin(request.origin);
        const { token, device } = await exchange(dependencies.fetch, origin, request.code);
        await dependencies.secrets.set(tokenName, token);
        link = { origin, token };
        const pairing: Pairing = {
          origin,
          deviceId: device.id,
          label: device.label,
          kind: device.kind,
          pairedAt: dependencies.now(),
        };
        await record({ pairing });
        return pairing;
      } catch (error) {
        await record({ error: message(error) }).catch(() => undefined);
        throw error;
      }
    },
    async unpair() {
      link = undefined;
      await dependencies.secrets.delete(tokenName);
      if (!runtime) throw new ApplicationError('UNAVAILABLE', 'The app is starting');
      await runtime.application.invokeRaw(
        { operation: ops.pairingClear.id, input: {}, idempotencyKey: crypto.randomUUID() },
        runtime.context,
      );
    },
    async launch() {
      if (!link) throw new ApplicationError('UNAVAILABLE', 'This device is not paired with a hub');
      return requestLaunch(dependencies.fetch, link);
    },
  };

  return {
    service,
    current: () => link,
    /** Load the recorded pairing and its credential once the runtime exists. */
    async load(application: HostedApplication, context: ExecutionContext) {
      runtime = { application, context };
      const { data } = await application.queryRaw(
        { operation: ops.pairingGet.id, input: {} },
        context,
      );
      const pairing = (data as { pairing: Pairing | null }).pairing;
      const token = pairing && (await dependencies.secrets.get(tokenName));
      link = pairing && token ? { origin: pairing.origin, token } : undefined;
      return { paired: link !== undefined, recorded: pairing !== null };
    },
  };
}
