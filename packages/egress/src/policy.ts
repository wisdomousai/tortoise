import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  canonicalJson,
  type CatalogRequirements,
  type NetworkDestination,
} from '@agent-native/contracts';
import type { Cidr } from './cidr';
import { resolveBinding } from './policy/bindings';
import { createFindings } from './policy/findings';
import { checkFloors, offlineConsequences } from './policy/floors';
import { sitePolicySchema, type HardeningProfile, type SitePolicy } from './policy/schema';

export {
  hardeningProfiles,
  sitePolicySchema,
  type HardeningProfile,
  type SitePolicy,
  type SitePolicyInput,
} from './policy/schema';
export { portOf } from './policy/urls';

export interface PolicyFinding {
  readonly level: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly destination?: string;
}
export type Declared = NetworkDestination & { readonly owner: string };
export interface ResolvedBinding {
  readonly destination: Declared;
  readonly url: URL;
  readonly addresses?: readonly Cidr[];
  /** PEM contents, loaded by `loadSitePolicy`. */
  readonly ca?: string;
  readonly caPath?: string;
  readonly certificatePins?: readonly string[];
  readonly tls?: boolean;
}
/** What does not work in this deployment and why: the offline-first consequence list. */
export interface OfflineConsequence {
  readonly destination: string;
  readonly owner: string;
  readonly availability: NetworkDestination['availability'];
  readonly offline: NonNullable<NetworkDestination['offline']>;
  readonly targets: readonly string[];
  readonly reason: 'isolated' | 'disabled' | 'unbound';
}
export interface ResolvedPolicy {
  readonly policy: SitePolicy;
  readonly profile: HardeningProfile;
  readonly mode: SitePolicy['mode'];
  readonly bindings: ReadonlyMap<string, ResolvedBinding>;
  readonly disabled: ReadonlySet<string>;
  readonly declared: ReadonlyMap<string, Declared>;
  readonly findings: readonly PolicyFinding[];
  readonly consequences: readonly OfflineConsequence[];
  /** SHA-256 of the canonical policy, for attestation events and reports. */
  readonly digest: string;
  /**
   * Absolute PEM paths for a `tls` or `mtls` listener (`clientCa` for `mtls` only), checked
   * readable by `loadSitePolicy`. Paths, not contents, so the private key never sits in an object
   * that reports and monitors pass around.
   */
  readonly ingressTls?: { readonly cert: string; readonly key: string; readonly clientCa?: string };
}

/** Listener files as `loadSitePolicy` found them: absolute paths that exist and are readable. */
type IngressFiles = { readonly cert?: string; readonly key?: string; readonly clientCa?: string };

/** Resolve every binding the policy names, in policy order; disabled ones are only recorded. */
function resolveBindings(
  policy: SitePolicy,
  declared: ReadonlyMap<string, Declared>,
  ca: Readonly<Record<string, string>> | undefined,
  report: ReturnType<typeof createFindings>,
) {
  const bindings = new Map<string, ResolvedBinding>();
  const disabled = new Set<string>();
  for (const [id, binding] of Object.entries(policy.destinations)) {
    const destination = declared.get(id);
    if (!destination) {
      report.error(
        'UNDECLARED_BINDING',
        `No module or host component declares destination ${id}`,
        id,
      );
      continue;
    }
    if ('disabled' in binding) {
      disabled.add(id);
      continue;
    }
    if (destination.direction !== 'egress') {
      report.error(
        'INGRESS_BINDING',
        `Destination ${id} is ingress; bind listeners under ingress`,
        id,
      );
      continue;
    }
    const resolved = resolveBinding(id, destination, binding, { policy, report, ca });
    if (resolved) bindings.set(id, resolved);
  }
  return { bindings, disabled };
}

function ingressTlsOf(policy: SitePolicy, files: IngressFiles | undefined) {
  const { listen } = policy.ingress;
  if (listen === 'loopback' || !files?.cert || !files.key) return {};
  if (listen === 'tls') return { ingressTls: { cert: files.cert, key: files.key } };
  return files.clientCa
    ? { ingressTls: { cert: files.cert, key: files.key, clientCa: files.clientCa } }
    : {};
}

/**
 * Validate a site policy against the declared requirements and the profile's floor. Never
 * throws for policy content: problems are findings, and `assertPolicyUsable` refuses to start
 * when any finding is an error. Throws only when the JSON does not match the schema.
 */
export function resolveSitePolicy(
  input: unknown,
  requirements: CatalogRequirements,
  files: {
    readonly ca?: Readonly<Record<string, string>>;
    /** Absolute paths of the listener files that exist and are readable. */
    readonly ingress?: IngressFiles;
  } = {},
): ResolvedPolicy {
  const policy = sitePolicySchema.parse(input ?? {});
  const report = createFindings();
  const declared = new Map(requirements.network.map((item) => [item.id, item]));
  const { bindings, disabled } = resolveBindings(policy, declared, files.ca, report);
  const consequences = offlineConsequences(policy, requirements, bindings, disabled, report);
  checkFloors(policy, bindings, files.ingress, report);
  return {
    policy,
    profile: policy.profile,
    mode: policy.mode,
    bindings,
    disabled,
    declared,
    findings: report.findings,
    consequences,
    digest: createHash('sha256')
      .update(canonicalJson(JSON.parse(JSON.stringify(policy))))
      .digest('hex'),
    ...ingressTlsOf(policy, files.ingress),
  };
}

/** Refuse to start on any error finding. The message lists every error at once. */
export function assertPolicyUsable(resolved: ResolvedPolicy): void {
  const errors = resolved.findings.filter((finding) => finding.level === 'error');
  if (errors.length)
    throw new Error(
      `Site policy rejected (${resolved.profile}):\n${errors.map((e) => `- ${e.code}: ${e.message}`).join('\n')}`,
    );
}

/** Read a policy file and the CA bundles and listener files it references (relative paths). */
export async function loadSitePolicy(
  path: string,
  requirements: CatalogRequirements,
): Promise<ResolvedPolicy> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const parsed = sitePolicySchema.safeParse(raw);
  const ca: Record<string, string> = {};
  if (parsed.success)
    for (const binding of Object.values(parsed.data.destinations))
      if ('ca' in binding && binding.ca)
        ca[binding.ca] = await readFile(resolve(dirname(path), binding.ca), 'utf8').catch(
          () => undefined as unknown as string,
        );
  for (const [key, value] of Object.entries(ca)) if (value === undefined) delete ca[key];
  const read = async (file: string | undefined) => {
    if (!file) return undefined;
    const absolute = resolve(dirname(path), file);
    return access(absolute, constants.R_OK).then(
      () => absolute,
      () => undefined,
    );
  };
  const ingress = parsed.success ? parsed.data.ingress : undefined;
  const [cert, key, clientCa] = await Promise.all([
    read(ingress?.cert),
    read(ingress?.key),
    read(ingress?.clientCa),
  ]);
  return resolveSitePolicy(raw, requirements, {
    ca,
    ...(ingress && ingress.listen !== 'loopback' ? { ingress: { cert, key, clientCa } } : {}),
  });
}

/** The isolated default: loopback only, every egress destination reported as a consequence. */
export const isolatedPolicy = (
  requirements: CatalogRequirements,
  profile: HardeningProfile = 'desktop-local',
) => resolveSitePolicy({ profile, mode: 'isolated' }, requirements);
