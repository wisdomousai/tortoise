import {
  buildCatalog,
  defineHostComponent,
  type CatalogRequirements,
} from '@agent-native/contracts';
import { providerComponents } from '@agent-native/agents/requirements';
import type { ApplicationManifest } from './manifest';

/**
 * The generic host's own requirement: its listener. Pure data; every application the host runs
 * inherits it. Plugins declare their own in their manifests.
 */
export const authorityComponent = defineHostComponent({
  id: 'authority',
  description: 'Local authority service: HTTP/SSE API and MCP attach.',
  requirements: {
    network: [
      {
        id: 'authority-http',
        purpose: 'Serve the frontend, API, events and attach connections.',
        direction: 'ingress',
        scope: 'loopback',
        protocol: 'http',
        dataClasses: [],
        availability: 'required',
      },
    ],
  },
});

/** Components the host composes into every application: itself and the agent providers. */
export const hostComponents = [authorityComponent, ...providerComponents] as const;

/**
 * The catalog of one deployment: the application's modules plus the host's components and the
 * application's own (`manifest.components`). The runtime, the site-policy check, the CLI and the
 * generators all compose requirements through this, so they cannot disagree. Pure: opens nothing.
 */
export function deploymentCatalog(manifest: ApplicationManifest) {
  return buildCatalog(manifest.modules, { components: deploymentComponents(manifest) });
}
/** Requirements of one deployment: the application's, its plugins' and the host's. */
export const deploymentRequirements = (manifest: ApplicationManifest): CatalogRequirements =>
  deploymentCatalog(manifest).requirements;
export function deploymentComponents(manifest: ApplicationManifest) {
  return [...hostComponents, ...(manifest.components ?? [])];
}
