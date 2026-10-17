import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import { connectTarget, type SystemOfRecordPort } from '@agent-native/integration';
import manifest from './manifest';
import { erpTarget, type AsnLine } from './contracts/erp-target';
import { createState, upgradeState, type AppState, type Role } from './domain';
import { erpPort } from './erp-port';
import { appPolicy, createHandlers, type Services } from './server';
// scaffold:imports

export interface ReceivingOptions {
  services?: Services;
  /** People who work in a new workspace besides its owner, who is always an editor. */
  members?: Record<string, Role>;
  /** The ERP port; the exchange folders the site policy binds when omitted. */
  erp?: SystemOfRecordPort<AsnLine>;
  /** How long a notice export must be unchanged before it is imported; 2 s when omitted. */
  quietMs?: number;
  // scaffold:options
}

/**
 * The Goods receiving application with the site, network, audit and compliance plugins. The ERP
 * is reached through exchange folders; until the site policy binds them, notices are not
 * imported and posted receipts wait in the outbox.
 */
export function createReceivingApplication(options: ReceivingOptions = {}) {
  const state = (ownerId: string) => createState(ownerId, options.members);
  return defineApplication<AppState, Services>({
    manifest,
    createState: state,
    upgradeState: (stored, ownerId) => upgradeState(stored, state(ownerId)),
    handlers: createHandlers(),
    authorization: appPolicy,
    plugins: [sitePlugin, networkPlugin, auditPlugin, compliancePlugin],
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId, folders }) => ({
      integrations: [
        connectTarget<AsnLine>({
          target: erpTarget,
          application,
          port:
            options.erp ??
            erpPort(folders, options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
          workspaceId,
          principalId: 'erp-integration',
        }),
        // scaffold:integrations
      ],
    }),
  });
}

export default createReceivingApplication();
