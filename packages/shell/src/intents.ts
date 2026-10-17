import type { CatalogOs, OsInstruction, RawOsRequest } from '@agent-native/contracts';
import { parseRawOsRequest } from './parse';

/** An extra as it crosses to and from the platform: Android bundles carry flat values here. */
export type AndroidExtra = string | number | boolean;

/** An activity intent the OS delivered, as the device reports it. Untrusted. */
export interface AndroidIntentRecord {
  readonly action: string;
  readonly categories?: readonly string[];
  readonly data?: string;
  /** The intent's MIME type. */
  readonly type?: string;
  readonly extras?: Readonly<Record<string, AndroidExtra>>;
}

/** An explicit intent the device starts: the declared action, to the declared package. */
export interface AndroidIntent {
  readonly action: string;
  readonly package: string;
  readonly extras?: Readonly<Record<string, AndroidExtra>>;
}

export type AndroidExtraType = 'string' | 'number' | 'boolean';

/**
 * What the device passes on: per declared intent handler's action, the extras that handler
 * declares and their types. The device reads only these extras, with typed getters, so it never
 * unpacks a value the application did not ask for.
 */
export type IntentListening = Readonly<Record<string, Readonly<Record<string, AndroidExtraType>>>>;

export function intentListening(os: CatalogOs): IntentListening {
  const listening: Record<string, Record<string, AndroidExtraType>> = {};
  for (const handler of os.handlers) {
    if (handler.kind !== 'intent') continue;
    const properties = (handler.extras?.properties ?? {}) as Record<string, { type?: unknown }>;
    listening[handler.action] = Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [
        name,
        property.type === 'integer' ? 'number' : (property.type as AndroidExtraType),
      ]),
    );
  }
  return listening;
}

/**
 * The OS request an intent stands for, or `undefined` when it is malformed or its action is not
 * one being listened for. The record comes from another app through the platform, so it is checked
 * as unknown input; the shell port matches it against the handlers and their extras schemas.
 */
export function intentRequest(
  record: unknown,
  listening: IntentListening,
): RawOsRequest | undefined {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return undefined;
  const { action, categories, data, type, extras } = record as Record<string, unknown>;
  if (typeof action !== 'string' || !Object.hasOwn(listening, action)) return undefined;
  try {
    return parseRawOsRequest({
      kind: 'intent',
      action,
      ...(categories !== undefined ? { categories } : {}),
      ...(data !== undefined && data !== null ? { data } : {}),
      ...(type !== undefined && type !== null ? { mimeType: type } : {}),
      ...(extras !== undefined && extras !== null ? { extras } : {}),
    });
  } catch {
    return undefined;
  }
}

/**
 * The explicit intent to start for an instruction, checked again against the declared intent
 * actions: the action id, the intent action and the package must all be the declared ones,
 * and every extra a flat value. `undefined` otherwise.
 */
export function intentToStart(
  os: CatalogOs,
  instruction: Extract<OsInstruction, { kind: 'intent' }>,
): AndroidIntent | undefined {
  const declared = os.actions.find((action) => action.id === instruction.action);
  if (
    declared?.kind !== 'intent' ||
    declared.action !== instruction.intent ||
    declared.package !== instruction.package
  )
    return undefined;
  const extras = Object.entries(instruction.extras ?? {});
  if (extras.some(([, value]) => !['string', 'number', 'boolean'].includes(typeof value)))
    return undefined;
  return {
    action: instruction.intent,
    package: instruction.package,
    ...(extras.length
      ? { extras: Object.fromEntries(extras) as Record<string, AndroidExtra> }
      : {}),
  };
}
