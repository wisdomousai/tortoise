import { z } from 'zod';
import {
  ApplicationError,
  defineCapability,
  defineModule,
  effectOutcomeSchema,
  jsonSchema,
  type OsAction,
  type OsHandler,
} from '@agent-native/contracts';
import { defineApplication } from '@agent-native/kernel/application';
import { defineManifest } from '@agent-native/kernel/manifest';
import { createOsPlugin } from '@agent-native/os/plugin';
import { osPluginManifest } from '@agent-native/os/plugin-manifest';
import { createHandlerFactory } from '@agent-native/runtime';
import { createNotificationsPlugin } from '../src/plugin';
import { notificationsPluginManifest } from '../src/plugin-manifest';

// A fixture application: reminders shown as notifications whose "Done" reply completes them.
const id = z.string().regex(/^r-[0-9]+$/);
const reminderSchema = z.strictObject({
  id,
  title: z.string(),
  done: z.boolean(),
  completions: z.number().int(),
  sync: z.enum(['pending', 'accepted', 'rejected']),
});
const create = defineCapability({
  id: 'reminder.create',
  kind: 'command',
  input: jsonSchema(z.strictObject({ title: z.string().min(1).max(80) })),
  output: jsonSchema(z.strictObject({ id })),
  permission: { action: 'write', resourceType: 'Reminder' },
  ui: { binding: 'reminder.create' },
  integration: { target: 'reminders', delivery: 'outbox' },
});
const complete = defineCapability({
  id: 'reminder.complete',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Reminder' },
  ui: { binding: 'reminder.complete' },
});
const effectComplete = defineCapability({
  id: 'reminders.effect.complete',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      effectId: z.string(),
      outcome: effectOutcomeSchema,
      fence: z.number().int().min(1).optional(),
    }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'complete', resourceType: 'Reminder' },
  ui: { exception: 'test fixture' },
});
const list = defineCapability({
  id: 'reminder.list',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ reminders: z.array(reminderSchema) })),
  permission: { action: 'read', resourceType: 'Reminder' },
  ui: { binding: 'reminder.list' },
});

const handlers: OsHandler[] = [
  {
    id: 'reminder.reply',
    kind: 'reply',
    description: 'A reply to a reminder.',
    consumer: 'notifications',
  },
];
export const notifyAction: Extract<OsAction, { kind: 'notify' }> = {
  id: 'reminders.notify',
  kind: 'notify',
  description: 'Show a reminder.',
  dataClasses: ['reminder-title'],
  categories: [
    {
      id: 'reminder',
      actions: [
        { id: 'done', title: 'Done', reply: 'reminder.reply' },
        { id: 'snooze', title: 'Snooze', reply: 'reminder.reply' },
      ],
    },
  ],
  targets: ['reminders'],
  offline: 'queue',
};

type Reminder = z.output<typeof reminderSchema> & { effectId: string };
type State = { reminders: Record<string, Reminder> };
const bind = createHandlerFactory<State, unknown>();

function reminderOf(state: State, reminder: string) {
  const found = Object.hasOwn(state.reminders, reminder) ? state.reminders[reminder] : undefined;
  if (!found) throw new ApplicationError('NOT_FOUND', 'Reminder not found');
  return found;
}

/**
 * The reminders application. `payload` overrides what `reminder.create` enqueues, `actions`
 * replaces the declared notify action, and `notifications: false` leaves the plugin out.
 */
export function remindersApplication(
  options: {
    now?: () => number;
    replyTtlMs?: number;
    actions?: OsAction[];
    notifications?: boolean;
    payload?: (reminder: string, title: string, principal: string) => unknown;
  } = {},
) {
  const withPlugin = options.notifications !== false;
  return defineApplication<State>({
    manifest: defineManifest({
      id: 'reminders',
      title: 'Reminders',
      modules: [
        defineModule({
          id: 'reminders',
          capabilities: [create, complete, effectComplete, list],
          os: { handlers, actions: options.actions ?? [notifyAction] },
        }),
      ],
      plugins: [osPluginManifest, ...(withPlugin ? [notificationsPluginManifest] : [])],
      targets: ['desktop', 'mobile'],
    }),
    createState: () => ({ reminders: {} }),
    handlers: [
      bind(create, async (input, ctx) => {
        const reminder = `r-${Object.keys(ctx.state.reminders).length + 1}`;
        ctx.change(`reminder:${reminder}`);
        const effectId = ctx.enqueue({
          target: 'reminders',
          type: 'reminder.due',
          resource: `reminder:${reminder}`,
          payload: (options.payload?.(reminder, input.title, ctx.context.principalId) ?? {
            principal: ctx.context.principalId,
            category: 'reminder',
            title: input.title,
            replies: { done: { operation: 'reminder.complete', input: { id: reminder } } },
          }) as never,
        });
        ctx.state.reminders[reminder] = {
          id: reminder,
          title: input.title,
          done: false,
          completions: 0,
          sync: 'pending',
          effectId,
        };
        return { id: reminder };
      }),
      bind(complete, async (input, ctx) => {
        const reminder = reminderOf(ctx.state, input.id);
        reminder.done = true;
        reminder.completions += 1;
        ctx.change(`reminder:${reminder.id}`);
        return {};
      }),
      bind(effectComplete, async (input, ctx) => {
        const effect = ctx.completeEffect(
          input.effectId,
          input.outcome,
          input.fence === undefined ? {} : { fence: input.fence },
        );
        const reminder = Object.values(ctx.state.reminders).find(
          (candidate) => candidate.effectId === effect.id,
        );
        if (!reminder) throw new ApplicationError('NOT_FOUND', 'No reminder forwarded this');
        reminder.sync = input.outcome.status;
        ctx.change(effect.resource);
        return {};
      }),
      bind(list, async (_input, ctx) => ({
        reminders: Object.values(ctx.state.reminders).map(({ effectId: _, ...rest }) => rest),
      })),
    ],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    plugins: [
      createOsPlugin(),
      ...(withPlugin
        ? [
            createNotificationsPlugin({
              deliverMs: 5,
              ...(options.now ? { now: options.now } : {}),
              ...(options.replyTtlMs ? { replyTtlMs: options.replyTtlMs } : {}),
            }),
          ]
        : []),
    ],
  });
}
