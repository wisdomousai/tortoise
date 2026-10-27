import type { TestRequest } from './contracts';

/** Workspace roles: technicians submit and change test requests, viewers read them. */
export type Role = 'technician' | 'viewer';

/** The lab requests slice of a workspace. */
export interface LabRequestsState {
  /** People who work in this lab and their role. */
  members: Record<string, Role>;
  requests: Record<string, TestRequest>;
}

/** A new lab requests slice. Its owner is always a technician. */
export function createLabRequestsState(
  ownerId: string,
  members: Record<string, Role> = {},
): LabRequestsState {
  return { members: { ...members, [ownerId]: 'technician' }, requests: {} };
}
