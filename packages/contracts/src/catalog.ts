import { assertBlobLimits, type BlobLimits } from './blob';
import type {
  AnyCapability,
  CapabilityModule,
  IntegrationDeclaration,
  PermissionRequirement,
  RemoteReadDeclaration,
} from './capability';
import { catalogAgents, type CatalogAgent } from './agent';
import { canonicalJson, type JsonObject } from './json';
import {
  collectRequirements,
  destinationsForRead,
  destinationsForTarget,
  type CatalogRequirements,
  type HostComponent,
} from './requirements';

export interface CatalogOperation {
  readonly id: string;
  readonly kind: 'command' | 'query';
  readonly module: string;
  readonly mcpName: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly permission: PermissionRequirement;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly errors: readonly string[];
  readonly ui: { readonly binding?: string; readonly exception?: string };
  readonly integration?: IntegrationDeclaration;
  readonly remote?: RemoteReadDeclaration;
  /** Network destinations the operation reaches, derived from its outbox or remote-read target. */
  readonly destinations?: readonly string[];
  readonly audit?: { readonly fields?: readonly string[] };
  readonly blobs?: BlobLimits;
}
export interface Catalog {
  readonly formatVersion: 1;
  readonly operations: readonly CatalogOperation[];
  readonly requirements: CatalogRequirements;
  readonly workflows: readonly {
    readonly id: string;
    readonly operations: readonly string[];
    readonly text: string;
  }[];
  /** Agent definitions with their module, sorted by ID. */
  readonly agents: readonly CatalogAgent[];
}

