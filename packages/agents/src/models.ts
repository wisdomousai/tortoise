import type { ModelIdentity } from './types';

/** `sha256:` and 64 lowercase hex digits, the form every model digest takes. */
export const MODEL_DIGEST = /^sha256:[0-9a-f]{64}$/;
const ENTRY_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/**
 * One model a deployment may serve on this host: base weights, an optional adapter (a LoRA or a
 * merged fine-tune) and what it was tuned on, each by content digest. Server-side data; the file
 * paths live with the server that loads them, not here.
 */
export interface ModelEntry {
  /** Lowercase ID, also the name the server lists the model under at `/v1/models`. */
  readonly id: string;
  readonly title?: string;
  readonly base: { readonly name: string; readonly digest: string };
  readonly adapter?: {
    readonly kind: 'lora' | 'merged';
    readonly digest: string;
    /** Digest of the dataset export it was trained on (`exportApprovalDataset`). */
    readonly dataset?: string;
  };
  /** The weights' license, as an SPDX ID or the license's name. */
  readonly license: string;
  /** Context window in tokens. */
  readonly contextTokens: number;
  /** Agent definitions allowed to run on it, by ID; omitted allows any agent that asks for local. */
  readonly agents?: readonly string[];
}

/** Validate and freeze a model entry. Throws naming the first problem. */
export function defineModelEntry(entry: ModelEntry): ModelEntry {
  if (!ENTRY_ID.test(entry.id) || entry.id.length > 64)
    throw new Error(`Invalid model entry ID: ${entry.id}`);
  if (!entry.base?.name?.trim() || !MODEL_DIGEST.test(entry.base.digest))
    throw new Error(`Model ${entry.id} needs a base name and a sha256 digest`);
  if (entry.adapter) {
    if (!['lora', 'merged'].includes(entry.adapter.kind))
      throw new Error(`Model ${entry.id} adapter kind must be lora or merged`);
    if (!MODEL_DIGEST.test(entry.adapter.digest))
      throw new Error(`Model ${entry.id} adapter needs a sha256 digest`);
    if (entry.adapter.dataset !== undefined && !MODEL_DIGEST.test(entry.adapter.dataset))
      throw new Error(`Model ${entry.id} dataset digest must be a sha256 digest`);
  }
  if (!entry.license?.trim()) throw new Error(`Model ${entry.id} needs a license`);
  if (!Number.isInteger(entry.contextTokens) || entry.contextTokens < 1)
    throw new Error(`Model ${entry.id} context size must be a positive integer`);
  if (entry.agents && (!entry.agents.length || entry.agents.some((id) => !ENTRY_ID.test(id))))
    throw new Error(`Model ${entry.id} agents must be agent IDs`);
  return Object.freeze({ ...entry });
}

/** The identity a run records for an entry; `verified` when the host measured the files. */
export function entryIdentity(entry: ModelEntry, verified: boolean): ModelIdentity {
  return {
    provider: 'local',
    model: entry.id,
    entry: entry.id,
    digest: entry.base.digest,
    ...(entry.adapter ? { adapterDigest: entry.adapter.digest } : {}),
    ...(entry.adapter?.dataset ? { datasetDigest: entry.adapter.dataset } : {}),
    verified,
  };
}

/**
 * The record an activation gate leaves for one entry: which digests were judged, against which
 * scenarios, and whether it may serve. A managed server refuses a fine-tuned entry without a
 * passing activation for exactly these digests.
 */
export interface ModelActivation {
  readonly entry: string;
  readonly base: string;
  readonly adapter?: string;
  readonly dataset?: string;
  /** Digest of the scenario names and expectations the candidate was judged on. */
  readonly scenarios: string;
  readonly passed: boolean;
  readonly results: readonly { readonly scenario: string; readonly passed: boolean }[];
  /** Scenarios the model it replaces passed and this one failed. */
  readonly regressions: readonly string[];
  /** The entry it was compared with, when there was one. */
  readonly baseline?: string;
  readonly at: number;
}

/** Whether `activation` is a passing one for exactly this entry's digests. */
export function activates(activation: ModelActivation | undefined, entry: ModelEntry): boolean {
  return (
    !!activation &&
    activation.passed &&
    activation.entry === entry.id &&
    activation.base === entry.base.digest &&
    activation.adapter === entry.adapter?.digest &&
    activation.dataset === entry.adapter?.dataset
  );
}
