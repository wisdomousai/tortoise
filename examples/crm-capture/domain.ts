import { own } from '@agent-native/runtime';

/**
 * CRM capture: find customers in the CRM live, bring the ones you work with into this workspace,
 * and log what happened with them.
 *
 * The CRM owns accounts and contacts. Searches read it at call time and store nothing. Adopting
 * an account asks the CRM (through the outbox) to let this workspace follow it; the CRM feed then
 * delivers the account and keeps it current through the integration principal's sync command.
 * This application owns activities logged against adopted accounts, each forwarded to the CRM.
 */
export type LocalStatus = 'following' | 'adopted' | 'rejected';
export type SyncStatus = 'pending' | 'accepted' | 'rejected';
export interface Rejection {
  code: string;
  message: string;
}

/** Account identifiers are CRM IDs. Details are absent until the feed delivers them. */
export interface LocalAccount {
  id: string;
  status: LocalStatus;
  /** The follow request forwarded to the CRM. */
  effectId: string;
  name?: string;
  industry?: string;
  city?: string;
  region?: string;
  owner?: string;
  adoptedBy: string;
  adoptedAt: number;
  syncedAt?: number;
  rejection?: Rejection;
}
export interface Activity {
  id: string;
  accountId: string;
  kind: 'call' | 'meeting' | 'note';
  summary: string;
  occurredAt: number;
  recordedAt: number;
  recordedBy: string;
  effectId: string;
  sync: SyncStatus;
  sorRef?: string;
  rejection?: Rejection;
}
/** A person who works in this workspace and the sales regions they cover. */
export interface Member {
  regions: string[];
}
export interface CrmState {
  integrationPrincipalId: string;
  members: Record<string, Member>;
  accounts: Record<string, LocalAccount>;
  activities: Record<string, Activity>;
  /** CRM feed position after the last applied sync. */
  watermark?: string;
  lastSyncAt?: number;
}

export const REGIONS = ['north', 'south', 'west'];

export function createCrmState(options: {
  ownerId: string;
  integrationPrincipalId: string;
  members?: Record<string, Member>;
}): CrmState {
  return {
    integrationPrincipalId: options.integrationPrincipalId,
    members: options.members ?? { [options.ownerId]: { regions: [...REGIONS] } },
    accounts: {},
    activities: {},
  };
}

export const memberOf = (state: CrmState, principalId: string) => own(state.members, principalId);

/**
 * Whether a member may see a record in `region`. A followed account whose details have not
 * arrived has no region yet; every member sees it, since it holds nothing but its CRM ID.
 */
export function coversRegion(state: CrmState, principalId: string, region: string | undefined) {
  const member = memberOf(state, principalId);
  return !!member && (region === undefined || member.regions.includes(region));
}

export function visibleAccount(state: CrmState, principalId: string, id: string) {
  const account = own(state.accounts, id);
  return account && coversRegion(state, principalId, account.region) ? account : undefined;
}
