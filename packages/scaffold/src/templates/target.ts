import type { AppNames } from './application';
import type { Generated } from './collection';
import { plural, type Names } from './names';
import { targetScreen, targetTest } from './target-files';

const contract = (t: Names, one: Names, many: Names) => `import { z } from 'zod';
import {
  defineCapability,
  defineTarget,
  deliveryStatusSchema,
  jsonSchema,
  recordKeySchema,
} from '@tortoise/contracts';
import { ${one.camel}Schema } from './${one.kebab}';

/** ${t.title} as a system of record: ${many.words} are sent to it, and its feed delivers the ${many.words} it holds. */
export const ${t.camel}Target = defineTarget({
  target: '${t.kebab}',
  resourceType: '${t.pascal}Sync',
  changes: ['${one.kebab}'],
  feed: { item: ${one.camel}Schema.pick({ id: true, title: true }), max: 100, changes: ['${one.kebab}'] },
  status: { pending: z.number().int(), accepted: z.number().int(), rejected: z.number().int() },
  descriptions: {
    complete: 'Integration principal only: record the ${t.words} outcome for a sent ${one.words}.',
    sync: 'Integration principal only: apply ${many.words} from ${t.words} and advance the watermark. A stale from watermark conflicts.',
    status: 'Summarize delivery to ${t.words}: ${many.words} waiting, accepted and rejected, and the last feed sync.',
  },
});

export const ${t.camel}Send = defineCapability({
  id: '${t.kebab}.send',
  kind: 'command',
  description:
    'Send one ${one.words} to ${t.words}. It is delivered after this commit; sync status shows when ${t.words} accepts or rejects it. Editors only; ${one.a} still waiting conflicts.',
  input: jsonSchema(z.strictObject({ id: recordKeySchema })),
  output: jsonSchema(z.strictObject({ id: recordKeySchema, sync: deliveryStatusSchema })),
  permission: { action: 'send', resourceType: '${t.pascal}Sync' },
  dependencies: ['${one.kebab}'],
  integration: { target: '${t.kebab}', delivery: 'outbox' },
  ui: { binding: '${t.kebab}.send' },
});
`;

const handlers = (
  t: Names,
  one: Names,
  many: Names,
) => `import { ApplicationError } from '@tortoise/contracts';
import { completeDelivery, targetHandlers } from '@tortoise/integration';
import { own, put, records, type HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import { ${many.camel} } from '../contracts/${one.kebab}';
import { ${t.camel}Target } from '../contracts/${t.kebab}-target';
import type { AppState } from '../domain';
import { handler, now, type Services } from './context';

type Item = { id: string; title: string };

/** Sending ${many.words} to ${t.words}, and the target's complete, feed and status handlers. */
export function ${t.camel}Handlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.${t.camel}Send, (input, ctx) => {
      const record = records(ctx, ${many.camel}, ctx.state.${many.camel}).getExisting(input.id);
      // One delivery at a time per record, so a late outcome is never applied to a newer send.
      if (own(ctx.state.${t.camel}Deliveries, record.id)?.sync === 'pending')
        throw new ApplicationError('CONFLICT', 'Already waiting for ${t.words}');
      const effectId = ctx.enqueue({
        target: ${t.camel}Target.target,
        type: '${one.kebab}.send',
        resource: ${many.camel}.resource(record.id),
        payload: { id: record.id, title: record.title },
      });
      put(ctx.state.${t.camel}Deliveries, record.id, { effectId, sync: 'pending' });
      ctx.change(${many.camel}.resource(record.id));
      return { id: record.id, sync: 'pending' as const };
    }),
    ...targetHandlers<AppState, Services, Item>(${t.camel}Target, {
      cursor: (state) => state.sync['${t.kebab}']!,
      now,
      onOutcome: (effect, outcome, ctx) =>
        completeDelivery(
          own(ctx.state.${t.camel}Deliveries, effect.resource.slice('${one.kebab}:'.length)),
          effect,
          outcome,
        ),
      applyBatch(batch, ctx) {
        const store = records(ctx, ${many.camel}, ctx.state.${many.camel});
        for (const item of batch.items)
          if (store.has(item.id)) store.update(item.id, { title: item.title });
          else
            store.insert(item.id, {
              ...item,
              status: 'open',
              createdBy: ctx.context.principalId,
              createdAt: now(ctx),
            });
        return batch.items.length;
      },
      status(ctx) {
        const deliveries = Object.values(ctx.state.${t.camel}Deliveries);
        const count = (sync: string) => deliveries.filter((entry) => entry.sync === sync).length;
        return { pending: count('pending'), accepted: count('accepted'), rejected: count('rejected') };
      },
    }),
  ];
}
`;

