import type { ExecutionContext } from '@agent-native/runtime';
import { deviceLinkModule, deviceLinkOperations as ops } from '../contracts';
import type { LinkCaller } from './routes';
import { credentialDigest, credentialPattern } from '@agent-native/host/enrollment';
import type { DeviceKind } from './state';
const linkOperations = new Set<string>(deviceLinkModule.capabilities.map((c) => c.id));

interface ResolvedDevice {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly enrolledBy: string;
  readonly operations?: readonly string[];
}

/**
 * The caller a device credential stands for, looked up through the runtime on every request, so a
 * revocation committed a moment ago already applies.
 *
 * - A field device acts as `device:<id>` with a grant listing only the sync operations, so the
 *   application's policy sees which device delivered and the grant bounds what it can call.
 * - An attached device acts as the person who enrolled it, narrowed to the enrollment's
 *   operations or, without them, to every operation except device management.
 */
export async function authenticateDevice(
  token: string,
  caller: LinkCaller | undefined,
  options: { readonly syncOperations: readonly string[]; readonly operations: ReadonlySet<string> },
): Promise<ExecutionContext | undefined> {
  if (!caller || !credentialPattern.test(token)) return undefined;
  const result = await caller.application.queryRaw(
    { operation: ops.credentialResolve.id, input: { tokenDigest: credentialDigest(token) } },
    caller.context,
  );
  const device = (result.data as { device: ResolvedDevice | null }).device;
  if (!device) return undefined;
  const { workspaceId } = caller;
  if (device.kind === 'field-sync') {
    const principalId = `device:${device.id}`;
    return {
      workspaceId,
      principalId,
      grant: { operations: [...options.syncOperations], principalId, workspaceId },
    };
  }
  // Enrollment already refuses device management; filtering again keeps a record written before
  // that check from granting it.
  const operations = (device.operations ?? [...options.operations]).filter(
    (id) => !linkOperations.has(id),
  );
  return {
    workspaceId,
    principalId: device.enrolledBy,
    grant: { operations: [...operations], principalId: device.enrolledBy, workspaceId },
  };
}
