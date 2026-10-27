import type { TestRequest } from './contracts';

/** Workspace roles: technicians submit and change test requests, viewers read them. */
export type Role = 'technician' | 'viewer';

/** The test requests slice of a workspace. */
export interface TestRequestsState {
  /** People who work in this lab and their role. */
  members: Record<string, Role>;
  requests: Record<string, TestRequest>;
}

/** A new test requests slice. Its owner is always a technician. */
export function createTestRequestsState(
  ownerId: string,
  members: Record<string, Role> = {},
): TestRequestsState {
  return { members: { ...members, [ownerId]: 'technician' }, requests: {} };
}
