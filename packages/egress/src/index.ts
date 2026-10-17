/**
 * Server-only egress control. Declared requirements say what may be reached; the site policy
 * binds and opens it; the guard and proxy enforce it in-process and audit every decision. The
 * same resolved policy drives the exported OS rules, which contain what in-process checks cannot.
 */
export {
  cidrContains,
  cidrIsPrivate,
  isLoopbackAddress,
  isLoopbackHost,
  isPrivateAddress,
  parseCidr,
  type Cidr,
} from './cidr';
export {
  assertPolicyUsable,
  hardeningProfiles,
  isolatedPolicy,
  loadSitePolicy,
  portOf,
  resolveSitePolicy,
  sitePolicySchema,
  type Declared,
  type DeclaredProcess,
  type HardeningProfile,
  type OfflineConsequence,
  type PolicyFinding,
  type ProcessBinding,
  type ResolvedBinding,
  type ResolvedPolicy,
  type ResolvedProcess,
  type SitePolicy,
  type SitePolicyInput,
} from './policy';
export {
  createEgress,
  EgressDenied,
  type DenialReason,
  type DestinationClient,
  type Egress,
  type EgressOptions,
  type HostLookup,
} from './guard';
export { startEgressProxy, type EgressProxy } from './proxy';
