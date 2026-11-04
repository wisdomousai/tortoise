import { buildCatalog, type CatalogRequirements, type HostComponent } from '@tortoise/contracts';
import type { ApplicationManifest } from './manifest';

/**
 * Components of one deployment: the host's own on its platform (`hostComponents`, such as the Bun
 * host's listener) followed by the application's and its plugins' (`manifest.components`).
 */
export function deploymentComponents(
  manifest: ApplicationManifest,
  hostComponents: readonly HostComponent[] = [],
) {
  return [...hostComponents, ...(manifest.components ?? [])];
}

/**
 * The catalog of one deployment: the application's modules plus the host's and the
 * application's components. The runtime, the site-policy check, the CLI and the generators all
 * compose requirements through this, so they cannot disagree. Pure: opens nothing.
 */
export function deploymentCatalog(
  manifest: ApplicationManifest,
  hostComponents: readonly HostComponent[] = [],
) {
  return buildCatalog(manifest.modules, {
    components: deploymentComponents(manifest, hostComponents),
  });
}

/** Requirements of one deployment: the application's, its plugins' and the host's. */
export const deploymentRequirements = (
  manifest: ApplicationManifest,
  hostComponents: readonly HostComponent[] = [],
): CatalogRequirements => deploymentCatalog(manifest, hostComponents).requirements;
