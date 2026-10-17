import type {
  Catalog,
  DeviceRequirement,
  FolderRequirement,
  HostComponent,
  NetworkDestination,
  ProcessRequirement,
} from '@agent-native/contracts';
import { osManifest, osTables, type OsManifest } from './os-manifest';

/** One operation's path off the host: which destinations its effects reach, carrying what. */
export interface DataFlow {
  readonly operation: string;
  readonly kind: 'command' | 'query';
  readonly module: string;
  readonly target: string;
  /** `outbox`: forwarded after commit. `remote-read`: the request goes out when called; nothing is stored. */
  readonly path: 'outbox' | 'remote-read';
  readonly destinations: readonly string[];
  /** Child processes that carry the effects instead, such as a hardware driver over its stdio. */
  readonly processes?: readonly string[];
  /** Exchange folders the effects are written into as files. */
  readonly folders?: readonly string[];
  readonly dataClasses: readonly string[];
  /** Input fields recorded in plain text in the audit log; all others only as a digest. */
  readonly auditFields: readonly string[];
}

export interface SecurityManifest {
  readonly format: 1;
  readonly application: string;
  readonly owners: readonly {
    readonly id: string;
    readonly kind: 'module' | 'component';
    readonly description?: string;
  }[];
  readonly network: readonly (NetworkDestination & { readonly owner: string })[];
  readonly devices: readonly (DeviceRequirement & { readonly owner: string })[];
  readonly processes: readonly (ProcessRequirement & { readonly owner: string })[];
  readonly folders: readonly (FolderRequirement & { readonly owner: string })[];
  readonly flows: readonly DataFlow[];
  /** OS handlers (local ingress) and OS actions (local egress). See `OsManifest`. */
  readonly os: OsManifest;
  readonly summary: {
    readonly egress: number;
    readonly ingress: number;
    readonly internet: readonly string[];
    /**
     * Site-scoped destinations, folders and devices: what only a host on the site can reach. An
     * empty list means nothing declared pins the application to the site.
     */
    readonly site: readonly string[];
    readonly required: readonly string[];
    readonly dataClasses: readonly string[];
  };
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/**
 * The reviewable statement of everything the composed deployment may touch: every declared
 * network destination, exchange folder, device and child process with its owner, and every operation whose
 * effects leave the host. Pure and deterministic, so `bun run generate` can drift-check it.
 * It describes declarations, not a site's bindings; `network export` applies a site policy.
 */
export function securityManifest(options: {
  readonly application: string;
  readonly catalog: Catalog;
  readonly components?: readonly HostComponent[];
}): SecurityManifest {
  const { catalog } = options;
  const { network, devices, processes } = catalog.requirements;
  // Catalogs recorded before folders were declarable have none.
  const folders = catalog.requirements.folders ?? [];
  const byId = new Map(network.map((destination) => [destination.id, destination]));
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const components = new Map((options.components ?? []).map((item) => [item.id, item]));
  const owners = sorted([
    ...catalog.operations.map((operation) => operation.module),
    ...network.map((item) => item.owner),
    ...devices.map((item) => item.owner),
    ...processes.map((item) => item.owner),
    ...folders.map((item) => item.owner),
    ...components.keys(),
  ]).map((id) =>
    components.has(id)
      ? { id, kind: 'component' as const, description: components.get(id)!.description }
      : { id, kind: 'module' as const },
  );
  const os = osManifest(catalog);
  const flows = catalog.operations
    .filter(
      (operation) =>
        (operation.integration || operation.remote) &&
        (operation.destinations?.length ||
          operation.processes?.length ||
          operation.folders?.length),
    )
    .map((operation) => ({
      operation: operation.id,
      kind: operation.kind,
      module: operation.module,
      target: (operation.integration ?? operation.remote)!.target,
      path: operation.integration ? ('outbox' as const) : ('remote-read' as const),
      destinations: [...(operation.destinations ?? [])],
      ...(operation.processes?.length ? { processes: [...operation.processes] } : {}),
      ...(operation.folders?.length ? { folders: [...operation.folders] } : {}),
      dataClasses: sorted([
        ...(operation.destinations ?? []).flatMap((id) => byId.get(id)?.dataClasses ?? []),
        ...(operation.folders ?? []).flatMap((id) => folderById.get(id)?.dataClasses ?? []),
      ]),
      auditFields: [...(operation.audit?.fields ?? [])],
    }));
  return {
    format: 1,
    application: options.application,
    owners,
    network: [...network],
    devices: [...devices],
    processes: [...processes],
    folders: [...folders],
    flows,
    os,
    summary: {
      egress: network.filter((item) => item.direction === 'egress').length,
      ingress: network.filter((item) => item.direction === 'ingress').length,
      internet: sorted(network.filter((item) => item.scope === 'internet').map((item) => item.id)),
      site: sorted([
        ...network.filter((item) => item.scope === 'site').map((item) => item.id),
        ...folders.map((item) => item.id),
        ...devices.map((item) => item.id),
      ]),
      required: sorted(
        [...network, ...folders]
          .filter((item) => item.availability === 'required')
          .map((item) => item.id),
      ),
      dataClasses: sorted([
        ...network.flatMap((item) => item.dataClasses),
        ...folders.flatMap((item) => item.dataClasses),
        ...os.actions.flatMap((item) => item.dataClasses),
      ]),
    },
  };
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const node = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_');

/** The Mermaid flowchart: destinations grouped by scope, then flows and child processes. */
function flowDiagram(manifest: SecurityManifest): string[] {
  const scopes = ['loopback', 'site', 'internet'] as const;
  const lines = [
    '```mermaid',
    'flowchart LR',
    `  app["${manifest.application} (local authority)"]`,
  ];
  for (const scope of scopes) {
    const members = manifest.network.filter((item) => item.scope === scope);
    if (!members.length) continue;
    lines.push(`  subgraph ${scope}["${scope}"]`);
    for (const item of members) lines.push(`    ${node(item.id)}["${item.id}"]`);
    lines.push('  end');
  }
  for (const item of manifest.network) {
    const label = item.dataClasses.length ? item.dataClasses.join(', ') : item.protocol;
    lines.push(
      item.direction === 'egress'
        ? `  app -- "${label}" --> ${node(item.id)}`
        : `  ${node(item.id)} -- "${label}" --> app`,
    );
  }
  for (const folder of manifest.folders) {
    const label = folder.dataClasses.join(', ');
    const id = `folder_${node(folder.id)}[("${folder.id}")]`;
    if (folder.access !== 'read') lines.push(`  app -- "${label}" --> ${id}`);
    if (folder.access !== 'write') lines.push(`  ${id} -- "${label}" --> app`);
  }
  for (const process of manifest.processes) {
    lines.push(`  app -. spawns .-> proc_${node(process.id)}(["${process.id}"])`);
    for (const id of process.network ?? [])
      lines.push(`  proc_${node(process.id)} -. may reach .-> ${node(id)}`);
  }
  lines.push('```', '');
  return lines;
}

function destinationTables(manifest: SecurityManifest): string[] {
  return [
    '## Network destinations',
    '',
    '| ID | Owner | Direction | Scope | Protocol | Host | Data classes | Availability | Offline |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...manifest.network.map(
      (item) =>
        `| \`${item.id}\` | ${item.owner} | ${item.direction} | ${item.scope} | ${item.protocol}${item.port ? `:${item.port}` : ''} | ${item.host ?? 'site policy'} | ${cell(item.dataClasses.join(', ') || '—')} | ${item.availability} | ${item.offline ?? '—'} |`,
    ),
    '',
    ...manifest.network.map((item) => `- \`${item.id}\`: ${cell(item.purpose)}`),
    '',
    '## Operations that leave the host',
    '',
    'An `outbox` operation is committed locally first and forwarded through the outbox; a receipt proves the local commit, not acceptance by the target. A `remote-read` query sends its request to the target when called, with the caller’s credential, and stores nothing it receives.',
    '',
    '| Operation | Target | Path | Destinations | Data classes | Audited fields |',
    '| --- | --- | --- | --- | --- | --- |',
    ...manifest.flows.map(
      (flow) =>
        `| \`${flow.operation}\` | ${flow.target} | ${flow.path} | ${[
          ...flow.destinations.map((id) => `\`${id}\``),
          ...(flow.processes ?? []).map((id) => `process \`${id}\``),
          ...(flow.folders ?? []).map((id) => `folder \`${id}\``),
        ].join(
          ', ',
        )} | ${cell(flow.dataClasses.join(', '))} | ${flow.auditFields.join(', ') || 'digest only'} |`,
    ),
    '',
  ];
}

function deviceAndProcessTables(manifest: SecurityManifest): string[] {
  const lines: string[] = [];
  if (manifest.folders.length)
    lines.push(
      '## Exchange folders',
      '',
      'The site policy binds each folder to a directory; code reaches only bound folders, through the folder port.',
      '',
      '| ID | Owner | Access | Data classes | Availability | Purpose |',
      '| --- | --- | --- | --- | --- | --- |',
      ...manifest.folders.map(
        (item) =>
          `| \`${item.id}\` | ${item.owner} | ${item.access} | ${cell(item.dataClasses.join(', '))} | ${item.availability} | ${cell(item.purpose)} |`,
      ),
      '',
    );
  if (manifest.devices.length)
    lines.push(
      '## Devices',
      '',
      '| ID | Owner | Kind | Availability | Purpose |',
      '| --- | --- | --- | --- | --- |',
      ...manifest.devices.map(
        (item) =>
          `| \`${item.id}\` | ${item.owner} | ${item.kind} | ${item.availability} | ${cell(item.purpose)} |`,
      ),
      '',
    );
  if (manifest.processes.length)
    lines.push(
      '## Child processes',
      '',
      'A child may reach only the destinations listed here. Children launched with proxy settings tunnel through the audited loopback proxy, which enforces this list; any child that does not use the proxy is contained only by the exported OS rules.',
      '',
      '| ID | Owner | Executable | May reach | Purpose |',
      '| --- | --- | --- | --- | --- |',
      ...manifest.processes.map(
        (item) =>
          `| \`${item.id}\` | ${item.owner} | \`${item.executable}\` | ${(item.network ?? []).map((id) => `\`${id}\``).join(', ') || 'nothing'} | ${cell(item.purpose)} |`,
      ),
      '',
    );
  return lines;
}

/**
 * Data-flow document for reviewers: a Mermaid diagram grouped by network scope, then tables of
 * destinations, operations that leave the host, exchange folders, devices and child processes.
 */
export function dataFlowsMarkdown(manifest: SecurityManifest): string {
  return [
    '# Data flows',
    '',
    `Generated by \`bun run generate\` from the declarations composed into \`${manifest.application}\`. A site policy decides which of these are bound; nothing here is reachable until it is.`,
    '',
    ...flowDiagram(manifest),
    ...destinationTables(manifest),
    ...deviceAndProcessTables(manifest),
    ...osTables(manifest.os),
  ].join('\n');
}
