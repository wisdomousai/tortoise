import { assertBlobLimits, type BlobLimits } from './blob';
import type {
  AnyCapability,
  CapabilityModule,
  IntegrationDeclaration,
  PermissionRequirement,
  RemoteReadDeclaration,
} from './capability';
import { catalogAgents, type CatalogAgent } from './agent';
import { composeInvokes } from './invokes';
import type { CatalogWorkflow } from './workflow';
import { catalogWorkflow } from './workflow-catalog';
import { canonicalJson, type JsonObject } from './json';
import { collectOs, osActionTargets, type CatalogOs } from './os-catalog';
import {
  collectRequirements,
  destinationsForRead,
  destinationsForTarget,
  foldersForTarget,
  processesForTarget,
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
  /** Child processes that carry the operation's outbox target, such as a hardware driver. */
  readonly processes?: readonly string[];
  /** Folders the operation's outbox target is delivered into as files. */
  readonly folders?: readonly string[];
  readonly audit?: { readonly fields?: readonly string[] };
  readonly blobs?: BlobLimits;
  /**
   * The operations its handler may call inside its transaction, or `any`. Its destinations,
   * processes and folders include those of everything the list reaches.
   */
  readonly invokes?: readonly string[] | 'any';
}
export interface Catalog {
  readonly formatVersion: 1;
  readonly operations: readonly CatalogOperation[];
  readonly requirements: CatalogRequirements;
  /** Prose workflows for agents, and declared workflows with the steps the workflows plugin runs. */
  readonly workflows: readonly CatalogWorkflow[];
  /** Agent definitions with their module, sorted by ID. */
  readonly agents: readonly CatalogAgent[];
  /** OS handlers and actions; absent when nothing is declared. */
  readonly os?: CatalogOs;
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
  osTargets: ReadonlySet<string>,
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
  // A target may instead be carried by a queueing OS action, such as a local notification, by
  // a declared child process, such as a hardware driver, or by files dropped into a folder.
  if (
    capability.integration &&
    destinations.length === 0 &&
    !osTargets.has(capability.integration.target) &&
    processesForTarget(requirements, capability.integration.target).length === 0 &&
    foldersForTarget(requirements, capability.integration.target).length === 0
  )
    throw new Error(
      `Outbox target ${capability.integration.target} has no declared network destination, folder or process: ${capability.id}`,
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
  processes: readonly string[],
  folders: readonly string[],
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
    ...(processes.length ? { processes } : {}),
    ...(folders.length ? { folders } : {}),
    ...(capability.audit ? { audit: capability.audit } : {}),
    ...(capability.blobs ? { blobs: capability.blobs } : {}),
    ...(capability.invokes ? { invokes: capability.invokes } : {}),
  };
}

function catalogWorkflows(
  modules: readonly CapabilityModule[],
  operations: readonly CatalogOperation[],
) {
  const workflowIds = new Set<string>();
  return modules
    .flatMap((module) => module.workflows ?? [])
    .map((workflow) => {
      if (workflowIds.has(workflow.id)) throw new Error(`Duplicate workflow: ${workflow.id}`);
      workflowIds.add(workflow.id);
      return catalogWorkflow(workflow, operations);
    })
    .sort(byId);
}

export function buildCatalog(
  modules: readonly CapabilityModule[],
  options: BuildCatalogOptions = {},
): Catalog {
  const moduleIds = checkModules(modules, options.components ?? []);
  const requirements = collectRequirements([...modules, ...(options.components ?? [])]);
  const os = collectOs([...modules, ...(options.components ?? [])], modules);
  const seen = { ids: new Set<string>(), mcpNames: new Set<string>() };
  const operations: CatalogOperation[] = [];
  for (const module of modules) {
    for (const required of module.requires ?? [])
      if (!moduleIds.has(required))
        throw new Error(`Module ${module.id} requires missing module ${required}`);
    for (const capability of module.capabilities) {
      const mcpName = checkNaming(capability, seen);
      const destinations = [
        ...integrationDestinations(capability, requirements, osActionTargets(os)),
        ...remoteDestinations(capability, requirements),
      ];
      const target = capability.integration?.target;
      const processes = target ? processesForTarget(requirements, target) : [];
      const folders = target ? foldersForTarget(requirements, target) : [];
      checkAuditFields(capability);
      checkBlobLimits(capability);
      operations.push(
        catalogOperation(capability, module.id, mcpName, destinations, processes, folders),
      );
    }
  }
  const composed = composeInvokes(operations.sort(byId));
  const catalog: Catalog = {
    formatVersion: 1,
    operations: composed,
    workflows: catalogWorkflows(modules, composed),
    agents: catalogAgents(modules, new Map(composed.map((operation) => [operation.id, operation]))),
    requirements,
    ...(os ? { os } : {}),
  };
  // Copy metadata so later application mutations cannot silently alter a built catalog.
  return JSON.parse(canonicalJson(catalog)) as Catalog;
}
