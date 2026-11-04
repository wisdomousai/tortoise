import type { AuditEventRecord } from './contracts/audit';
import type { Relay } from './contracts/relay';
import type { Channel, ReleaseRecord } from './contracts/releases';
import type { Instance } from './contracts/instances';

/** Workspace roles: operators enroll, publish, assign and relay; viewers read. */
export type Role = 'operator' | 'viewer';

/** The application's state. Records are keyed objects; read them with `own`, write with `records`. */
export interface AppState {
  members: Record<string, Role>;
  /** By device-link device ID. */
  instances: Record<string, Instance>;
  releases: Record<string, ReleaseRecord>;
  channels: Record<string, Channel>;
  /** By `<instance>:<seq>`. */
  auditEvents: Record<string, AuditEventRecord>;
  relays: Record<string, StoredRelay>;
}

/**
 * A relay request as stored: what callers see, and while it waits, what the instance needs to send
 * it. `outgoing` is never listed, and is dropped once the instance takes the request.
 */
export type StoredRelay = Relay & {
  outgoing?: { headers: Record<string, string>; body?: string };
};

/** A new workspace. Its owner is always an operator. */
export function createState(ownerId: string, members: Record<string, Role> = {}): AppState {
  return {
    members: { ...members, [ownerId]: 'operator' },
    instances: {},
    releases: {},
    channels: {},
    auditEvents: {},
    relays: {},
  };
}

/** The device-link principal of an enrolled instance, and the instance ID inside it. */
export const INSTANCE_PREFIX = 'device:';
export const instanceIdOf = (principalId: string) =>
  principalId.startsWith(INSTANCE_PREFIX) ? principalId.slice(INSTANCE_PREFIX.length) : undefined;

/** The release an instance's channel assigns, if any. */
export function desiredRelease(state: AppState, instanceId: string): ReleaseRecord | undefined {
  const instance = Object.hasOwn(state.instances, instanceId)
    ? state.instances[instanceId]
    : undefined;
  const channel =
    instance?.channel && Object.hasOwn(state.channels, instance.channel)
      ? state.channels[instance.channel]
      : undefined;
  return channel && Object.hasOwn(state.releases, channel.release)
    ? state.releases[channel.release]
    : undefined;
}
