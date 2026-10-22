import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import {
  isDelegated,
  type FeatureHandler,
  type FeaturePolicy,
  type FeatureServer,
} from '@agent-native/runtime';
import { featureConformance } from '../src/features';

const fixture = { ui: { exception: 'test fixture' } } as const;
const post = defineCapability({
  id: 'ledger.post',
  kind: 'command',
  input: jsonSchema(z.strictObject({ entry: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'post', resourceType: 'ledger' },
  ...fixture,
});
const list = defineCapability({
  id: 'ledger.list',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ entries: z.array(z.string()) })),
  permission: { action: 'read', resourceType: 'ledger' },
  ...fixture,
});
const manifest = defineFeatureManifest({
  id: 'ledger',
  title: 'Ledger',
  modules: [defineModule({ id: 'ledger', capabilities: [post, list] })],
});

type Slice = { entries: Record<string, string> };
type Access = { allows(principalId: string): boolean };
const allowAll: Access = { allows: () => true };
const denyAll: Access = { allows: () => false };

const policy: FeaturePolicy<Slice, Access> = {
  authorize: ({ capability, context, access }) => ({
    allowed:
      access.allows(context.principalId) && !(capability.id === post.id && isDelegated(context)),
  }),
  canReadEvent: ({ event, state, context, access }) =>
    access.allows(context.principalId) && event.resource.slice('ledger:'.length) in state.entries,
};
const postHandler: FeatureHandler<Slice, unknown, Access, unknown, typeof post> = {
  capability: post,
  handle: (input, ctx) => {
    ctx.state.entries[input.entry] = input.entry;
    return {};
  },
};
const listHandler: FeatureHandler<Slice, unknown, Access, unknown, typeof list> = {
  capability: list,
  handle: (_input, ctx) => ({ entries: Object.keys(ctx.state.entries) }),
};
const ledger: FeatureServer<Slice, Access> = {
  manifest,
  state: { create: () => ({ entries: {} }) },
  handlers: [postHandler, listHandler],
  authorization: { resourceTypes: ['ledger'], port: policy },
};
const options = {
  allowAll,
  denyAll,
  sampleSlice: { entries: { a: 'a' } },
  requests: [{ operation: post.id, input: { entry: 'b' } }],
  events: [{ cursor: 1, resource: 'ledger:a', revision: 1, type: 'changed', operation: post.id }],
  personOnly: [post.id],
};

const run = (feature: FeatureServer<Slice, Access>) =>
  Promise.allSettled(featureConformance(feature, options).map((c) => c.run()));

describe('feature conformance', () => {
  for (const check of featureConformance(ledger, options)) test(check.name, check.run);

  test('a missing handler, a policy that ignores access and a delegated post fail', async () => {
    const [handlers, , deny, , person] = await run({
      ...ledger,
      handlers: [postHandler],
      authorization: {
        resourceTypes: ['ledger'],
        port: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
      },
    });
    expect(handlers).toMatchObject({
      status: 'rejected',
      reason: { message: 'ledger.list has no handler' },
    });
    expect(deny).toMatchObject({
      status: 'rejected',
      reason: { message: 'ledger.post is allowed under deny-all for a person' },
    });
    expect(person).toMatchObject({
      status: 'rejected',
      reason: { message: 'ledger.post is allowed for a delegated caller' },
    });
  });

  test('a slice JSON cannot keep fails', async () => {
    const [, slice] = await run({
      ...ledger,
      state: { create: () => ({ entries: {}, at: new Date(0) }) as unknown as Slice },
    });
    expect(slice).toMatchObject({ status: 'rejected' });
  });
});
