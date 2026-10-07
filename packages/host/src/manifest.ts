import type { CapabilityModule, HostComponent } from '@agent-native/contracts';

/**
 * The browser-safe identity of one application: a stable id, a title and the capability modules
 * it composes. Generators, the UI-binding check and the web frame read it without loading
 * handlers, storage, services or provider code, so this file must stay import-free of host code.
 */
export interface ApplicationManifest<
  Modules extends readonly CapabilityModule[] = readonly CapabilityModule[],
> {
  /** Lowercase id; names the generated reference directory, the web build and the dev workspace. */
  readonly id: string;
  /** Human title shown by the frame when the starter's identity does not override it. */
  readonly title: string;
  readonly modules: Modules;
  /**
   * Non-module parts this application brings, such as a screen bridge or device drivers, with
   * the network destinations, devices and processes they need. The host adds its own; the
   * composed requirements are what a site policy binds (P13). Pure data.
   */
  readonly components?: readonly HostComponent[];
}

/**
 * Declare an application manifest. Literal module types are preserved for typed clients.
 * Fails at definition time on an invalid id or a module listed twice.
 */
export function defineManifest<const Modules extends readonly CapabilityModule[]>(
  manifest: ApplicationManifest<Modules>,
): ApplicationManifest<Modules> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(manifest.id))
    throw new Error(`Invalid application id "${manifest.id}"`);
  const ids = manifest.modules.map((module) => module.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Module "${duplicate}" is composed twice`);
  return Object.freeze(manifest);
}
