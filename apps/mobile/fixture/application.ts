import { defineApplication } from '@agent-native/kernel/application';
import { createHandlerFactory } from '@agent-native/runtime';
import manifest, { noteAdd, noteList } from './manifest';

type State = { notes: { id: string; text: string }[] };
const bind = createHandlerFactory<State, unknown>();

/** The fixture's server definition. Everything is allowed: the device's owner is the only caller. */
export default defineApplication<State>({
  manifest,
  createState: () => ({ notes: [] }),
  handlers: [
    bind(noteAdd, async (input, ctx) => {
      const id = `n${ctx.state.notes.length + 1}`;
      ctx.state.notes.unshift({ id, text: input.text });
      ctx.change(`note:${id}`);
      return { id };
    }),
    bind(noteList, async (_input, ctx) => ({ notes: ctx.state.notes })),
  ],
  authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
});
