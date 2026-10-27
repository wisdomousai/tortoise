import { useState } from 'react';
import { useCommand } from '@agent-native/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { transport } from '@/lib/session';
import { operations } from '../../contracts';
import { ErrorText, quietly, valueLines } from '../shared';

/**
 * Values a reviewer reads off the photos themselves, accepted onto the capture's node without a
 * reading. Each value records that it was typed rather than read by the model.
 */
export function ValuesForm({ captureId }: { captureId: string }) {
  const accept = useCommand(transport, operations.surveyAccept);
  const [lines, setLines] = useState('');
  const values = Object.fromEntries(valueLines(lines));
  return (
    <form
      aria-label="Values by hand"
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void quietly(accept.execute({ id: captureId, values }));
      }}
    >
      <Label htmlFor="values-by-hand">Or type the values, one per line as name: value</Label>
      <Textarea
        id="values-by-hand"
        className="font-mono"
        placeholder={'manufacturer: ABB\nserial: 1VYN0123'}
        value={lines}
        onChange={(event) => setLines(event.target.value)}
      />
      <Button
        type="submit"
        variant="outline"
        disabled={accept.pending || Object.keys(values).length === 0}
      >
        Accept onto the node
      </Button>
      <ErrorText error={accept.error} />
    </form>
  );
}
