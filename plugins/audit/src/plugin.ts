import { defineHostPlugin } from '@tortoise/host/plugin';
import { auditCliCommand } from './cli';
import { openAudit } from './open';
import { auditPluginManifest } from './plugin-manifest';

/**
 * The audit plugin. It provides the kernel's event-log port: a hash-chained log in the site
 * policy's audit mode, forwarded off the host when the policy says so. Its `ready` attests and
 * recovers, and it adds `audit verify`. An application without it keeps no audit log.
 */
export const auditPlugin = defineHostPlugin({
  manifest: auditPluginManifest,
  requires: ['site'],
  commands: [auditCliCommand],
  open: openAudit,
});
