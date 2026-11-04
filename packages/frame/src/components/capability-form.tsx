import { useEffect, useId, useRef, useState } from 'react';
import type {
  AnyCapability,
  BlobLimits,
  DisplayDeclaration,
  InputOf,
  JsonObject,
  OutputOf,
} from '@tortoise/contracts';
import type { Receipt } from '@tortoise/client';
import { useCapabilityForm } from '@tortoise/react/form';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { OsProvenanceNotice } from '@/components/os-provenance';
import {
  formatBytes,
  humanize,
  inferKind,
  propertyTypes,
  fromDateInput,
  toDate,
  type FieldKind,
  type Property,
} from '@/lib/fields';
import { usePreparedInput, type PreparedInput } from '@/lib/os-deliveries';
import { useReferenceList } from '@/lib/references';
import { transport } from '@/lib/session';

/** One input of a generated form. Every value is edited as a string; `toTyped` converts it. */
export type Field = {
  name: string;
  label: string;
  kind: FieldKind;
  choices: string[];
  required: boolean;
  nullable: boolean;
  /** The resource kind a reference field picks from. */
  reference?: string;
  /** The JSON type of the input on the wire: a date is `number` (epoch) or `string` (ISO). */
  type?: string;
};

/**
 * Derive form fields from the top level of a capability's JSON Schema. A field named in the
 * capability's display fields takes its label, kind and reference from there; otherwise the kind
 * is inferred from the field's name and schema.
 */
