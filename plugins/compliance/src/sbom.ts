import type { SecurityManifest } from './manifest';
import { lockGraph, type LockGraph } from './sbom/graph';
import { hashOf, parseBunLock, splitIdent, stableUuid } from './sbom/lock';

export { parseBunLock } from './sbom/lock';

export interface SbomOptions {
  readonly application: string;
  readonly version: string;
  /** Contents of `bun.lock`. */
  readonly lock: string;
  /** Declared destinations become CycloneDX services with their data flows and trust zones. */
  readonly manifest?: SecurityManifest;
}

/** One component per reference; first-party workspaces carry their path instead of a version. */
function sbomComponents(graph: LockGraph) {
  const components = new Map<string, Record<string, unknown>>();
  for (const [key, [ident, , , integrity]] of graph.entries) {
    const ref = graph.refOf.get(key)!;
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
      scope: graph.runtime.has(key) ? 'required' : 'excluded',
    });
  }
  return components;
}

/** Dependency edges by reference, plus the application's own entry points under `rootRef`. */
function sbomDependencies(graph: LockGraph, rootRef: string) {
  const dependencies = new Map<string, Set<string>>();
  for (const [key, targets] of graph.edges) {
    const ref = graph.refOf.get(key)!;
    const set = dependencies.get(ref) ?? new Set<string>();
    for (const target of targets) set.add(graph.refOf.get(target)!);
    dependencies.set(ref, set);
  }
  dependencies.set(
    rootRef,
    new Set([...graph.rootRuntime, ...graph.rootDevelopment].map((key) => graph.refOf.get(key)!)),
  );
  return dependencies;
}

/** Declared destinations as CycloneDX services with their data flows and trust zones. */
const sbomServices = (manifest: SecurityManifest | undefined) =>
  (manifest?.network ?? []).map((destination) => ({
    'bom-ref': `service:${destination.id}`,
    name: destination.id,
    description: destination.purpose,
    ...(destination.host ? { endpoints: [`${destination.protocol}://${destination.host}`] } : {}),
    trustZone: destination.scope,
    'x-trust-boundary': destination.scope !== 'loopback',
    data: destination.dataClasses.map((classification) => ({
      flow: destination.direction === 'outbound' ? 'outbound' : 'inbound',
      classification,
    })),
    properties: [
      { name: 'tortoise:owner', value: destination.owner },
      { name: 'tortoise:availability', value: destination.availability },
      ...(destination.offline ? [{ name: 'tortoise:offline', value: destination.offline }] : []),
    ],
  }));

const byRef = (a: { 'bom-ref'?: unknown; ref?: unknown }, b: typeof a) =>
  String(a['bom-ref'] ?? a.ref) < String(b['bom-ref'] ?? b.ref) ? -1 : 1;

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
  const graph = lockGraph(parseBunLock(options.lock));
  const components = sbomComponents(graph);
  const rootRef = `application:${options.application}@${options.version}`;
  const dependencies = sbomDependencies(graph, rootRef);
  const services = sbomServices(options.manifest);
  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${stableUuid(options.lock)}`,
    version: 1,
    metadata: {
      tools: {
        components: [{ type: 'application', name: '@tortoise/compliance', version: '0.1.0' }],
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
