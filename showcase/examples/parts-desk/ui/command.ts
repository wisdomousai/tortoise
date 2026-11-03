import { useRef, useState } from 'react';
import type { AnyCapability, InputOf, OutputOf } from '@agent-native/contracts';
import { useCapabilityForm } from '@agent-native/react/form';
import { transport } from '@/lib/session';

/**
 * One command a screen runs from a button instead of a form of fields. It is a
 * `useCapabilityForm` whose only value is the whole input: a double click or a retry after a
 * lost response keeps the idempotency key and replays, and a changed input starts a new attempt.
 * The instance's refusal, a field error included, shows as one message.
 */
export function useScreenCommand<C extends AnyCapability & { kind: 'command' }>(capability: C) {
  const committed = useRef<OutputOf<C>>(undefined);
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const { form } = useCapabilityForm(transport, capability, {
    // The input is opaque to the form; the capability's schema validates it before the request.
    defaultValues: { input: null as unknown },
    toInput: (values) => values.input as InputOf<C>,
    onCommitted: (receipt) => {
      committed.current = receipt.result;
    },
  });
  return {
    pending: state.pending,
    error: state.error,
    /** Run the command. Resolves to its result, or to the message when it did not commit. */
    async run(input: InputOf<C>): Promise<{ result: OutputOf<C> } | { error: string }> {
      committed.current = undefined;
      setState({ pending: true });
      form.setFieldValue('input', input);
      await form.handleSubmit();
      const result = committed.current;
      if (result !== undefined) {
        setState({ pending: false });
        return { result };
      }
      const message = form.state.errorMap.onSubmit;
      const error = typeof message === 'string' ? message : 'Not saved.';
      setState({ pending: false, error });
      return { error };
    },
  };
}
