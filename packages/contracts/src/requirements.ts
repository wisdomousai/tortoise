import type { OsDeclarations } from './os';
/**
 * Declared environment requirements: what a module or host component needs from the network,
 * shared folders, attached devices and child processes. Declarations are browser-safe data. They grant nothing by
 * themselves. A deployment binds network destinations in a deployment policy, the network guard enforces
 * only bound declarations, and firewall/hardening exports are generated from the same data, so the
 * reviewed manifest, the in-process guard and the OS rules cannot drift apart.
 *
 * Validation fails closed: unknown references, undeclared outbox or remote-read targets and
 * destinations that would send data without naming its classes are rejected when the catalog is built.
 */

/** Where a destination lives. `local` is a customer network (plant LAN, MES host); never the internet. */
export type NetworkScope = 'loopback' | 'local' | 'internet';
export type NetworkProtocol = 'https' | 'http' | 'wss' | 'ws' | 'tcp' | 'udp';
export type Availability = 'required' | 'optional';
/**
 * What happens while a destination is unbound or unreachable. `queue`: work is captured locally
 * and delivered later (outbox). `degrade`: the feature keeps working with reduced function.
 * `unavailable`: the dependent feature is off and reports why. None of them blocks startup.
 */
export type OfflineBehavior = 'queue' | 'degrade' | 'unavailable';

export interface NetworkDestination {
  /** Stable identifier the deployment policy binds, e.g. `mes-api`. */
  readonly id: string;
  readonly purpose: string;
  readonly direction: 'outbound' | 'inbound';
  readonly scope: NetworkScope;
  readonly protocol: NetworkProtocol;
  /** Fixed port, when the protocol does not imply one or the vendor mandates it. */
  readonly port?: number;
  /**
   * Fixed host name for vendor endpoints (`auth.openai.com`). Local destinations leave it out: the
   * deployment policy supplies the address, so code never embeds customer network names.
   */
  readonly host?: string;
  /** Outbox targets whose effects are sent over this destination. */
  readonly targets?: readonly string[];
  /** Targets whose remote queries read over this destination (`RemoteReadDeclaration`). */
  readonly reads?: readonly string[];
  /**
   * The caller presents a credential there, such as a bearer token or a signed assertion. The
   * policy check then refuses an unencrypted binding off loopback in every profile.
   */
  readonly authenticated?: boolean;
  /** Classes of data sent to this destination, for the data-flow inventory. */
  readonly dataClasses: readonly string[];
  readonly availability: Availability;
  /** Required for outbound destinations. */
  readonly offline?: OfflineBehavior;
}

export type DeviceKind = 'serial' | 'hid' | 'camera' | 'usb' | 'audio' | 'vendor-sdk';
export interface DeviceRequirement {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly purpose: string;
  readonly availability: Availability;
}

export interface ProcessRequirement {
  readonly id: string;
  /** Executable name or deployment-configured command; never a shell string. */
  readonly executable: string;
  readonly purpose: string;
  readonly availability: Availability;
  /** Network destinations the child process may reach. Anything else is an undeclared outbound connection. */
  readonly network?: readonly string[];
  /**
   * Environment variables the deployment supplies from its secret store (a vendor licence, a
   * device password). Names only; values never appear in declarations, policies or manifests.
   */
  readonly secrets?: readonly string[];
  /**
   * Outbox targets whose effects this child process carries over its stdio, such as a hardware
   * driver. A command forwarding to one of them needs no network destination; the catalog records
   * the process instead, so the data-flow manifest shows where its effects go.
   */
  readonly targets?: readonly string[];
}

/**
 * A directory the application exchanges files through, such as a share another system drops
 * result exports into or picks import files up from. Code names the folder, never its path,
 * which only the deployment policy knows.
 */
export interface FolderRequirement {
  readonly id: string;
  readonly purpose: string;
  /** `read`: files other systems write. `write`: files the application writes for others. */
  readonly access: 'read' | 'write' | 'read-write';
  /** Outbox targets whose effects are delivered as files into this folder. */
  readonly targets?: readonly string[];
  /** Classes of data written to or read from this folder, for the data-flow inventory. */
  readonly dataClasses: readonly string[];
  readonly availability: Availability;
}

export interface Requirements {
  readonly network?: readonly NetworkDestination[];
  readonly folders?: readonly FolderRequirement[];
  readonly devices?: readonly DeviceRequirement[];
  readonly processes?: readonly ProcessRequirement[];
}

/**
 * A part of the deployment that is not a capability module but still needs resources: provider
 * harnesses, identity endpoints, the desktop shell, audit forwarders. Packages export these as
 * data from a side-effect-free entry so generators never load SDKs.
 */
export interface HostComponent {
  readonly id: string;
  readonly description: string;
  readonly requirements: Requirements;
  /** OS handlers and actions the component uses, such as opening a provider's sign-in page. */
  readonly os?: OsDeclarations;
}
export function defineHostComponent<const C extends HostComponent>(component: C): C {
  return Object.freeze(component);
}

type Owned<T> = T & { readonly owner: string };
/** Requirements of every composed module and host component, sorted by ID, with their owner. */
export interface CatalogRequirements {
  readonly network: readonly Owned<NetworkDestination>[];
  readonly folders: readonly Owned<FolderRequirement>[];
  readonly devices: readonly Owned<DeviceRequirement>[];
  readonly processes: readonly Owned<ProcessRequirement>[];
}

