import { useState } from 'react';
import type { AnyCapability, InputOf, JsonObject, OutputOf } from '@agent-native/contracts';
import type { Receipt } from '@agent-native/client';
import { useCapabilityForm } from '@agent-native/react/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { transport } from '@/lib/session';

type Property = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Property[];
  description?: string;
};
type Field = {
  name: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'choice' | 'json';
  choices: string[];
  required: boolean;
  nullable: boolean;
};

const humanize = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (first) => first.toUpperCase());

/** Derive form fields from the top level of a capability's JSON Schema. */
export function fieldsOf(schema: JsonObject, hidden: readonly string[] = []): Field[] {
  const properties = (schema.properties ?? {}) as Record<string, Property>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties)
    .filter(([name]) => !hidden.includes(name))
    .map(([name, property]) => {
      // Zod emits `type: ["string", "null"]` for nullable fields; other generators use anyOf.
      const variants = property.anyOf ?? [property];
      const types = variants.flatMap((variant) =>
        Array.isArray(variant.type) ? variant.type : [variant.type],
      );
      const nullable = types.includes('null');
      const value = variants.find((variant) => variant.type !== 'null') ?? property;
      const type = types.find((item) => item !== 'null');
      const kind: Field['kind'] = value.enum
        ? 'choice'
        : type === 'string'
          ? 'text'
          : type === 'number' || type === 'integer'
            ? 'number'
            : type === 'boolean'
              ? 'boolean'
              : 'json';
      return {
        name,
        label: humanize(name),
        kind,
        choices: (value.enum ?? []).map(String),
        required: required.has(name),
        nullable,
      };
    });
}

/** Convert string form values to typed input; empty optional fields are omitted. */
function toTyped(fields: Field[], values: Record<string, string>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name] ?? '';
    if (raw === '' && !field.required) continue;
    if (raw === '\u0000null') input[field.name] = null;
    else if (field.kind === 'number') input[field.name] = Number(raw.replace(',', '.'));
    else if (field.kind === 'boolean') input[field.name] = raw === 'true';
    else if (field.kind === 'json') input[field.name] = JSON.parse(raw);
    else input[field.name] = raw;
  }
  return input;
}

/**
 * A complete form for any command capability, generated from its contract. Use it to scaffold a
 * screen in one line, then replace it with a purpose-built capture surface where seconds matter.
 * Validation, idempotency and field-level server errors come from `useCapabilityForm`.
 */
export function CapabilityForm<C extends AnyCapability>({
  capability,
  fixed = {},
  submitLabel = 'Submit',
  onCommitted,
}: {
  capability: C & { kind: 'command' };
  /** Inputs supplied by the screen (for example the selected lot); not rendered as fields. */
  fixed?: Partial<InputOf<C>>;
  submitLabel?: string;
  onCommitted?: (receipt: Receipt<OutputOf<C>>) => void;
}) {
  const [saved, setSaved] = useState('');
  const fields = fieldsOf(capability.input.jsonSchema, Object.keys(fixed));
  const { form } = useCapabilityForm(transport, capability, {
    defaultValues: Object.fromEntries(fields.map((field) => [field.name, ''])) as Record<
      string,
      string
    >,
    toInput: (values) => ({ ...toTyped(fields, values), ...fixed }) as InputOf<C>,
    onCommitted: (receipt) => {
      setSaved('Saved');
      form.reset();
      onCommitted?.(receipt);
    },
  });
  const id = (name: string) => `${capability.id}-${name}`;
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
          {(control) => (
            <div className={field.kind === 'json' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
              <Label htmlFor={id(field.name)}>
                {field.label}
                {!field.required && <span className="text-muted-foreground"> (optional)</span>}
              </Label>
              {field.kind === 'choice' || field.kind === 'boolean' ? (
                <NativeSelect
                  id={id(field.name)}
                  className="w-full"
                  value={control.state.value}
                  onChange={(event) => control.handleChange(event.target.value)}
                >
                  <option value="">Select…</option>
                  {(field.kind === 'boolean' ? ['true', 'false'] : field.choices).map((choice) => (
                    <option key={choice} value={choice}>
                      {humanize(choice)}
                    </option>
                  ))}
                  {field.nullable && <option value={'\u0000null'}>None</option>}
                </NativeSelect>
              ) : field.kind === 'json' ? (
                <Textarea
                  id={id(field.name)}
                  className="font-mono"
                  value={control.state.value}
                  onChange={(event) => control.handleChange(event.target.value)}
                />
              ) : (
                <Input
                  id={id(field.name)}
                  inputMode={field.kind === 'number' ? 'decimal' : 'text'}
                  value={control.state.value}
                  aria-invalid={control.state.meta.errors.length > 0}
                  onChange={(event) => control.handleChange(event.target.value)}
                />
              )}
              {control.state.meta.errors.length > 0 && (
                <p className="text-xs text-destructive">{control.state.meta.errors.join(', ')}</p>
              )}
            </div>
          )}
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
