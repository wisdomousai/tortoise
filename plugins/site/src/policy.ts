import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ApplicationError,
  canonicalJson,
  type CatalogRequirements,
  type NetworkDestination,
} from '@tortoise/contracts';
import type { Cidr } from './cidr';
import { resolveBinding } from './policy/bindings';
import {
  checkCertificates,
  parseCertificates,
  type CertificateSource,
  type CertificateValidity,
} from './policy/certificates';
import { createFindings } from './policy/findings';
import { checkFloors, offlineConsequences } from './policy/floors';
import { resolveFolders, type ResolvedFolder } from './policy/folders';
import { resolveProcesses, type ResolvedProcess } from './policy/processes';
import { sitePolicySchema, type HardeningProfile, type SitePolicy } from './policy/schema';

export {
  hardeningProfiles,
  sitePolicySchema,
  type HardeningProfile,
  type SitePolicy,
  type SitePolicyInput,
} from './policy/schema';
export { portOf } from './policy/urls';
export {
  certificateWarningMs,
  judgeCertificates,
  type CertificateProblem,
  type CertificateSource,
  type CertificateValidity,
} from './policy/certificates';
export type { DeclaredProcess, ResolvedProcess } from './policy/processes';
export type { DeclaredFolder, ResolvedFolder } from './policy/folders';
export type { ProcessBinding } from './policy/schema';

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
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
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
  /** Declared child processes this site binds to an executable, by process ID. */
  readonly processes: ReadonlyMap<string, ResolvedProcess>;
  /** Declared child processes this site explicitly disables. */
  readonly disabledProcesses: ReadonlySet<string>;
  /** Declared exchange folders this site binds to a directory, by folder ID. */
  readonly folders: ReadonlyMap<string, ResolvedFolder>;
  /** Declared exchange folders this site explicitly disables. */
  readonly disabledFolders: ReadonlySet<string>;
  /** SHA-256 of the canonical policy, for attestation events and reports. */
  readonly digest: string;
  /**
   * Absolute PEM paths for a `tls` or `mtls` listener (`clientCa` for `mtls` only), checked
   * readable by `loadSitePolicy`. Paths, not contents, so the private key never sits in an object
   * that reports and monitors pass around.
   */
  readonly ingressTls?: { readonly cert: string; readonly key: string; readonly clientCa?: string };
  /**
   * Validity of the ingress certificate, the ingress client CA and every destination CA bundle,
   * as `loadSitePolicy` read them. Empty for a policy resolved without its files. Posture checks
   * judge these again on each run, so expiry while the host runs is reported.
   */
  readonly certificates: readonly CertificateValidity[];
}

/** Listener files as `loadSitePolicy` found them: absolute paths that exist and are readable. */
type IngressFiles = { readonly cert?: string; readonly key?: string; readonly clientCa?: string };

/** Parse every certificate file the policy loaded; a file that does not parse is an error. */
function certificatesOf(
  bindings: ReadonlyMap<string, ResolvedBinding>,
  pem: { readonly ingressCert?: string; readonly clientCa?: string } | undefined,
  report: ReturnType<typeof createFindings>,
) {
  const files: [CertificateSource, string, string?][] = [];
  if (pem?.ingressCert) files.push(['ingress-cert', pem.ingressCert]);
  if (pem?.clientCa) files.push(['ingress-client-ca', pem.clientCa]);
  for (const [id, binding] of bindings)
    if (binding.ca) files.push(['destination-ca', binding.ca, id]);
  const certificates: CertificateValidity[] = [];
  for (const [source, contents, destination] of files) {
    const parsed = parseCertificates(contents, source, destination);
    if (parsed) certificates.push(...parsed);
    else
      report.error(
        'CERTIFICATE_INVALID',
        `${source}${destination ? ` for ${destination}` : ''} holds no readable PEM certificate`,
        destination,
      );
  }
  return certificates;
}

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
    /** Contents of the listener certificate and client CA; never the key. */
    readonly pem?: { readonly ingressCert?: string; readonly clientCa?: string };
    /** When certificate validity is judged; defaults to the current time. */
    readonly now?: number;
    /** Bound folders whose directory `loadSitePolicy` did not find. */
    readonly missingFolders?: readonly string[];
  } = {},
): ResolvedPolicy {
  const parsed = sitePolicySchema.safeParse(input ?? {});
  // A malformed file is the operator's input: name each field, so `site check` can say what to fix.
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ApplicationError(
      'INVALID_INPUT',
      `Site policy does not match its schema: ${issues.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ')}`,
      issues,
    );
  }
  const policy = parsed.data;
  const report = createFindings();
  const declared = new Map(requirements.network.map((item) => [item.id, item]));
  const { bindings, disabled } = resolveBindings(policy, declared, files.ca, report);
  const consequences = offlineConsequences(policy, requirements, bindings, disabled, report);
  const { processes, disabledProcesses } = resolveProcesses(policy, requirements, report);
  const { folders, disabledFolders } = resolveFolders(policy, requirements, report);
  for (const id of files.missingFolders ?? [])
    report.warn('FOLDER_MISSING', `Folder ${id} is bound to a directory that does not exist`, id);
  checkFloors(policy, bindings, files.ingress, report);
  const certificates = certificatesOf(bindings, files.pem, report);
  checkCertificates(certificates, files.now ?? Date.now(), report);
  return {
    policy,
    profile: policy.profile,
    mode: policy.mode,
    bindings,
    disabled,
    declared,
    findings: report.findings,
    consequences,
    processes,
    disabledProcesses,
    folders,
    disabledFolders,
    digest: createHash('sha256')
      .update(canonicalJson(JSON.parse(JSON.stringify(policy))))
      .digest('hex'),
    ...ingressTlsOf(policy, files.ingress),
    certificates,
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
  options: { readonly now?: number } = {},
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
  const listening = ingress && ingress.listen !== 'loopback';
  // A share may be mounted after startup, so a missing folder is a warning, not a refusal.
  const missingFolders: string[] = [];
  if (parsed.success)
    for (const [id, binding] of Object.entries(parsed.data.folders ?? {}))
      if (
        'path' in binding &&
        !(await stat(binding.path).then(
          (s) => s.isDirectory(),
          () => false,
        ))
      )
        missingFolders.push(id);
  const contents = (file: string | undefined) =>
    file ? readFile(file, 'utf8').catch(() => undefined) : undefined;
  const [ingressCert, clientCaPem] = listening
    ? await Promise.all([contents(cert), contents(clientCa)])
    : [];
  return resolveSitePolicy(raw, requirements, {
    ca,
    ...(listening
      ? {
          ingress: { cert, key, clientCa },
          pem: {
            ...(ingressCert ? { ingressCert } : {}),
            ...(clientCaPem ? { clientCa: clientCaPem } : {}),
          },
        }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(missingFolders.length ? { missingFolders } : {}),
  });
}

/** The isolated default: loopback only, every egress destination reported as a consequence. */
export const isolatedPolicy = (
  requirements: CatalogRequirements,
  profile: HardeningProfile = 'desktop-local',
) => resolveSitePolicy({ profile, mode: 'isolated' }, requirements);
