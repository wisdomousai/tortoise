import { buildCatalog, defineHostComponent } from '@agent-native/contracts';
import { providerComponents } from '@agent-native/agents/requirements';
import type { ApplicationManifest } from './manifest';

/**
 * The generic host's own requirements: its listener and the audit forwarder. Pure data; every
 * application the host runs inherits them (P13).
 */
export const authorityComponent = defineHostComponent({
  id: 'authority',
  description: 'Local authority service: HTTP/SSE API, MCP attach and audit forwarding.',
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
      {
        id: 'audit-collector',
        purpose: 'Forward audit events off the host (RFC 5424 syslog over TLS).',
        direction: 'egress',
        scope: 'site',
        protocol: 'tcp',
        dataClasses: ['audit-event'],
        availability: 'optional',
        offline: 'degrade',
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
export function deploymentComponents(manifest: ApplicationManifest) {
  return [...hostComponents, ...(manifest.components ?? [])];
}
