import { useEffect, useId, useRef, useState } from 'react';
import type { AnyCapability, InputOf, JsonObject, OutputOf } from '@tortoise/contracts';
import type { Receipt } from '@tortoise/client';
import { useCapabilityForm } from '@tortoise/react/form';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { OsProvenanceNotice } from '@/components/os-provenance';
import { usePreparedInput, type PreparedInput } from '@/lib/os-deliveries';
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

/**
 * Derive form fields from the top level of a capability's JSON Schema. A field named in the
 * capability's display fields takes its label from there.
 */
export function fieldsOf(
  schema: JsonObject,
  hidden: readonly string[] = [],
  labels: ReadonlyMap<string, string> = new Map(),
): Field[] {
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
        label: labels.get(name) ?? humanize(name),
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

/** One generated field: a select for choices and booleans, a textarea for JSON, else an input. */
function FieldControl({
  field,
  id,
  value,
  errors,
  onChange,
}: {
  field: Field;
  id: string;
  value: string;
  errors: readonly unknown[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={field.kind === 'json' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
      <Label htmlFor={id}>
        {field.label}
        {!field.required && <span className="text-muted-foreground"> (optional)</span>}
      </Label>
      {field.kind === 'choice' || field.kind === 'boolean' ? (
        <NativeSelect
          id={id}
          className="w-full"
          value={value}
          onChange={(event) => onChange(event.target.value)}
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
          id={id}
          className="font-mono"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          inputMode={field.kind === 'number' ? 'decimal' : 'text'}
          value={value}
          aria-invalid={errors.length > 0}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {errors.length > 0 && <p className="text-xs text-destructive">{errors.join(', ')}</p>}
    </div>
  );
}

/** Form values from an OS prefill: only fields the form renders, as the strings it edits. */
function preparedValues(fields: Field[], input: Record<string, unknown> | undefined) {
  const values: Record<string, string> = Object.fromEntries(
    fields.map((field) => [field.name, '']),
  );
  for (const field of fields) {
    const value = input?.[field.name];
    if (value === undefined || value === null) continue;
    values[field.name] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return values;
}

interface FormProps<C extends AnyCapability> {
  capability: C & { kind: 'command' };
  /** Inputs supplied by the screen (for example the selected lot); not rendered as fields. */
  fixed?: Partial<InputOf<C>>;
  /** The button text; the capability's display label, else "Submit". */
  submitLabel?: string;
  onCommitted?: (receipt: Receipt<OutputOf<C>>) => void;
  /**
   * Values the screen puts into rendered fields while the person edits the form, such as a
   * scanned badge. Each new `key` sets them once; the other fields keep what the person typed,
   * and nothing submits.
   */
  fill?: { readonly key: string | number; readonly values: Readonly<Record<string, string>> };
}

function FormBody<C extends AnyCapability>({
  capability,
  fixed = {},
  submitLabel = capability.display?.label ?? 'Submit',
  onCommitted,
  fill,
  prepared,
  dismiss,
}: FormProps<C> & {
  prepared: PreparedInput | undefined;
  dismiss: () => void;
}) {
  const [saved, setSaved] = useState('');
  const labels = new Map(
    (capability.display?.fields ?? []).flatMap((field) =>
      field.label ? [[field.name, field.label] as const] : [],
    ),
  );
  const fields = fieldsOf(capability.input.jsonSchema, Object.keys(fixed), labels);
  const { form } = useCapabilityForm(transport, capability, {
    defaultValues: preparedValues(fields, prepared?.input),
    toInput: (values) => ({ ...toTyped(fields, values), ...fixed }) as InputOf<C>,
    onCommitted: (receipt) => {
      setSaved('Saved');
      dismiss();
      form.reset();
      onCommitted?.(receipt);
    },
  });
  const filled = useRef<string | number>(undefined);
  useEffect(() => {
    if (!fill || filled.current === fill.key) return;
    filled.current = fill.key;
    for (const [name, value] of Object.entries(fill.values))
      if (fields.some((field) => field.name === name)) form.setFieldValue(name, value);
  });
  // One prefix per form, so two forms for the same command on a page keep their labels apart.
  const prefix = useId();
  const id = (name: string) => `${prefix}${capability.id}-${name}`;
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
            <FieldControl
              field={field}
              id={id(field.name)}
              value={control.state.value}
              errors={control.state.meta.errors}
              onChange={(value) => control.handleChange(value)}
            />
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

/** A prefill an agent run prepared: committed only when the person submits. */
function RunPrefillNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Alert>
      <AlertTitle role="status">An agent prepared this form</AlertTitle>
      <AlertDescription>Check the prefilled fields before you submit.</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Discard
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * A complete form for any command capability, generated from its contract. Use it to scaffold a
 * screen in one line, then replace it with a purpose-built capture surface where seconds matter.
 * Validation, idempotency and field-level server errors come from `useCapabilityForm`. A prefill
 * an OS request prepared for this capability fills the fields and shows where it came from; the
 * person still submits, and fixed inputs are never taken from it. `fill` sets fields from the
 * screen itself, such as a scan, under the same rule.
 */
export function CapabilityForm<C extends AnyCapability>(props: FormProps<C>) {
  const { prepared, dismiss } = usePreparedInput(props.capability.id);
  return (
    <div className="space-y-3">
      {prepared?.provenance ? (
        <OsProvenanceNotice provenance={prepared.provenance} prepared onDismiss={dismiss} />
      ) : prepared ? (
        <RunPrefillNotice onDismiss={dismiss} />
      ) : null}
      {/* A new prefill remounts the form so its values become the defaults. */}
      <FormBody key={prepared?.id ?? 'blank'} {...props} prepared={prepared} dismiss={dismiss} />
    </div>
  );
}