/** An environment variable name a process secret is supplied under. */
const secretNamePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Validate and merge requirement declarations. Throws on the first violation; the message names
 * the owner and declaration so a reviewer can find it.
 */
export function collectRequirements(
  owners: readonly { readonly id: string; readonly requirements?: Requirements }[],
): CatalogRequirements {
  const network: Owned<NetworkDestination>[] = [];
  const folders: Owned<FolderRequirement>[] = [];
  const devices: Owned<DeviceRequirement>[] = [];
  const processes: Owned<ProcessRequirement>[] = [];
  const seen = {
    network: new Set<string>(),
    folders: new Set<string>(),
    devices: new Set<string>(),
    processes: new Set<string>(),
  };
  const claim = (kind: keyof typeof seen, owner: string, id: string) => {
    if (!idPattern.test(id)) throw new Error(`Invalid ${kind} requirement ID in ${owner}: ${id}`);
    if (seen[kind].has(id)) throw new Error(`Duplicate ${kind} requirement: ${id}`);
    seen[kind].add(id);
  };
  for (const { id: owner, requirements } of owners) {
    for (const destination of requirements?.network ?? []) {
      claim('network', owner, destination.id);
      const where = `network destination ${destination.id} (${owner})`;
      if (!destination.purpose) throw new Error(`Missing purpose for ${where}`);
      if (
        destination.port !== undefined &&
        (!Number.isInteger(destination.port) || destination.port < 1 || destination.port > 65535)
      )
        throw new Error(`Invalid port for ${where}`);
      if (destination.host !== undefined) {
        if (!/^[a-z0-9.\-[\]:]+$/i.test(destination.host))
          throw new Error(`Host must be a bare host name for ${where}`);
        if (destination.scope === 'loopback' && !loopbackHosts.has(destination.host))
          throw new Error(`Loopback ${where} names a non-loopback host`);
      }
      if (destination.direction === 'outbound') {
        if (!destination.offline) throw new Error(`Missing offline behavior for ${where}`);
        // Anything leaving the machine must say what it carries, for the data-flow inventory.
        if (destination.scope !== 'loopback' && destination.dataClasses.length === 0)
          throw new Error(`Missing data classes for ${where}`);
      }
      if (destination.targets?.length) {
        if (destination.direction !== 'outbound')
          throw new Error(`Outbox targets require an outbound destination: ${where}`);
        if (destination.offline !== 'queue')
          throw new Error(`Outbox destination must queue while offline: ${where}`);
      }
      if (destination.reads?.length && destination.direction !== 'outbound')
        throw new Error(`Remote reads require an outbound destination: ${where}`);
      network.push({ ...destination, owner });
    }
    for (const folder of requirements?.folders ?? []) {
      claim('folders', owner, folder.id);
      const where = `folder ${folder.id} (${owner})`;
      if (!folder.purpose) throw new Error(`Missing purpose for ${where}`);
      if (folder.dataClasses.length === 0) throw new Error(`Missing data classes for ${where}`);
      if (folder.targets?.length && folder.access === 'read')
        throw new Error(`Outbox targets require a writable folder: ${where}`);
      folders.push({ ...folder, owner });
    }
    for (const device of requirements?.devices ?? []) {
      claim('devices', owner, device.id);
      devices.push({ ...device, owner });
    }
    for (const child of requirements?.processes ?? []) {
      claim('processes', owner, child.id);
      if (!child.executable) throw new Error(`Missing executable for process ${child.id}`);
      for (const name of child.secrets ?? [])
        if (!secretNamePattern.test(name))
          throw new Error(`Invalid secret variable ${name} for process ${child.id}`);
      processes.push({ ...child, owner });
    }
  }
  for (const child of processes)
    for (const destination of child.network ?? [])
      if (!seen.network.has(destination))
        throw new Error(`Process ${child.id} references undeclared destination ${destination}`);
  return {
    network: network.sort(byId),
    folders: folders.sort(byId),
    devices: devices.sort(byId),
    processes: processes.sort(byId),
  };
}

/** Child processes that carry effects for `target`. */
export function processesForTarget(
  requirements: CatalogRequirements,
  target: string,
): readonly string[] {
  return requirements.processes
    .filter((child) => child.targets?.includes(target))
    .map((child) => child.id);
}

/** Folders that effects for `target` are delivered into as files. */
export function foldersForTarget(
  requirements: CatalogRequirements,
  target: string,
): readonly string[] {
  return requirements.folders
    .filter((folder) => folder.targets?.includes(target))
    .map((folder) => folder.id);
}

/** Destinations that carry effects for `target`. */
export function destinationsForTarget(
  requirements: CatalogRequirements,
  target: string,
): readonly string[] {
  return requirements.network
    .filter((destination) => destination.targets?.includes(target))
    .map((destination) => destination.id);
}

/** Destinations that remote queries of `target` read over. */
export function destinationsForRead(
  requirements: CatalogRequirements,
  target: string,
): readonly string[] {
  return requirements.network
    .filter((destination) => destination.reads?.includes(target))
    .map((destination) => destination.id);
}
