import { defineHostComponent, type CatalogRequirements } from '@agent-native/contracts';
import { providerComponents } from '@agent-native/agents/requirements';
import {
  deploymentCatalog as kernelCatalog,
  deploymentComponents as kernelComponents,
} from '@agent-native/kernel/components';
import type { ApplicationManifest } from '@agent-native/kernel/manifest';

/**
 * The generic host's own requirement: its listener. Pure data; every application the host runs
 * inherits it. Plugins declare their own in their manifests.
 */
export const hostComponent = defineHostComponent({
  id: 'host',
  description: 'Local host: HTTP/SSE API and MCP attach.',
  requirements: {
    network: [
      {
        id: 'host-http',
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

/** Components the Bun host composes into every application: itself and the agent providers. */
export const hostComponents = [hostComponent, ...providerComponents] as const;

/**
 * The catalog of one deployment on the Bun host: the application's modules plus the host's
 * components and the application's own (`manifest.components`). Generators, the site-policy check
 * and the CLI use this; the kernel builds the same catalog from the platform's components.
 */
export const deploymentCatalog = (manifest: ApplicationManifest) =>
  kernelCatalog(manifest, hostComponents);
/** Requirements of one deployment on the Bun host: the application's, its plugins' and the host's. */
export const deploymentRequirements = (manifest: ApplicationManifest): CatalogRequirements =>
  kernelCatalog(manifest, hostComponents).requirements;
export const deploymentComponents = (manifest: ApplicationManifest) =>
  kernelComponents(manifest, hostComponents);
