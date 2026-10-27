import { useState } from 'react';
import { client } from '@/lib/session';
import { operations } from '../../contracts';
import type { Attention } from './format';
import type { Run } from './use-station-commands';

/**
 * Resolving attention at the station. A reconcile or a confirmed reading is one command; "enter
 * the value" opens a correction that stays open across live updates until it is confirmed. The
 * state lives in the calling surface, so a re-render of the queue does not lose the draft.
 */
export function useAttention(attention: readonly Attention[], run: Run) {
  const [correcting, setCorrecting] = useState<Attention>();
  const [correction, setCorrection] = useState('');
  const resolve = (id: string, value: string) => {
    const item = attention.find((entry) => entry.id === id);
    if (!item) return;
    if (item.kind === 'reconcile')
      return void run(`attention:${id}`, () =>
        client.command(operations.effectReconcile, {
          effectId: item.effectId!,
          applied: value === 'applied',
        }),
      );
    if (value === 'correct') {
      setCorrecting(item);
      setCorrection('');
      return;
    }
    void run(`attention:${id}`, () =>
      client.command(operations.readingConfirm, {
        attentionId: id,
        value: item.proposed as string | number | boolean,
      }),
    );
  };
  /** Confirm the corrected value; the editor closes only when the command succeeded. */
  const submit = (item: Attention, value: string | number | boolean) =>
    void run(`attention:${item.id}`, () =>
      client.command(operations.readingConfirm, { attentionId: item.id, value }),
    ).then((ok) => ok && setCorrecting(undefined));
  return { correcting, correction, setCorrection, resolve, submit };
}
