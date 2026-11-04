import { useEffect, useId, useRef, useState } from 'react';
import type { AnyCapability, InputOf } from '@tortoise/contracts';
import type { Transport } from '@tortoise/client';
import { useCapabilityForm } from '@tortoise/react/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

/** One field of an operator form: a text input, or a select when it has choices. */
export interface OperatorField {
  readonly name: string;
  readonly label: string;
  readonly choices?: readonly string[];
  /** An optional field left empty is left out of the input. */
  readonly optional?: boolean;
}

const words = (value: string) => value.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * A command form for the counter terminal. It sends through `transport`, the signed-in
 * attendant's, so the instance records the attendant; the frame's `CapabilityForm` would send as
 * the terminal's own session. Validation with the capability's schema, one idempotency key until
 * the command commits, and field errors from the instance come from `useCapabilityForm`. `fill`
 * puts values from a scan into rendered fields: each new `key` sets them once, the other fields
 * keep what the attendant typed, and nothing submits. `focus` moves the focus to one field once
 * per new `key`, such as the field an agent's review asks the attendant to fill.
 */
export function OperatorForm<C extends AnyCapability>({
  transport,
  capability,
  fields,
  fixed = {},
  submitLabel,
  fill,
  focus,
}: {
  transport: Transport;
  capability: C & { kind: 'command' };
  fields: readonly OperatorField[];
  /** Inputs the screen supplies, such as the open tool; not rendered as fields. */
  fixed?: Partial<InputOf<C>>;
  submitLabel: string;
  fill?: { readonly key: number; readonly values: Readonly<Record<string, string>> };
  focus?: { readonly key: string; readonly name: string };
}) {
  const [saved, setSaved] = useState('');
  const { form } = useCapabilityForm(transport, capability, {
    defaultValues: Object.fromEntries(fields.map((field) => [field.name, ''])) as Record<
      string,
      string
    >,
    toInput: (values) =>
      ({
        ...Object.fromEntries(
          fields
            .filter((field) => !(field.optional && values[field.name] === ''))
            .map((field) => [field.name, values[field.name] ?? '']),
        ),
        ...fixed,
      }) as InputOf<C>,
    onCommitted: () => {
      setSaved('Saved');
      form.reset();
    },
  });
  const filled = useRef<number>(undefined);
  useEffect(() => {
    if (!fill || filled.current === fill.key) return;
    filled.current = fill.key;
    for (const [name, value] of Object.entries(fill.values))
      if (fields.some((field) => field.name === name)) form.setFieldValue(name, value);
  });
  // One prefix per form, so two forms on the counter keep their labels apart.
  const prefix = useId();
  const focused = useRef<string>(undefined);
  useEffect(() => {
    if (!focus || focused.current === focus.key) return;
    focused.current = focus.key;
    document.getElementById(`${prefix}${focus.name}`)?.focus();
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved('');
        void form.handleSubmit();
      }}
    >
      {fields.map((field) => (
        <form.Field key={field.name} name={field.name}>
          {(control) => {
            const id = `${prefix}${field.name}`;
            const errors = control.state.meta.errors;
            return (
              <div className="space-y-1">
                <Label htmlFor={id}>
                  {field.label}
                  {field.optional && <span className="text-muted-foreground"> (optional)</span>}
                </Label>
                {field.choices ? (
                  <NativeSelect
                    id={id}
                    className="w-full"
                    value={control.state.value}
                    onChange={(event) => control.handleChange(event.target.value)}
                  >
                    <option value="">Select…</option>
                    {field.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {words(choice)}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    id={id}
                    value={control.state.value}
                    aria-invalid={errors.length > 0}
                    onChange={(event) => control.handleChange(event.target.value)}
                  />
                )}
                {errors.length > 0 && (
                  <p className="text-xs text-destructive">{errors.join(', ')}</p>
                )}
              </div>
            );
          }}
        </form.Field>
      ))}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="secondary">
          {submitLabel}
        </Button>
        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(error) =>
            typeof error === 'string' ? (
              <span role="alert" className="text-sm text-destructive">
                {error}
              </span>
            ) : (
              <span role="status" className="text-sm text-muted-foreground">
                {saved}
              </span>
            )
          }
        </form.Subscribe>
      </div>
    </form>
  );
}
