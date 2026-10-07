import { defineHostComponent } from '@agent-native/contracts';
import { providerComponents } from '@agent-native/agents/requirements';

/**
 * The local authority's own requirements: its listener, the audit forwarder and the browser it
 * drives for the station screen bridge. Pure data, like `applicationModules`.
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
    processes: [
      {
        id: 'station-bridge-browser',
        executable: 'chromium (Playwright)',
        purpose: 'Browser that reaches a web-based station HMI for the screen bridge.',
        availability: 'optional',
        network: ['station-screen'],
      },
    ],
  },
});

/** Every non-module component composed by this deployment, in manifest order. */
export const hostComponents = [authorityComponent, ...providerComponents] as const;
