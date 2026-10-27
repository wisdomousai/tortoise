import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * The stand-in weights: fixed text that the llama-server stand-in loads and the plugin measures.
 * The pattern writes them at run time, because a source export carries no weight files.
 */
const standInText =
  'Stand-in weights for the local model pattern. The llama-server stand-in loads any file; the model server measures this one against the lab-methods entry.\n';

/** The `lab-methods` base entry for the stand-in weights, which the plugin measures at start. */
export const standInEntry: ModelEntry = defineModelEntry({
  id: METHOD_MODEL,
  base: {
    name: 'lab-methods-stand-in',
    digest: 'sha256:4303509a67d363f6060b4b36599bf3a0678e1891ed7ae8233127a28b639d748e',
  },
  license: 'MIT',
  contextTokens: 4096,
  agents: [methodSuggester.id],
});

/** The stand-in model, with its weights written once to the temporary directory. */
export function standInModel(): MethodModel {
  const base = join(tmpdir(), `lab-methods-stand-in-${standInEntry.base.digest.slice(7, 19)}.bin`);
  if (!existsSync(base)) {
    // Written under another name and renamed, so a concurrent start never measures half a file.
    const partial = `${base}.${process.pid}`;
    writeFileSync(partial, standInText);
    renameSync(partial, base);
  }
  return { entry: standInEntry, files: { base } };
}

/**
 * Demo only: the model the JSON file `LAB_METHOD_MODEL` names, with `entry`, `files` and an
 * optional `activation`, as `dev.ts` writes it for real weights. The stand-in model otherwise.
 * A deploying application passes its own.
 */
export function methodModelFrom(
  env: Record<string, string | undefined> = process.env,
): MethodModel {
  const path = env.LAB_METHOD_MODEL;
  return path ? (JSON.parse(readFileSync(path, 'utf8')) as MethodModel) : standInModel();
}
