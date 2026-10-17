import type { AuditEventRecord } from './contracts/audit';
import type { Relay } from './contracts/relay';
import type { Channel, ReleaseRecord } from './contracts/releases';
import type { Site } from './contracts/sites';

/** Workspace roles: operators enroll, publish, assign and relay; viewers read. */
export type Role = 'operator' | 'viewer';

/** The application's state. Records are keyed objects; read them with `own`, write with `records`. */
export interface AppState {
  members: Record<string, Role>;
  /** By device-link device ID. */
  sites: Record<string, Site>;
  releases: Record<string, ReleaseRecord>;
  channels: Record<string, Channel>;
  /** By `<site>:<seq>`. */
  auditEvents: Record<string, AuditEventRecord>;
  relays: Record<string, StoredRelay>;
}

/**
 * A relay request as stored: what callers see, and while it waits, what the site needs to send
 * it. `outgoing` is never listed, and is dropped once the site takes the request.
 */
export type StoredRelay = Relay & {
  outgoing?: { headers: Record<string, string>; body?: string };
};

/** A new workspace. Its owner is always an operator. */
export function createState(ownerId: string, members: Record<string, Role> = {}): AppState {
  return {
    members: { ...members, [ownerId]: 'operator' },
    sites: {},
    releases: {},
    channels: {},
    auditEvents: {},
    relays: {},
  };
}

/** The device-link principal of an enrolled site, and the site ID inside it. */
export const SITE_PREFIX = 'device:';
export const siteIdOf = (principalId: string) =>
  principalId.startsWith(SITE_PREFIX) ? principalId.slice(SITE_PREFIX.length) : undefined;

/** The release a site's channel assigns, if any. */
export function desiredRelease(state: AppState, siteId: string): ReleaseRecord | undefined {
  const site = Object.hasOwn(state.sites, siteId) ? state.sites[siteId] : undefined;
  const channel =
    site?.channel && Object.hasOwn(state.channels, site.channel)
      ? state.channels[site.channel]
      : undefined;
  return channel && Object.hasOwn(state.releases, channel.release)
    ? state.releases[channel.release]
    : undefined;
}
