import { useRef } from 'react';
import { useForm } from '@tanstack/react-form';
import {
  ApplicationError,
  canonicalJson,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@tortoise/contracts';
import type { CommandResult, Transport } from '@tortoise/client';

const newKey = () => crypto.randomUUID();

/** Top-level input field named by a Standard Schema issue path, if any. */
function issueField(path: readonly unknown[] | undefined): string | undefined {
  const first = path?.[0];
  const key = typeof first === 'object' && first !== null ? (first as { key: unknown }).key : first;
  return typeof key === 'string' ? key : undefined;
}

/** Field errors keyed by form field, plus a form-level message, in TanStack Form's shape. */
type SubmitErrors = { form?: string; fields: Record<string, string> };

/** Schema issues on the fields the form has; the rest become the form-level message. */
function issueErrors(
  issues: readonly { readonly message: string; readonly path?: readonly unknown[] }[],
  field: (name: string | undefined) => string | undefined,
): SubmitErrors {
  const errors: SubmitErrors = { fields: {} };
  for (const issue of issues) {
    const name = field(issueField(issue.path));
    if (name) errors.fields[name] ??= issue.message;
    else errors.form ??= issue.message;
  }
  return errors;
}

/**
 * Map a failed command to form errors. `rotate` starts a fresh idempotency key; `retryFresh`
 * drops the frozen input so the next submit maps the (possibly edited) values again.
 */
function failureErrors(
  error: unknown,
  field: (name: string | undefined) => string | undefined,
  attempts: { rotate(): void; retryFresh(): void },
): SubmitErrors {
  if (!(error instanceof ApplicationError))
    // Unknown outcome (network): keep the key so a retry replays instead of duplicating.
    return { form: 'Not saved yet. Check the connection and retry.', fields: {} };
  // The key already committed different input; that commit stands, so start fresh.
  if (error.code === 'IDEMPOTENCY_CONFLICT') {
    attempts.rotate();
    return {
      form: 'An earlier attempt from this form was already saved. Review the latest data.',
      fields: {},
    };
  }
  // Nothing committed: the next submit maps the (possibly edited) values afresh.
  attempts.retryFresh();
  const details = error.details as { field?: unknown } | undefined;
  const name = typeof details?.field === 'string' ? field(details.field) : undefined;
  return name ? { fields: { [name]: error.message } } : { form: error.message, fields: {} };
}

export interface CapabilityFormOptions<C extends AnyCapability, Values> {
  readonly defaultValues: Values;
  /**
   * Map form values to the command input, for example parsing a numeric text field or stamping
   * `occurredAt`. It runs once per attempt: retries with unchanged values reuse the same input,
   * so a time-dependent mapping cannot turn a replay into an idempotency conflict.
   */
  readonly toInput: (values: Values) => InputOf<C>;
  /** Base revisions of what the user is editing; a newer commit elsewhere conflicts. */
  readonly expectedRevisions?: (values: Values) => Readonly<Record<string, number>> | undefined;
  /** Map an input field named by the schema or `ApplicationError.details.field` to a form field. */
  readonly fieldFor?: (inputField: string) => string | undefined;
  readonly onCommitted?: (commandResult: CommandResult<OutputOf<C>>, values: Values) => void;
}

/**
 * A TanStack Form bound to one command capability.
 *
 * Guarantees:
 * - Input is validated with the capability's own schema (the same one the instance enforces),
 *   via Standard Schema, before any request.
 * - The idempotency key is created when the form opens and reused for every retry until the
 *   command commits, so double taps, scanner double-sends and retries after a lost response
 *   record one datapoint. A new key is created only after a commit.
 * - The mapped input is frozen per attempt: a retry with unchanged values sends byte-identical
 *   input under the same key and replays the original command result.
 * - Server validation (`ApplicationError.details.field`) is shown on the offending field when the
 *   form has that field; other failures, including CONFLICT, become a form error and the draft
 *   is kept.
 *
 * The instance still authorizes and validates; nothing here is a security boundary.
 */
export function useCapabilityForm<C extends AnyCapability, Values extends object>(
  transport: Transport,
  capability: C & { kind: 'command' },
  options: CapabilityFormOptions<C, Values>,
) {
  const key = useRef<string>(undefined);
  key.current ??= newKey();
  const latest = useRef(options);
  latest.current = options;
  const commandResult = useRef<CommandResult<OutputOf<C>>>(undefined);
  const attempt = useRef<{ values: string; input: InputOf<C> }>(undefined);
  const rotate = () => {
    key.current = newKey();
    attempt.current = undefined;
  };
  const field = (name: string | undefined) => {
    const mapped = name === undefined ? undefined : (latest.current.fieldFor?.(name) ?? name);
    return mapped !== undefined && Object.hasOwn(latest.current.defaultValues, mapped)
      ? mapped
      : undefined;
  };

  const form = useForm({
    defaultValues: options.defaultValues,
    validators: {
      // Validation and the command run together so server field errors use the same channel.
      onSubmitAsync: async ({ value }): Promise<SubmitErrors | undefined> => {
        const values = canonicalJson(value);
        let input: InputOf<C>;
        try {
          input =
            attempt.current?.values === values
              ? attempt.current.input
              : latest.current.toInput(value);
        } catch (error) {
          return { form: error instanceof Error ? error.message : 'Invalid input', fields: {} };
        }
        attempt.current = { values, input };
        const checked = await capability.input['~standard'].validate(input);
        if (checked.issues) return issueErrors(checked.issues, field);
        try {
          commandResult.current = await transport.command<OutputOf<C>>(capability.id, input, {
            idempotencyKey: key.current!,
            ...(latest.current.expectedRevisions?.(value)
              ? { expectedRevisions: latest.current.expectedRevisions(value) }
              : {}),
          });
          return undefined;
        } catch (error) {
          return failureErrors(error, field, {
            rotate,
            retryFresh: () => (attempt.current = undefined),
          });
        }
      },
    },
    onSubmit: ({ value }) => {
      const committed = commandResult.current;
      if (!committed) return;
      commandResult.current = undefined;
      rotate();
      latest.current.onCommitted?.(committed, value);
    },
  });
  return { form, idempotencyKey: () => key.current! };
}
