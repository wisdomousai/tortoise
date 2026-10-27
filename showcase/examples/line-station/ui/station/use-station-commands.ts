import { useState } from 'react';
import { useFeedback } from '@/hooks/use-feedback';
import { message } from './format';

/** Run one keyed command; resolves whether it succeeded. */
export type Run = (key: string, action: () => Promise<unknown>) => Promise<boolean>;

/**
 * One command at a time at the station: the key of the command in flight, the last error, and
 * audible feedback, because the operator is looking at the machine.
 */
export function useStationCommands() {
  const feedback = useFeedback();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  /** Run one command; feedback is audible because the operator is looking at the machine. */
  const run: Run = async (key, action) => {
    setPending(key);
    setError(undefined);
    try {
      await action();
      feedback.play('accepted');
      return true;
    } catch (cause) {
      setError(message(cause));
      feedback.play('rejected');
      return false;
    } finally {
      setPending(undefined);
    }
  };
  return { feedback, pending, error, run };
}
