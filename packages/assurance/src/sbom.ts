import { createHash } from 'node:crypto';
import type { SecurityManifest } from './manifest';

/** A `bun.lock` package entry: `[ident, resolved, meta, integrity]`; workspaces have only ident. */
type LockEntry = [string, string?, LockMeta?, string?];
interface LockMeta {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}
interface BunLock {
  readonly workspaces: Record<
    string,
    {
      readonly name?: string;
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
    }
  >;
  readonly packages: Record<string, LockEntry>;
}

/** `bun.lock` is JSON with trailing commas. Strings in it never contain `,}` or `,]`. */
export function parseBunLock(text: string): BunLock {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')) as BunLock;
}

const purl = (name: string, version: string) =>
  `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${encodeURIComponent(version)}`;
/** `name@version`, where the name itself may start with `@`. */
function splitIdent(ident: string): { name: string; version: string } {
  const at = ident.lastIndexOf('@');
  return { name: ident.slice(0, at), version: ident.slice(at + 1) };
}
function hashOf(integrity: string | undefined) {
  const match = integrity && /^sha(512|384|256|1)-(.+)$/.exec(integrity);
  if (!match) return undefined;
  return {
    alg: match[1] === '1' ? 'SHA-1' : `SHA-${match[1]}`,
    content: Buffer.from(match[2]!, 'base64').toString('hex'),
  };
}
/** RFC 4122 shaped UUID derived from content, so the same lock yields the same serial number. */
function stableUuid(text: string) {
  const hex = createHash('sha256').update(text).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export interface SbomOptions {
  readonly application: string;
  readonly version: string;
  /** Contents of `bun.lock`. */
  readonly lock: string;
  /** Declared destinations become CycloneDX services with their data flows and trust zones. */
  readonly manifest?: SecurityManifest;
}

/**
 * CycloneDX 1.6 JSON bill of materials for the locked dependency graph. Deterministic: no
 * timestamp, a serial number derived from the lock, components sorted by reference.
 *
 * Scope: `required` for packages reachable from runtime dependencies of the root or any
 * workspace, `excluded` for those reachable only from development dependencies. Licenses are not
 * in the lockfile and are omitted rather than guessed. First-party workspace packages appear as
 * components with a `workspace:` reference. Declared network destinations are listed as
 * `services`, so the SBOM also states what the application talks to and which data leaves.
 */
export function cycloneDx(options: SbomOptions): Record<string, unknown> {
  const lock = parseBunLock(options.lock);
  const entries = Object.entries(lock.packages);
  const refOf = new Map<string, string>();
  for (const [key, [ident]] of entries) {
    const { name, version } = splitIdent(ident);
    refOf.set(key, version.startsWith('workspace:') ? `workspace:${name}` : purl(name, version));
  }
  /** Resolve a dependency the way the lock nests it: innermost `parent/…/name` first. */
  const resolve = (fromKey: string, dependency: string) => {
    const parts = fromKey ? fromKey.split('/') : [];
    for (let end = parts.length; end >= 0; end--) {
      const key = [...parts.slice(0, end), dependency].join('/');
      if (lock.packages[key]) return key;
    }
    return undefined;
  };
  const edges = new Map<string, Set<string>>();
  for (const [key, [, , meta]] of entries) {
    const targets = new Set<string>();
    for (const dependency of Object.keys({
      ...meta?.dependencies,
      ...meta?.optionalDependencies,
    })) {
      const found = resolve(key, dependency);
      if (found) targets.add(found);
    }
    edges.set(key, targets);
  }
  const workspaceKeys = new Map<string, string>();
  for (const [key, [ident]] of entries)
    if (splitIdent(ident).version.startsWith('workspace:'))
      workspaceKeys.set(splitIdent(ident).name, key);
  const rootRuntime: string[] = [];
  const rootDevelopment: string[] = [];
  for (const workspace of Object.values(lock.workspaces)) {
    for (const name of Object.keys({
      ...workspace.dependencies,
      ...workspace.optionalDependencies,
    })) {
      const found = resolve('', name);
      if (found) rootRuntime.push(found);
    }
    for (const name of Object.keys(workspace.devDependencies ?? {})) {
      const found = resolve('', name);
      if (found) rootDevelopment.push(found);
    }
  }
  const reach = (starts: readonly string[]) => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const key = stack.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(...(edges.get(key) ?? []));
    }
    return seen;
  };
  const runtime = reach(rootRuntime);
  const components = new Map<string, Record<string, unknown>>();
  for (const [key, [ident, , , integrity]] of entries) {
    const ref = refOf.get(key)!;
    if (components.has(ref)) continue;
    const { name, version } = splitIdent(ident);
    const workspace = version.startsWith('workspace:');
    const hash = hashOf(integrity);
    components.set(ref, {
      type: 'library',
      'bom-ref': ref,
      name,
      ...(workspace
        ? { properties: [{ name: 'workspace:path', value: version.slice('workspace:'.length) }] }
        : { version, purl: ref }),
      ...(hash ? { hashes: [hash] } : {}),
      scope: runtime.has(key) ? 'required' : 'excluded',
    });
  }
  const dependencies = new Map<string, Set<string>>();
  for (const [key, targets] of edges) {
    const ref = refOf.get(key)!;
    const set = dependencies.get(ref) ?? new Set<string>();
    for (const target of targets) set.add(refOf.get(target)!);
    dependencies.set(ref, set);
  }
  const rootRef = `application:${options.application}@${options.version}`;
  dependencies.set(
    rootRef,
    new Set([...rootRuntime, ...rootDevelopment].map((key) => refOf.get(key)!)),
  );
  const byRef = (a: { 'bom-ref'?: unknown; ref?: unknown }, b: typeof a) =>
    String(a['bom-ref'] ?? a.ref) < String(b['bom-ref'] ?? b.ref) ? -1 : 1;
  const services = (options.manifest?.network ?? []).map((destination) => ({
    'bom-ref': `service:${destination.id}`,
    name: destination.id,
    description: destination.purpose,
    ...(destination.host ? { endpoints: [`${destination.protocol}://${destination.host}`] } : {}),
    trustZone: destination.scope,
    'x-trust-boundary': destination.scope !== 'loopback',
    data: destination.dataClasses.map((classification) => ({
      flow: destination.direction === 'egress' ? 'outbound' : 'inbound',
      classification,
    })),
    properties: [
      { name: 'agent-native:owner', value: destination.owner },
      { name: 'agent-native:availability', value: destination.availability },
      ...(destination.offline
        ? [{ name: 'agent-native:offline', value: destination.offline }]
        : []),
    ],
  }));
  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${stableUuid(options.lock)}`,
    version: 1,
    metadata: {
      tools: {
        components: [{ type: 'application', name: '@agent-native/assurance', version: '0.1.0' }],
      },
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: options.application,
        version: options.version,
      },
    },
    components: [...components.values()].sort(byRef),
    ...(services.length ? { services: services.sort(byRef) } : {}),
    dependencies: [...dependencies]
      .map(([ref, targets]) => ({ ref, dependsOn: [...targets].sort() }))
      .sort(byRef),
  };
}
