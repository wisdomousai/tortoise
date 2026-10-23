import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  definePeerSurface,
  jsonSchema,
} from '@agent-native/contracts';
import { peerLane } from '@agent-native/integration';
import { defineApplication } from '@agent-native/kernel/application';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { defineManifest } from '@agent-native/kernel/manifest';
import { startHost } from '@agent-native/host/host';
import { createHandlerFactory, definePolicy } from '@agent-native/runtime';
import {
  bodyDigest,
  generateAssertionKey,
  requestLine,
  signSubjectAssertion,
  type AssertionKey,
  type SubjectClaims,
} from '../src/assertion';
import { enrollPath, subjectHeader } from '../src/contracts';
import { createPeerLinkPlugin, type PeerLinkOptions } from '../src/plugin';
import { peerLinkPluginManifest } from '../src/plugin-manifest';

const fixture = { ui: { exception: 'test fixture' } } as const;
const lotInput = z.strictObject({ lot: z.string() });
const caller = z.strictObject({
  principalId: z.string(),
  peer: z.strictObject({ id: z.string(), subject: z.string().optional() }).optional(),
  delegated: z.boolean(),
});

/** Service: the caller announces an arrival. */
export const announce = defineCapability({
  id: 'quality.arrival.announce',
  kind: 'command',
  input: jsonSchema(lotInput),
  output: jsonSchema(z.strictObject({ by: z.string() })),
  permission: { action: 'create', resourceType: 'arrival' },
  ...fixture,
});
/** On behalf of a person: who the call ran as. */
export const whoami = defineCapability({
  id: 'quality.whoami',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(caller),
  permission: { action: 'read', resourceType: 'lot' },
  ...fixture,
});
/** On behalf of a person: inspectors hold a lot. */
export const hold = defineCapability({
  id: 'quality.lot.hold',
  kind: 'command',
  input: jsonSchema(lotInput),
  output: jsonSchema(z.strictObject({ by: z.string() })),
  permission: { action: 'hold', resourceType: 'lot' },
  ...fixture,
});
/** On behalf of a person, but people only: the policy refuses every delegated caller. */
export const release = defineCapability({
  id: 'quality.lot.release',
  kind: 'command',
  input: jsonSchema(lotInput),
  output: jsonSchema(z.strictObject({ by: z.string() })),
  permission: { action: 'release', resourceType: 'lot' },
  ...fixture,
});
/** Local only: on no peer surface. */
export const purge = defineCapability({
  id: 'quality.lot.purge',
  kind: 'command',
  input: jsonSchema(lotInput),
  output: jsonSchema(z.strictObject({ by: z.string() })),
  permission: { action: 'purge', resourceType: 'lot' },
  ...fixture,
});

export const surface = definePeerSurface({
  application: 'quality',
  commands: [announce],
  onBehalfOf: { commands: [hold, release], queries: [whoami] },
});

type Role = 'inspector' | 'viewer';
interface QualityState {
  members: Record<string, Role>;
  log: { operation: string; lot: string; by: string }[];
}
const bind = createHandlerFactory<QualityState, unknown>();
const record = (operation: string) =>
  bind(
    [announce, hold, release, purge].find((capability) => capability.id === operation)!,
    async (input, ctx) => {
      ctx.state.log.push({ operation, lot: input.lot, by: ctx.context.principalId });
      ctx.change(`lot:${input.lot}`);
      return { by: ctx.context.principalId };
    },
  );

const roleOf = (state: QualityState, principalId: string) =>
  Object.hasOwn(state.members, principalId) ? state.members[principalId] : undefined;

export const qualityPolicy = definePolicy<QualityState, Role>({
  integrations: [peerLane(surface)],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [announce.id]: 'integration',
    [whoami.id]: 'open',
    [hold.id]: {
      allow: ({ state, context }) => roleOf(state, context.principalId) === 'inspector',
    },
    [release.id]: { person: true },
    [purge.id]: 'open',
  },
  events: { lot: () => true },
});

/**
 * The called application: Ann inspects, Bob views, the owner is a member; the peer link serves
 * `surface`, and `erp-integration` is reserved.
 */
export function qualityApplication(options: PeerLinkOptions = {}) {
  return defineApplication<QualityState>({
    manifest: defineManifest({
      id: 'quality',
      title: 'Quality',
      modules: [
        defineModule({ id: 'quality', capabilities: [announce, whoami, hold, release, purge] }),
      ],
      plugins: [peerLinkPluginManifest],
    }),
    createState: () => ({
      members: { [LOCAL_OWNER]: 'inspector', ann: 'inspector', bob: 'viewer' },
      log: [],
    }),
    handlers: [
      record(announce.id),
      record(hold.id),
      record(release.id),
      record(purge.id),
      bind(whoami, async (_input, ctx) => ({
        principalId: ctx.context.principalId,
        ...(ctx.context.peer ? { peer: { ...ctx.context.peer } } : {}),
        delegated: ctx.context.grant !== undefined,
      })),
    ],
    authorization: qualityPolicy,
    plugins: [createPeerLinkPlugin({ reserved: ['erp-integration'], surface, ...options })],
  });
}

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };

