import { defineApplication } from '@tortoise/host/application';
import { mountFeature } from '@tortoise/host/feature';
import {
  approvalFeature,
  reconciliationFeature,
  type ApprovalAccess,
  type ApprovalHooks,
  type ReconciliationAccess,
  type ReconciliationHooks,
} from '@tortoise/runtime';
import { auditPlugin } from '@tortoise/audit/plugin';
import { compliancePlugin } from '@tortoise/compliance/plugin';
import { networkPlugin } from '@tortoise/network/plugin';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import {
  connectPeerTarget,
  connectTarget,
  createPeerCall,
  createPeerDrift,
  createPeerSource,
  peerQuery,
  type SystemOfRecordPort,
} from '@tortoise/integration';
import { createPeerLinkPlugin, peerLinkServiceOf } from '@tortoise/peer-link/plugin';
import { queryOperations as qualityQueries } from '@tortoise/quality-inspection/contracts/queries';
import { approvalOperations } from '@tortoise/contracts';
import manifest from './manifest';
import { operations } from './contracts';
import { erpTarget, type AsnLine } from './contracts/erp-target';
import { qualityLots, qualityPeer } from './contracts/quality-peer';
import { createState, migrations, upgradeState, type AppState, type Role } from './domain';
import { erpPort } from './erp-port';
import { newId, now } from './handlers/context';
import type { ClosedInspectionRequest } from '@tortoise/quality-inspection/contracts/peer';
import {
  appPolicy,
  approvalAccess,
  createHandlers,
  onReceiptResolved,
  reconciliationAccess,
  type Services,
} from './server';
// scaffold:imports

export interface ReceivingOptions {
  services?: Services;
  /** People who work in a new workspace besides its owner, who is always an editor. */
  members?: Record<string, Role>;
  /** The ERP port; the exchange folders the deployment policy binds when omitted. */
  erp?: SystemOfRecordPort<AsnLine>;
  /** How long a notice export must be unchanged before it is imported; 2 s when omitted. */
  quietMs?: number;
  // scaffold:options
}

/** The peer link calling quality inspection; its peers screen connects it with a code. */
export const receivingPeerLinkPlugin = createPeerLinkPlugin({ targets: [qualityPeer] });

/**
 * The Goods receiving application with the approval and reconciliation features and the deployment,
 * network, audit, compliance and peer link plugins. The ERP is reached through exchange
 * folders; until the deployment policy binds them, notices are not imported and posted receipts wait
 * in the outbox. Quality inspection is reached as a peer; until it is connected, inspection requests wait
 * in the outbox and lot searches report it unavailable.
 */
export function createReceivingApplication(options: ReceivingOptions = {}) {
  const state = (ownerId: string) => createState(ownerId, options.members);
  return defineApplication<AppState, Services>({
    manifest,
    createState: state,
    migrations,
    upgradeState: (stored, ownerId) => upgradeState(stored, state(ownerId)),
    handlers: createHandlers(),
    authorization: appPolicy,
    features: [
      mountFeature<AppState, ApprovalAccess, ApprovalHooks, Services>(approvalFeature(), {
        access: approvalAccess,
        hooks: { newId, now },
        // Version 1 kept approval requests in the application's own `approvals`.
        adopt: {
          before: 2,
          from: (stored) => ({ requests: (stored as { approvals?: object }).approvals ?? {} }),
        },
      }),
      mountFeature<AppState, ReconciliationAccess, ReconciliationHooks, Services>(
        reconciliationFeature(),
        { access: reconciliationAccess, hooks: { onResolved: onReceiptResolved } },
      ),
    ],
    plugins: [
      deploymentPlugin,
      networkPlugin,
      auditPlugin,
      compliancePlugin,
      receivingPeerLinkPlugin,
    ],
    // The records a screen may hand to an agent run, such as the line the assistant panel sees.
    selectableResources: {
      delivery: operations.deliveryGet.id,
      'approval-request': approvalOperations.approvalGet.id,
    },
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId, folders, services }) => {
      const link = () => peerLinkServiceOf(services)!.link(qualityPeer.target);
      // One comparison with quality inspection's contract for deliveries and reads alike.
      const drift = createPeerDrift({
        api: qualityPeer.api,
        contract: () => createPeerCall({ client: () => link().client() }).contract(),
      });
      return {
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
          connectPeerTarget<ClosedInspectionRequest>({
            target: qualityPeer,
            application,
            workspaceId,
            principalId: 'quality-integration',
            link,
            drift,
            readBlob: (effect, digest) =>
              application.readEffectBlob(workspaceId, effect.id, digest),
            reference: (result) => (result as { id: string }).id,
          }),
          // scaffold:integrations
        ],
        sources: {
          [qualityPeer.target]: createPeerSource({
            target: qualityPeer.target,
            link,
            drift,
            reads: {
              // The lot list pages by offset, so a search returns its first page only.
              [qualityLots.search.id]: peerQuery(
                qualityQueries.lotList,
                (query) => ({ search: String(query.q), limit: 50 }),
                (data) => (data as { items: unknown[] }).items,
              ),
              [qualityLots.lookup.id]: peerQuery(qualityQueries.lotGet, (query) => ({
                id: String(query.externalId),
              })),
            },
          }),
        },
      };
    },
  });
}

export default createReceivingApplication();
