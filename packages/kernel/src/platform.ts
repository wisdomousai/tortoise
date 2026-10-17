import type { CatalogRequirements, HostComponent } from '@agent-native/contracts';
import type { Storage } from '@agent-native/runtime';
import type { AnyApplicationDefinition } from './application';
import type { IngressPort } from './plugin';
import type { PlatformId } from './plugin-manifest';

export { platformIds, type PlatformId } from './plugin-manifest';

/**
 * What a platform can do beyond running JavaScript. `sockets`: raw TCP or UDP connections.
 * `child-process`: spawning executables. `ingress`: listening for connections, even on loopback.
 */
export type PlatformCapability = 'sockets' | 'child-process' | 'ingress';

/** Exclusive ownership of one workspace; released once, by its holder. */
export interface PlatformOwnership {
  /** The workspace location after resolving aliases; plugins and storage use this one. */
  readonly canonicalPath: string;
  /** Unique per acquisition; names this authority instance in audit records. */
  readonly instance: string;
  release(): Promise<void>;
}

/**
 * Everything the kernel needs from the machine it runs on. The kernel itself uses no Node, Bun or
 * React Native API; a platform supplies ownership, storage and the host's own requirements.
 *
 * Trust boundary: a platform is trusted host code chosen by the starter, never by content.
 */
export interface HostPlatform {
  readonly id: PlatformId;
  readonly capabilities: ReadonlySet<PlatformCapability>;
  /**
   * Requirements of the host itself on this platform, such as the Bun host's HTTP listener and
   * agent providers. They join every deployment's catalog next to the application's components.
   */
  readonly components: readonly HostComponent[];
  /** The listener used when no plugin provides the ingress port. Absent: listening is refused. */
  readonly ingress?: IngressPort;
  /**
   * Exclusive ownership of `workspacePath`, so one writer exists per workspace across processes.
   * Rejects when another live authority owns it.
   */
  acquireOwnership(workspacePath: string): Promise<PlatformOwnership>;
  /** The workspace's snapshot storage. A new workspace starts from the definition's state. */
  openStorage(
    definition: AnyApplicationDefinition,
    ownership: PlatformOwnership,
  ): Storage<unknown> & { close(): Promise<void> };
}

/**
 * Refuse a deployment whose declared requirements this platform cannot meet: a socket
 * destination without `sockets`, a child process without `child-process`, an ingress destination
 * without `ingress`. Fails before any plugin opens, naming the owner of each requirement, so a
 * component never starts believing it has a facility the platform lacks.
 */
export function assertPlatformSupports(
  platform: Pick<HostPlatform, 'id' | 'capabilities'>,
  requirements: CatalogRequirements,
) {
  const missing: string[] = [];
  const need = (capability: PlatformCapability, what: string) => {
    if (!platform.capabilities.has(capability)) missing.push(`${what} needs ${capability}`);
  };
  for (const destination of requirements.network) {
    if (destination.protocol === 'tcp' || destination.protocol === 'udp')
      need('sockets', `${destination.owner} destination ${destination.id}`);
    if (destination.direction === 'ingress')
      need('ingress', `${destination.owner} destination ${destination.id}`);
  }
  for (const child of requirements.processes)
    need('child-process', `${child.owner} process ${child.id}`);
  if (missing.length)
    throw new Error(`Platform "${platform.id}" cannot run this deployment: ${missing.join('; ')}`);
}