/** One enrolled caller: its credential, the audience it signs for, and its key. */
export interface Enrolled {
  readonly token: string;
  readonly peerId: string;
  readonly audience: string;
  readonly key: AssertionKey;
}

export interface CallOptions {
  /** Sign an assertion for this subject. */
  readonly subject?: string;
  readonly act?: 'person' | 'agent';
  /** Replace claims after they are computed from the request. */
  readonly claims?: Partial<SubjectClaims>;
  /** Sign with this key instead of the enrolled one. */
  readonly key?: AssertionKey;
  /** Send this header value as it is. */
  readonly header?: string;
  /** Send this body instead of the signed one. */
  readonly sentBody?: string;
  /** Send to this path instead of the signed one. */
  readonly sentPath?: string;
}

/**
 * The called application on loopback, and helpers that act as an enrolled caller would. `send`
 * is the test's own fetch: the helpers call the host from outside, as another machine would.
 */
export async function startQuality(
  send: typeof fetch,
  clock = { now: Date.now() },
  options: Omit<PeerLinkOptions, 'now'> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'quality-'));
  const host = await startHost(qualityApplication({ ...options, now: () => clock.now }), {
    workspacePath: directory,
    integration: false,
  });
  const command = async (operation: string, input: unknown) =>
    (
      await host.application.invokeRaw(
        { operation, input, idempotencyKey: crypto.randomUUID() },
        owner,
      )
    ).result as Record<string, any>;
  const query = async (operation: string, input: unknown = {}) =>
    (await host.application.queryRaw({ operation, input }, owner)).data as Record<string, any>;

  const redeem = (body: unknown) =>
    send(host.url + enrollPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** Create an enrollment as the owner and redeem it as the calling application would. */
  async function enroll(
    enrollment: { subjects?: 'mapped' | 'same'; operations?: string[] } = {},
  ): Promise<Enrolled> {
    const { code } = await command('peer.enrollment.create', { label: 'Receiving', ...enrollment });
    const key = await generateAssertionKey();
    const response = await redeem({
      code,
      application: 'receiving',
      publicKey: key.publicKey,
      contract: { id: 'receiving', contractVersion: '1.0.0', digest: 'sha256:test' },
    });
    if (response.status !== 201) throw new Error(`enroll answered ${response.status}`);
    const answer = (await response.json()) as {
      token: string;
      peer: { id: string; audience: string };
    };
    return { token: answer.token, peerId: answer.peer.id, audience: answer.peer.audience, key };
  }

  /** POST to the API as `peer`, with a signed subject assertion when `options.subject` is set. */
  async function call(peer: Enrolled, path: string, body: unknown, options: CallOptions = {}) {
    const text = JSON.stringify(body);
    const url = new URL(path, host.url);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${peer.token}`,
      'Content-Type': 'application/json',
    };
    if (options.header !== undefined) headers[subjectHeader] = options.header;
    else if (options.subject !== undefined) {
      const iat = Math.floor(clock.now / 1000);
      const claims: SubjectClaims = {
        aud: peer.audience,
        sub: options.subject,
        act: options.act ?? 'person',
        req: requestLine('POST', url),
        body: await bodyDigest(new TextEncoder().encode(text)),
        iat,
        exp: iat + 60,
        jti: crypto.randomUUID().replaceAll('-', ''),
        ...options.claims,
      };
      headers[subjectHeader] = await signSubjectAssertion(
        (options.key ?? peer.key).privateKey,
        claims,
      );
    }
    return send(new URL(options.sentPath ?? path, host.url), {
      method: 'POST',
      headers,
      body: options.sentBody ?? text,
    });
  }
  const invoke = (peer: Enrolled, operation: string, input: unknown, options?: CallOptions) =>
    call(
      peer,
      `/api/v1/commands/${operation}`,
      { input, idempotencyKey: crypto.randomUUID() },
      options,
    );
  const ask = (peer: Enrolled, operation: string, input: unknown, options?: CallOptions) =>
    call(peer, `/api/v1/queries/${operation}`, { input }, options);

  return {
    host,
    directory,
    command,
    query,
    redeem,
    enroll,
    call,
    invoke,
    ask,
    async close() {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export type Quality = Awaited<ReturnType<typeof startQuality>>;

/** The error envelope of a refused call. */
export async function refusal(response: Response) {
  const body = (await response.json()) as {
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
  if (!body.error) throw new Error(`expected a refusal, got ${response.status}`);
  return { status: response.status, ...body.error };
}
