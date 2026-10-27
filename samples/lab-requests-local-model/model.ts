import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defineModelEntry,
  type ModelActivation,
  type ModelEntry,
} from '@agent-native/agents/models';
import type { ModelFiles } from '@agent-native/model-server/arguments';
import { METHOD_MODEL, methodSuggester } from './contracts';

/** What the deployment chooses: the entry, its files on this host and the gate's activation. */
export interface MethodModel {
  readonly entry: ModelEntry;
  readonly files: ModelFiles;
  readonly activation?: ModelActivation;
}

/** The weights file the llama-server stand-in loads, committed with the sample. */
export const standInWeights = join(import.meta.dir, 'model', 'stand-in-weights.bin');

/** The `lab-methods` base entry for the stand-in weights, which the plugin measures at start. */
export const standInModel: MethodModel = {
  entry: defineModelEntry({
    id: METHOD_MODEL,
    base: {
      name: 'lab-methods-stand-in',
      digest: 'sha256:e3d711d124c0de82ae1b30de8d26f6c9e080b3e60681e3cd0e16a1aad133b8fa',
    },
    license: 'MIT',
    contextTokens: 4096,
    agents: [methodSuggester.id],
  }),
  files: { base: standInWeights },
};

/**
 * Demo only: the model the JSON file `LAB_METHOD_MODEL` names, with `entry`, `files` and an
 * optional `activation`, as `dev.ts` writes it for real weights. The stand-in model otherwise.
 * A deploying application passes its own.
 */
export function methodModelFrom(
  env: Record<string, string | undefined> = process.env,
): MethodModel {
  const path = env.LAB_METHOD_MODEL;
  return path ? (JSON.parse(readFileSync(path, 'utf8')) as MethodModel) : standInModel;
}
