import { readFile } from 'node:fs/promises';
import type { TrustedKey } from '@agent-native/bundle';
import {
  defineHostPlugin,
  type HostPorts,
  type PluginStartContext,
} from '@agent-native/host/plugin';
import { forwardAudit, type AuditSource } from './audit';
import {
  fleetSiteOperations,
  type FleetRelease,
  type RelayRequest,
  type SiteReport,
} from './contracts';
import { credentialStore } from './credential';
import { enroll, fleetLink, type FleetLink } from './link';
import { fleetAgentPluginManifest } from './plugin-manifest';
import { forwardToSite } from './relay';
import { stageRelease } from './releases';
import { siteReport } from './report';

export interface FleetAgentStatus {
  readonly enrolled: boolean;
  /** When the fleet last answered a report. */
  readonly lastContact?: number;
  readonly lastError?: string;
  readonly reports: number;
  /** The last audit sequence the fleet holds. */
  readonly auditForwarded?: number;
  readonly staged?: { readonly release: string; readonly version: string; readonly path: string };
  readonly relayed: number;
}

export interface FleetAgentService {
  status(): FleetAgentStatus;
  /** Run one cycle now (enroll, report, forward audit, stage), as the timer does. */
  sync(): Promise<void>;
  /** Take and forward one remote-access request; false when none was waiting. */
  relay(): Promise<boolean>;
}

export interface FleetAgentOptions {
  /** Between cycles; one minute by default. */
  readonly intervalMs?: number;
  /** Between relay polls while relaying is on; two seconds by default. */
  readonly relayMs?: number;
  readonly now?: () => number;
}