const port = (
  t: Names,
  app: AppNames,
) => `import type { Effect, EffectOutcome } from '@tortoise/runtime';
import type { PullBatch, SystemOfRecordPort } from '@tortoise/integration';

export type ${t.pascal}Item = { id: string; title: string };

/**
 * Demo and test stand-in for ${t.words}: it accepts every delivery once per effect and serves a
 * feed of published records. Pass the real port as \`create${app.app.pascal}Application({ ${t.camel}: port })\`.
 */
export class Fake${t.pascal} implements SystemOfRecordPort<${t.pascal}Item> {
  readonly received = new Map<string, Readonly<Effect>>();
  private readonly feed: ${t.pascal}Item[] = [];

  describe() {
    return { target: '${t.kebab}', idempotentDelivery: true } as const;
  }

  async deliver(effect: Readonly<Effect>): Promise<EffectOutcome> {
    this.received.set(effect.id, structuredClone(effect));
    return { status: 'accepted', externalRef: \`${t.pascal}-\${effect.id}\` };
  }

  async pull(cursor: string | undefined): Promise<PullBatch<${t.pascal}Item>> {
    return { items: this.feed.slice(Number(cursor ?? 0)), cursor: String(this.feed.length) };
  }

  publish(item: ${t.pascal}Item) {
    this.feed.push(structuredClone(item));
  }
}
`;

const insertions = (t: Names, one: Names, many: Names) => ({
  'contracts.ts': {
    imports: [`import { ${t.camel}Send, ${t.camel}Target } from './contracts/${t.kebab}-target';`],
    operations: [
      `${t.camel}Complete: ${t.camel}Target.complete,`,
      `${t.camel}Sync: ${t.camel}Target.sync,`,
      `${t.camel}Status: ${t.camel}Target.status,`,
      `${t.camel}Send,`,
    ],
    network: [
      '{',
      `  id: '${t.kebab}-api',`,
      `  purpose: 'Send ${many.words} to ${t.words} and pull the ${many.words} it holds.',`,
      "  direction: 'egress',",
      "  scope: 'site',",
      "  protocol: 'https',",
      `  targets: ['${t.kebab}'],`,
      `  dataClasses: ['${one.kebab}'],`,
      "  availability: 'required',",
      "  offline: 'queue',",
      '},',
    ],
  },
  'domain.ts': {
    imports: ["import type { Delivered } from '@tortoise/integration';"],
    state: [
      `/** Delivery to ${t.words} by ${one.words} id. */`,
      `${t.camel}Deliveries: Record<string, Delivered>;`,
    ],
    initial: [`${t.camel}Deliveries: {},`],
    sync: [`'${t.kebab}': {},`],
  },
  'policy.ts': {
    imports: [
      "import { targetAllowlist, targetRules } from '@tortoise/integration';",
      `import { ${t.camel}Target } from './contracts/${t.kebab}-target';`,
    ],
    integrations: [
      `targetAllowlist(${t.camel}Target, (_state, principalId) => principalId === '${t.kebab}-integration'),`,
    ],
    rules: [`...targetRules(${t.camel}Target),`, `[operations.${t.camel}Send.id]: editor,`],
  },
  'server.ts': {
    imports: [`import { ${t.camel}Handlers } from './handlers/${t.kebab}-target';`],
    handlers: [`...${t.camel}Handlers(),`],
  },
  'application.ts': {
    imports: [
      "import { connectTarget, type SystemOfRecordPort } from '@tortoise/integration';",
      `import { ${t.camel}Target } from './contracts/${t.kebab}-target';`,
      `import { Fake${t.pascal}, type ${t.pascal}Item } from './${t.kebab}-port';`,
    ],
    options: [
      `/** The ${t.words} port; the in-memory fake when omitted. */`,
      `${t.camel}?: SystemOfRecordPort<${t.pascal}Item>;`,
    ],
    integrations: [
      `connectTarget<${t.pascal}Item>({`,
      `  target: ${t.camel}Target,`,
      '  application,',
      `  port: options.${t.camel} ?? new Fake${t.pascal}(),`,
      '  workspaceId,',
      `  principalId: '${t.kebab}-integration',`,
      '}),',
    ],
  },
  'screens.tsx': {
    imports: [`import { ${t.pascal}Screen } from './ui/${t.kebab}-target';`],
    routes: [`{ path: '${t.kebab}', component: ${t.pascal}Screen },`],
    navigation: [`{ to: '/${t.kebab}', label: '${t.title}', icon: List },`],
    'capability-screens': [`{ prefix: '${t.kebab}.', to: '/${t.kebab}' },`],
  },
});

/**
 * A system of record for one collection: a send command that forwards a record through the
 * outbox, the target's complete, feed and status operations, its integration allowlist,
 * an in-memory fake port, a status screen and a behavioral test.
 */
export function target(app: AppNames, t: Names, one: Names): Generated {
  const many = plural(one);
  return {
    files: {
      [`contracts/${t.kebab}-target.ts`]: contract(t, one, many),
      [`handlers/${t.kebab}-target.ts`]: handlers(t, one, many),
      [`${t.kebab}-port.ts`]: port(t, app),
      [`ui/${t.kebab}-target.tsx`]: targetScreen(t, one),
      [`test/${t.kebab}-target.test.ts`]: targetTest(app, t, one, many),
    },
    insertions: insertions(t, one, many),
  };
}
