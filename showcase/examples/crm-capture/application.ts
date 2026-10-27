import { connectTarget, createRemoteSource } from '@agent-native/integration';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import manifest from './manifest';
import { operations } from './contracts';
import { crmTarget } from './contracts/target';
import { createCrmState, REGIONS, type CrmState, type Member } from './domain';
import { FakeCrm, type CrmFeedItem } from './fake-crm';
import { createCrmHandlers, crmPolicy, type CrmServices } from './server';

/** The CRM integration's principal; distinct from every person. */
export const INTEGRATION_PRINCIPAL = 'integration';

/**
 * Demo only: the in-memory CRM, so the reference needs no CRM account. The local owner signs in
 * to it as `ann` (`DEMO_CRM_LOGIN` picks another user; `none` leaves the owner without a login,
 * so searches fall back to the service account). `DEMO_CRM_LATENCY_MS` slows searches and
 * `DEMO_CRM_UNAVAILABLE=1` makes the CRM unreachable. A deploying application passes its real
 * port and credential store instead; the framework never reads these variables.
 */
export function demoCrm(env: Record<string, string | undefined> = process.env) {
  const login = env.DEMO_CRM_LOGIN ?? 'ann';
  const crm = new FakeCrm(login === 'none' ? {} : { logins: { owner: login } });
  crm.latencyMs = Number(env.DEMO_CRM_LATENCY_MS ?? 0);
  crm.unavailable = env.DEMO_CRM_UNAVAILABLE === '1';
  return crm;
}

/**
 * The CRM capture application. One CRM serves three paths: live search (the remote source),
 * follow requests and activities (the outbox), and followed accounts (the feed). `members` are
 * the people who work in a new workspace and their regions; by default the owner covers all.
 */
export function createCrmCaptureApplication(
  options: { crm?: FakeCrm; services?: CrmServices; members?: Record<string, Member> } = {},
) {
  const crm = options.crm ?? demoCrm();
  const state = (ownerId: string) =>
    createCrmState({
      ownerId,
      integrationPrincipalId: INTEGRATION_PRINCIPAL,
      members: options.members ?? { [ownerId]: { regions: [...REGIONS] } },
    });
  return defineApplication<CrmState, CrmServices>({
    manifest,
    createState: state,
    upgradeState: (stored, ownerId) => (stored as CrmState | undefined) ?? state(ownerId),
    handlers: createCrmHandlers(),
    authorization: crmPolicy,
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { account: operations.accountGet.id },
    plugins: [sitePlugin, networkPlugin, auditPlugin, compliancePlugin],
    sources: {
      crm: createRemoteSource({ target: 'crm', port: crm, credentials: crm.credentials }),
    },
    connect: ({ application, workspaceId }) => {
      const integration = connectTarget<CrmFeedItem>({
        target: crmTarget,
        application,
        port: crm,
        workspaceId,
        principalId: INTEGRATION_PRINCIPAL,
      });
      // The feed carries only followed accounts, so it is cheap to poll every second: a followed
      // account fills in shortly after the CRM accepts the follow request.
      const start: typeof integration.start = (intervals = {}) =>
        integration.start({ ...intervals, syncMs: intervals.syncMs ?? 1_000 });
      return { integrations: [{ ...integration, start }] };
    },
  });
}

export default createCrmCaptureApplication();
