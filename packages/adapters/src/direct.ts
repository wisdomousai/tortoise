import { readFile } from 'node:fs/promises';
import { ApplicationError } from '@agent-native/contracts';
import type { DelegationGrant, ExecutionContext } from '@agent-native/runtime';

export { createDirectTransport } from './direct-transport';

/**
 * Read a delegation the launcher grants to an embedded agent surface. The file is trusted
 * configuration written by the orchestrator, not by the agent; the instance still applies
 * domain policy for `principalId`, and the grant can only narrow it. Fails closed on any
 * malformed field, an unknown workspace or an expired grant.
 */
export async function readGrantFile(path: string, workspaceId: string): Promise<ExecutionContext> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'Grant file is missing or not JSON');
  }
  const grant = (value ?? {}) as Record<string, unknown>;
  const strings = (item: unknown) =>
    Array.isArray(item) && item.every((entry) => typeof entry === 'string' && entry.length > 0);
  if (
    typeof grant.principalId !== 'string' ||
    !grant.principalId ||
    !strings(grant.operations) ||
    !(grant.operations as string[]).length ||
    (grant.resources !== undefined && !strings(grant.resources)) ||
    (grant.expiresAt !== undefined &&
      (typeof grant.expiresAt !== 'number' || !Number.isFinite(grant.expiresAt))) ||
    (grant.workspaceId !== undefined && grant.workspaceId !== workspaceId) ||
    Object.keys(grant).some(
      (key) =>
        !['principalId', 'operations', 'resources', 'expiresAt', 'workspaceId'].includes(key),
    )
  )
    throw new ApplicationError(
      'INVALID_INPUT',
      'Grant file needs principalId and operations; optional resources, expiresAt, workspaceId',
    );
  if (grant.expiresAt !== undefined && (grant.expiresAt as number) <= Date.now())
    throw new ApplicationError('FORBIDDEN', 'Grant has expired');
  const delegation: DelegationGrant = {
    operations: grant.operations as string[],
    principalId: grant.principalId,
    workspaceId,
    ...(grant.resources ? { resources: grant.resources as string[] } : {}),
    ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt as number } : {}),
  };
  return { workspaceId, principalId: grant.principalId, grant: delegation };
}