async function readTrust(path: string): Promise<TrustedKey[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  const keys = (Array.isArray(parsed) ? parsed : [parsed]) as Partial<TrustedKey>[];
  if (
    !keys.length ||
    keys.some((key) => typeof key?.keyId !== 'string' || typeof key.publicKey !== 'string')
  )
    throw new Error(`fleet-trust ${path} holds no release signing key`);
  return keys.map(({ keyId, publicKey }) => ({ keyId: keyId!, publicKey: publicKey! }));
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The site side of a fleet. Outbound only: on a serving host it enrolls with the fleet once,
 * then every cycle reports health, forwards the audit events the fleet lacks and stages the
 * release the fleet assigns, each through the network port's `fleet` destination. With
 * `fleet-relay` set to `on` it also forwards remote-access requests to the host's own API.
 *
 * Nothing here writes to the workspace, and nothing the site does waits on the fleet: a cycle
 * that fails records the reason in `status().lastError` and the next one tries again, so the site
 * keeps committing and delivering while the fleet is unreachable.
 */
export function createFleetAgentPlugin(options: FleetAgentOptions = {}) {
  const now = options.now ?? Date.now;
  return defineHostPlugin({
    manifest: fleetAgentPluginManifest,
    async open(context) {
      const { settings } = context;
      const trustPath = settings['fleet-trust'];
      const trust = trustPath ? await readTrust(trustPath) : undefined;
      const relaying = settings['fleet-relay'] === 'on';
      if (settings['fleet-relay'] !== undefined && !relaying && settings['fleet-relay'] !== 'off')
        throw new Error('fleet-relay must be on or off');
      const audit = context.services.audit as AuditSource | undefined;
      const credentials = credentialStore(context.secrets, context.workspacePath);
      let status: FleetAgentStatus = { enrolled: false, reports: 0, relayed: 0 };
      const update = (change: Partial<FleetAgentStatus>) => (status = { ...status, ...change });
      let started: PluginStartContext | undefined;
      let link: FleetLink | undefined;
      let ports: HostPorts | undefined;
      let reportCount = 0;
      let takeCount = 0;

      // One enrollment at a time: the code is single-use, so a second attempt would be refused.
      let connecting: Promise<FleetLink | undefined> | undefined;
      const connect = () => {
        if (link) return Promise.resolve(link);
        connecting ??= open().finally(() => (connecting = undefined));
        return connecting;
      };
      async function open(): Promise<FleetLink | undefined> {
        let token = await credentials.read();
        const code = settings['fleet-enrollment-code'];
        if (!token && code) {
          token = await enroll(() => ports!.network, code);
          await credentials.write(token);
        }
        if (!token) {
          update({ lastError: 'Not enrolled: set fleet-enrollment-code to a code from the fleet' });
          return undefined;
        }
        update({ enrolled: true });
        return (link = fleetLink(() => ports!.network, token));
      }

      async function stage(fleet: FleetLink, host: PluginStartContext) {
        if (!trust) return;
        const { release } = await fleet.query<{ release?: FleetRelease }>(
          fleetSiteOperations.desired.id,
        );
        if (!release || status.staged?.release === release.id) return;
        const folder = host.ports.folders.folder('fleet-releases').path;
        const staged = await stageRelease(fleet, folder, trust, release);
        update({ staged: { release: release.id, version: release.version, path: staged.path } });
      }

      async function cycle() {
        const host = started;
        if (!host) return;
        try {
          const fleet = await connect();
          if (!fleet) return;
          const report: SiteReport = await siteReport(host.application, {
            workspaceId: host.workspaceId,
            application: context.manifest.id,
            instance: context.instance,
            at: now(),
            ...(audit ? { auditHead: audit.head().seq } : {}),
            ...(status.staged
              ? { staged: { release: status.staged.release, version: status.staged.version } }
              : {}),
          });
          await fleet.command(
            fleetSiteOperations.report.id,
            report,
            `report:${context.instance}:${++reportCount}`,
          );
          update({ lastContact: now(), reports: status.reports + 1 });
          if (audit) update({ auditForwarded: await forwardAudit(fleet, audit) });
          await stage(fleet, host);
          update({ lastError: undefined });
        } catch (error) {
          update({ lastError: message(error) });
        }
      }

      async function relayOnce(): Promise<boolean> {
        const host = started;
        if (!relaying || !host?.origin) return false;
        try {
          const fleet = await connect();
          if (!fleet) return false;
          const { request } = await fleet.command<{ request?: RelayRequest }>(
            fleetSiteOperations.relayTake.id,
            {},
            `relay-take:${context.instance}:${++takeCount}`,
          );
          if (!request) return false;
          const answer = await forwardToSite(host.origin, request);
          await fleet.command(fleetSiteOperations.relayAnswer.id, answer, `relay:${request.id}`);
          update({ relayed: status.relayed + 1 });
          return true;
        } catch (error) {
          update({ lastError: message(error) });
          return false;
        }
      }

      // Cycles run one after another, whether the timer or a caller starts them.
      let cycles: Promise<void> = Promise.resolve();
      let relays: Promise<boolean> = Promise.resolve(false);
      const sync = () => (cycles = cycles.then(cycle));
      const relay = () => (relays = relays.then(relayOnce));
      const service: FleetAgentService = { status: () => status, sync, relay };
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let stopped = false;
      const every = (ms: number, run: () => Promise<unknown>) => {
        const tick = () => {
          if (stopped) return;
          void run().finally(() => {
            if (stopped) return;
            const timer = setTimeout(() => {
              timers.delete(timer);
              tick();
            }, ms);
            timers.add(timer);
          });
        };
        tick();
      };
      const stop = async () => {
        stopped = true;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      };
      return {
        // The fleet is reached only through a provided network port, never the kernel default.
        needs: ['network'],
        service,
        async start(context) {
          started = context;
          ports = context.ports;
          every(options.intervalMs ?? 60_000, sync);
          if (relaying) every(options.relayMs ?? 2_000, relay);
          return [{ stop }];
        },
        describe: () => ({
          enrolled: status.enrolled,
          staging: !!trust,
          relay: relaying,
          audit: !!audit,
        }),
        close: stop,
      };
    },
  });
}

export const fleetAgentPlugin = createFleetAgentPlugin();
