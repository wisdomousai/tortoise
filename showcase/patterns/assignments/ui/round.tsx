import { useState } from 'react';
import type { z } from 'zod';
import type { SubmitReport } from '@/components/my-assignments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { sampling } from '../contracts';

export type RoundInstructions = z.output<typeof sampling.instructions>;
export type Sample = z.output<typeof sampling.report>;

/** The substation and its transformers, with each one's last sample in the lab when sent. */
export function InstructionsRound({ instructions }: { instructions: Record<string, unknown> }) {
  const { substation, transformers } = instructions as RoundInstructions;
  return (
    <div className="space-y-2">
      <p className="text-sm">Substation {substation}</p>
      <ol aria-label="Transformers to sample" className="space-y-2">
        {transformers.map((entry) => (
          <li key={entry.transformer} className="rounded-md bg-muted/50 p-3">
            <p className="text-sm font-medium">{entry.transformer}</p>
            <p className="text-xs text-muted-foreground">
              {entry.lastSample
                ? `Last sample ${entry.lastSample}: ${entry.lastMethod || 'no method assigned'}`
                : 'No sample in the lab yet'}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One sample of the round: the transformer it was drawn from, the number on the bottle, and what
 * to test and what was seen. After a report is recorded the form moves on to the next
 * transformer.
 */
export function SampleForm({
  item,
  submit,
}: {
  item: { id: string; title: string; instructions: Record<string, unknown> };
  submit: SubmitReport;
}) {
  const { transformers } = item.instructions as RoundInstructions;
  const [transformer, setTransformer] = useState(transformers[0]?.transformer ?? '');
  const [sample, setSample] = useState('');
  const [description, setDescription] = useState('');
  const id = (name: string) => `${item.id}-${name}`;
  const next = () => {
    const at = transformers.findIndex((entry) => entry.transformer === transformer);
    setTransformer(transformers[(at + 1) % transformers.length]?.transformer ?? '');
    setSample('');
    setDescription('');
  };
  return (
    <form
      aria-label={`Sample for ${item.title}`}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ sample: sample.trim(), description: description.trim() }, transformer).then(
          (done) => done && next(),
        );
      }}
    >
      <div className="flex flex-wrap items-start gap-6">
        <div className="space-y-1">
          <Label htmlFor={id('transformer')}>Transformer</Label>
          <NativeSelect
            id={id('transformer')}
            value={transformer}
            onChange={(event) => setTransformer(event.target.value)}
          >
            {transformers.map((entry) => (
              <option key={entry.transformer} value={entry.transformer}>
                {entry.transformer}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('sample')}>Sample number</Label>
          <Input
            id={id('sample')}
            maxLength={64}
            value={sample}
            onChange={(event) => setSample(event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('description')}>What to test and what you saw</Label>
        <Textarea
          id={id('description')}
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div>
        <Button
          type="submit"
          variant="secondary"
          disabled={!transformer || !sample.trim() || !description.trim()}
        >
          Report
        </Button>
      </div>
    </form>
  );
}

/** A sample as reported: its number and what the reporter asked for and saw. */
export function SampleView({ body }: { body: Record<string, unknown> }) {
  const { sample, description } = body as Sample;
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-sm">
      <Badge variant="secondary">{sample}</Badge>
      <span>{description}</span>
    </p>
  );
}
