import type { OsDeclarations } from './os';
/**
 * Declared environment requirements: what a module or host component needs from the network,
 * attached devices and child processes. Declarations are browser-safe data. They grant nothing by
 * themselves. A deployment binds network destinations in a site policy, the egress guard enforces
 * only bound declarations, and firewall/hardening exports are generated from the same data, so the
 * reviewed manifest, the in-process guard and the OS rules cannot drift apart.
 *
 * Validation fails closed: unknown references, undeclared outbox or remote-read targets and
 * destinations that would send data without naming its classes are rejected when the catalog is built.
 */

/** Where a destination lives. `site` is a customer network (plant LAN, MES host); never the internet. */
export type NetworkScope = 'loopback' | 'site' | 'internet';
export type NetworkProtocol = 'https' | 'http' | 'wss' | 'ws' | 'tcp' | 'udp';
export type Availability = 'required' | 'optional';
/**
 * What happens while a destination is unbound or unreachable. `queue`: work is captured locally
 * and delivered later (outbox). `degrade`: the feature keeps working with reduced function.
 * `unavailable`: the dependent feature is off and reports why. None of them blocks startup.
 */
export type OfflineBehavior = 'queue' | 'degrade' | 'unavailable';

export interface NetworkDestination {
  /** Stable identifier the site policy binds, e.g. `mes-api`. */
  readonly id: string;
  readonly purpose: string;
  readonly direction: 'egress' | 'ingress';
  readonly scope: NetworkScope;
  readonly protocol: NetworkProtocol;
  /** Fixed port, when the protocol does not imply one or the vendor mandates it. */
  readonly port?: number;
  /**
   * Fixed host name for vendor endpoints (`auth.openai.com`). Site destinations leave it out: the
   * site policy supplies the address, so code never embeds customer network names.
   */
  readonly host?: string;
  /** Outbox targets whose effects travel over this destination. */
  readonly targets?: readonly string[];
  /** Targets whose remote queries read over this destination (`RemoteReadDeclaration`). */
  readonly reads?: readonly string[];
  /** Classes of data sent to this destination, for the data-flow inventory. */
  readonly dataClasses: readonly string[];
  readonly availability: Availability;
  /** Required for egress destinations. */
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
  /** Network destinations the child process may reach. Anything else is undeclared egress. */
  readonly network?: readonly string[];
}

export interface Requirements {
  readonly network?: readonly NetworkDestination[];
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
  readonly devices: readonly Owned<DeviceRequirement>[];
  readonly processes: readonly Owned<ProcessRequirement>[];
}

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
  const devices: Owned<DeviceRequirement>[] = [];
  const processes: Owned<ProcessRequirement>[] = [];
  const seen = {
    network: new Set<string>(),
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
      if (destination.direction === 'egress') {
        if (!destination.offline) throw new Error(`Missing offline behavior for ${where}`);
        // Anything leaving the machine must say what it carries, for the data-flow inventory.
        if (destination.scope !== 'loopback' && destination.dataClasses.length === 0)
          throw new Error(`Missing data classes for ${where}`);
      }
      if (destination.targets?.length) {
        if (destination.direction !== 'egress')
          throw new Error(`Outbox targets require an egress destination: ${where}`);
        if (destination.offline !== 'queue')
          throw new Error(`Outbox destination must queue while offline: ${where}`);
      }
      if (destination.reads?.length && destination.direction !== 'egress')
        throw new Error(`Remote reads require an egress destination: ${where}`);
      network.push({ ...destination, owner });
    }
    for (const device of requirements?.devices ?? []) {
      claim('devices', owner, device.id);
      devices.push({ ...device, owner });
    }
    for (const child of requirements?.processes ?? []) {
      claim('processes', owner, child.id);
      if (!child.executable) throw new Error(`Missing executable for process ${child.id}`);
      processes.push({ ...child, owner });
    }
  }
  for (const child of processes)
    for (const destination of child.network ?? [])
      if (!seen.network.has(destination))
        throw new Error(`Process ${child.id} references undeclared destination ${destination}`);
  return {
    network: network.sort(byId),
    devices: devices.sort(byId),
    processes: processes.sort(byId),
  };
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
