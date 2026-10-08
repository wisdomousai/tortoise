import { defineHostComponent } from '@agent-native/contracts';
import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/** The off-host audit forwarder's destination; bound by `audit.forwardTo` in the site policy. */
export const auditCollectorComponent = defineHostComponent({
  id: 'security',
  description: 'Security plugin: forwards audit events off the host as RFC 5424 syslog.',
  requirements: {
    network: [
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

/**
 * The browser-safe part of the security plugin: the forwarder's declared destination and the
 * two launcher settings it reads. It adds no capability module; auditors read the log through
 * the assurance plugin.
 */
export const securityPluginManifest = definePluginManifest({
  id: 'security',
  title: 'Security',
  components: [auditCollectorComponent],
  settings: [
    {
      key: 'site-policy',
      env: 'AGENT_NATIVE_SITE_POLICY',
      kind: 'path',
      description: 'bind declared destinations; absent: isolated',
    },
    {
      key: 'audit-log',
      env: 'AGENT_NATIVE_AUDIT_LOG',
      kind: 'path',
      description: 'audit event log directory; default <workspace>/audit',
    },
  ],
});