/** Generators consume this pure representation, never application handlers or host services. */
export interface BuildCatalogOptions {
  /** Non-module parts of the deployment whose requirements belong in the same manifest. */
  readonly components?: readonly HostComponent[];
}
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Unique module IDs, an acyclic dependency graph, and no component reusing a module ID. */
function checkModules(
  modules: readonly CapabilityModule[],
  components: readonly HostComponent[],
): Set<string> {
  const moduleIds = new Set<string>();
  for (const module of modules) {
    if (moduleIds.has(module.id)) throw new Error(`Duplicate module: ${module.id}`);
    moduleIds.add(module.id);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byModule = new Map(modules.map((module) => [module.id, module]));
  const checkDependencies = (id: string): void => {
    if (visiting.has(id))
      throw new Error(`Module dependency cycle: ${[...visiting, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const module = byModule.get(id);
    if (!module) throw new Error(`Missing module dependency: ${id}`);
    visiting.add(id);
    for (const dependency of module.requires ?? []) checkDependencies(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of moduleIds) checkDependencies(id);
  for (const component of components)
    if (moduleIds.has(component.id))
      throw new Error(`Host component and module share an ID: ${component.id}`);
  return moduleIds;
}

/** IDs, MCP names and UI bindings, unique across the catalog. Returns the MCP tool name. */
function checkNaming(
  capability: AnyCapability,
  seen: { readonly ids: Set<string>; readonly mcpNames: Set<string> },
): string {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(capability.id))
    throw new Error(`Invalid operation ID: ${capability.id}`);
  if (seen.ids.has(capability.id)) throw new Error(`Duplicate operation: ${capability.id}`);
  seen.ids.add(capability.id);
  const mcpName = capability.id.replace(/[.-]/g, '_');
  if (mcpName.length > 64 || seen.mcpNames.has(mcpName))
    throw new Error(`MCP name collision or excessive length: ${capability.id} -> ${mcpName}`);
  seen.mcpNames.add(mcpName);
  if (!capability.ui?.binding && !capability.ui?.exception)
    throw new Error(`Missing UI binding or exception: ${capability.id}`);
  return mcpName;
}

/** An outbox command's destinations; every target must travel over a declared destination. */
function integrationDestinations(
  capability: AnyCapability,
  requirements: CatalogRequirements,
): readonly string[] {
  if (
    capability.integration &&
    (capability.kind !== 'command' ||
      !capability.integration.target ||
      capability.integration.delivery !== 'outbox')
  )
    throw new Error(`Integration requires a command with an outbox target: ${capability.id}`);
  // Every outbox target must travel over a declared destination, so the data-flow manifest
  // and the egress guard cover each system of record a command can reach.
  const destinations = capability.integration
    ? destinationsForTarget(requirements, capability.integration.target)
    : [];
  if (capability.integration && destinations.length === 0)
    throw new Error(
      `Outbox target ${capability.integration.target} has no declared network destination: ${capability.id}`,
    );
  return destinations;
}

/** A remote query's destinations; every read target must travel over a declared destination. */
function remoteDestinations(
  capability: AnyCapability,
  requirements: CatalogRequirements,
): readonly string[] {
  const remote = capability.remote;
  if (!remote) return [];
  if (
    capability.kind !== 'query' ||
    !remote.target ||
    !['caller', 'caller-or-service'].includes(remote.identity)
  )
    throw new Error(`Remote read requires a query with a target and identity: ${capability.id}`);
  // Like outbox targets: the data-flow manifest and egress guard must cover every remote read.
  const destinations = destinationsForRead(requirements, remote.target);
  if (destinations.length === 0)
    throw new Error(
      `Remote target ${remote.target} has no declared network destination: ${capability.id}`,
    );
  return destinations;
}

function checkAuditFields(capability: AnyCapability): void {
  const inputFields = Object.keys(
    (capability.input.jsonSchema.properties as JsonObject | undefined) ?? {},
  );
  for (const field of capability.audit?.fields ?? [])
    if (!inputFields.includes(field))
      throw new Error(`Audit field ${field} is not a top-level input field: ${capability.id}`);
}

function checkBlobLimits(capability: AnyCapability): void {
  if (!capability.blobs) return;
  if (capability.kind !== 'command')
    throw new Error(`Only commands attach blobs: ${capability.id}`);
  assertBlobLimits(capability.blobs, capability.id);
}

function catalogOperation(
  capability: AnyCapability,
  module: string,
  mcpName: string,
  destinations: readonly string[],
): CatalogOperation {
  return {
    id: capability.id,
    kind: capability.kind,
    module,
    mcpName,
    inputSchema: capability.input.jsonSchema,
    outputSchema: capability.output.jsonSchema,
    permission: capability.permission,
    description: capability.description ?? '',
    dependencies: capability.dependencies ?? [],
    errors: capability.errors ?? [],
    ui: capability.ui!,
    // Omitted rather than undefined: the catalog is canonical JSON.
    ...(capability.integration ? { integration: capability.integration } : {}),
    ...(capability.remote ? { remote: capability.remote } : {}),
    ...(destinations.length ? { destinations } : {}),
    ...(capability.audit ? { audit: capability.audit } : {}),
    ...(capability.blobs ? { blobs: capability.blobs } : {}),
  };
}

function catalogWorkflows(modules: readonly CapabilityModule[], ids: ReadonlySet<string>) {
  const workflowIds = new Set<string>();
  return modules
    .flatMap((module) => module.workflows ?? [])
    .map((workflow) => {
      if (workflowIds.has(workflow.id)) throw new Error(`Duplicate workflow: ${workflow.id}`);
      workflowIds.add(workflow.id);
      for (const id of workflow.operations)
        if (!ids.has(id))
          throw new Error(`Workflow ${workflow.id} references unknown operation ${id}`);
      return workflow;
    })
    .sort(byId);
}

export function buildCatalog(
  modules: readonly CapabilityModule[],
  options: BuildCatalogOptions = {},
): Catalog {
  const moduleIds = checkModules(modules, options.components ?? []);
  const requirements = collectRequirements([...modules, ...(options.components ?? [])]);
  const seen = { ids: new Set<string>(), mcpNames: new Set<string>() };
  const operations: CatalogOperation[] = [];
  for (const module of modules) {
    for (const required of module.requires ?? [])
      if (!moduleIds.has(required))
        throw new Error(`Module ${module.id} requires missing module ${required}`);
    for (const capability of module.capabilities) {
      const mcpName = checkNaming(capability, seen);
      const destinations = [
        ...integrationDestinations(capability, requirements),
        ...remoteDestinations(capability, requirements),
      ];
      checkAuditFields(capability);
      checkBlobLimits(capability);
      operations.push(catalogOperation(capability, module.id, mcpName, destinations));
    }
  }
  const catalog: Catalog = {
    formatVersion: 1,
    operations: operations.sort(byId),
    workflows: catalogWorkflows(modules, seen.ids),
    agents: catalogAgents(
      modules,
      new Map(operations.map((operation) => [operation.id, operation])),
    ),
    requirements,
  };
  // Copy metadata so later application mutations cannot silently alter a built catalog.
  return JSON.parse(canonicalJson(catalog)) as Catalog;
}