export function fieldsOf(
  schema: JsonObject,
  hidden: readonly string[] = [],
  display?: DisplayDeclaration,
): Field[] {
  const properties = (schema.properties ?? {}) as Record<string, Property>;
  const required = new Set((schema.required ?? []) as string[]);
  const declared = new Map((display?.fields ?? []).map((field) => [field.name, field]));
  return Object.entries(properties)
    .filter(([name]) => !hidden.includes(name))
    .map(([name, property]) => {
      const { type, nullable, value } = propertyTypes(property);
      const shown = declared.get(name);
      const kind = shown?.kind ?? inferKind(name, property);
      return {
        name,
        label: shown?.label ?? humanize(name),
        kind,
        choices: (value.enum ?? []).map(String),
        required: required.has(name),
        nullable,
        ...(shown?.reference ? { reference: shown.reference } : {}),
        ...(type ? { type } : {}),
      };
    });
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A date as the `date` or `datetime-local` input edits it, in local time. */
function localDateInput(date: Date, withTime: boolean) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/** A field's string value from a record value, for defaults. */
function toString(field: Field, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (field.kind === 'date' || field.kind === 'date-time') {
    const date = toDate(value);
    return date ? localDateInput(date, field.kind === 'date-time') : String(value);
  }
  if (typeof value === 'string') return value;
  if (field.kind === 'number' || field.kind === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Convert string form values to typed input. An empty optional field is omitted, except that an
 * empty nullable field whose record value was set sends `null`, which clears it.
 */
export function toTyped(
  fields: Field[],
  values: Record<string, string>,
  initial?: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name] ?? '';
    if (raw === '' && !field.required) {
      const had = initial?.[field.name];
      if (field.nullable && had !== undefined && had !== null) input[field.name] = null;
      continue;
    }
    if (raw === '\u0000null') input[field.name] = null;
    else if (field.kind === 'number') input[field.name] = Number(raw.replace(',', '.'));
    else if (field.kind === 'boolean') input[field.name] = raw === 'true';
    else if (field.kind === 'json' || field.kind === 'file') input[field.name] = JSON.parse(raw);
    else if (field.kind === 'date' || field.kind === 'date-time') {
      const date = fromDateInput(raw);
      if (!date) throw new Error(`${field.label} is not a date`);
      input[field.name] =
        field.type === 'number' ? date.getTime() : field.kind === 'date' ? raw : date.toISOString();
    } else input[field.name] = raw;
  }
  return input;
}

/** Form values from a record or an OS prefill: only fields the form renders, as strings. */
export function stringValues(fields: Field[], input: Record<string, unknown> | undefined) {
  const values: Record<string, string> = Object.fromEntries(
    fields.map((field) => [field.name, '']),
  );
  for (const field of fields) values[field.name] = toString(field, input?.[field.name]);
  return values;
}

const selectClass = 'w-full';

/** A select over the records of the referenced collection, titled by its title field. */
function ReferencePicker({
  field,
  id,
  value,
  invalid,
  onChange,
}: {
  field: Field;
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const list = useReferenceList(field.reference);
  return (
    <NativeSelect
      id={id}
      className={selectClass}
      value={value}
      aria-invalid={invalid}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{list.loading ? 'Loading…' : 'Select…'}</option>
      {list.items.map((item) => {
        const key = String(item[list.key]);
        return (
          <option key={key} value={key}>
            {list.title(key)}
          </option>
        );
      })}
      {value && !list.items.some((item) => String(item[list.key]) === value) && (
        <option value={value}>{value}</option>
      )}
      {field.nullable && <option value={'\u0000null'}>None</option>}
    </NativeSelect>
  );
}

/** A file input that uploads the chosen file and holds the blob reference as the value. */
function FileControl({
  id,
  value,
  limits,
  onChange,
}: {
  id: string;
  value: string;
  limits: BlobLimits | undefined;
  onChange: (value: string) => void;
}) {
  const [state, setState] = useState<{ busy?: boolean; error?: string; name?: string }>({});
  const current = value ? (JSON.parse(value) as { size: number; mediaType: string }) : undefined;
  const upload = async (file: File | undefined) => {
    if (!file) return onChange('');
    if (!transport.blobs) return setState({ error: 'This instance keeps no files.' });
    if (limits && file.size > limits.maxBytes)
      return setState({ error: `Largest file: ${formatBytes(limits.maxBytes)}.` });
    setState({ busy: true, name: file.name });
    try {
      const ref = await transport.blobs.put(
        new Uint8Array(await file.arrayBuffer()),
        file.type || 'application/octet-stream',
      );
      onChange(JSON.stringify(ref));
      setState({ name: file.name });
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Upload failed' });
    }
  };
  return (
    <div className="space-y-1">
      <Input
        id={id}
        type="file"
        accept={limits?.mediaTypes.join(',')}
        disabled={state.busy}
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      {state.busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          Uploading {state.name}…
        </p>
      ) : state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : current ? (
        <p className="text-xs text-muted-foreground">
          {state.name ?? current.mediaType}, {formatBytes(current.size)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One generated field: a select for choices, references and optional booleans, a checkbox for a
 * required boolean, a date or date-time input, a file input, a textarea for JSON, else an input.
 */
export function FieldControl({
  field,
  id,
  value,
  errors,
  limits,
  onChange,
}: {
  field: Field;
  id: string;
  value: string;
  errors: readonly unknown[];
  /** The command's blob limits, for a file field. */
  limits?: BlobLimits;
  onChange: (value: string) => void;
}) {
  const invalid = errors.length > 0;
  const optional = !field.required && <span className="text-muted-foreground"> (optional)</span>;
  if (field.kind === 'boolean' && field.required)
    return (
      <div className="flex items-center gap-2 pt-5">
        <input
          id={id}
          type="checkbox"
          className="size-4 accent-primary"
          checked={value === 'true'}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
        />
        <Label htmlFor={id}>{field.label}</Label>
        {invalid && <p className="text-xs text-destructive">{errors.join(', ')}</p>}
      </div>
    );
  return (
    <div className={field.kind === 'json' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
      <Label htmlFor={id}>
        {field.label}
        {optional}
      </Label>
      {field.kind === 'choice' || field.kind === 'status' || field.kind === 'boolean' ? (
        <NativeSelect
          id={id}
          className={selectClass}
          value={value}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select…</option>
          {(field.kind === 'boolean' ? ['true', 'false'] : field.choices).map((choice) => (
            <option key={choice} value={choice}>
              {field.kind === 'boolean' ? (choice === 'true' ? 'Yes' : 'No') : humanize(choice)}
            </option>
          ))}
          {field.nullable && <option value={'\u0000null'}>None</option>}
        </NativeSelect>
      ) : field.kind === 'reference' ? (
        <ReferencePicker
          field={field}
          id={id}
          value={value}
          invalid={invalid}
          onChange={onChange}
        />
      ) : field.kind === 'file' ? (
        <FileControl id={id} value={value} limits={limits} onChange={onChange} />
      ) : field.kind === 'json' ? (
        <Textarea
          id={id}
          className="font-mono"
          value={value}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={
            field.kind === 'date' ? 'date' : field.kind === 'date-time' ? 'datetime-local' : 'text'
          }
          inputMode={field.kind === 'number' ? 'decimal' : undefined}
          value={value}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {invalid && <p className="text-xs text-destructive">{errors.join(', ')}</p>}
    </div>
  );
}

interface FormProps<C extends AnyCapability> {
  capability: C & { kind: 'command' };
  /** Inputs supplied by the screen (for example the selected lot); not rendered as fields. */
  fixed?: Partial<InputOf<C>>;
  /**
   * The record being edited. Its values fill the fields, and emptying a field that had a value
   * sends `null` when the command accepts it, which clears the field.
   */
  initial?: Record<string, unknown>;
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
  initial,
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
  const fields = fieldsOf(capability.input.jsonSchema, Object.keys(fixed), capability.display);
  const { form } = useCapabilityForm(transport, capability, {
    // A prefill overrides the fields it names; the record fills the rest.
    defaultValues: stringValues(fields, { ...initial, ...prepared?.input }),
    toInput: (values) => ({ ...toTyped(fields, values, initial), ...fixed }) as InputOf<C>,
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
              {...(capability.blobs ? { limits: capability.blobs } : {})}
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
 * screen itself, such as a scan, under the same rule. With `initial`, the form edits that record.
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
