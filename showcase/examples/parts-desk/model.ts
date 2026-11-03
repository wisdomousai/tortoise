import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineModelEntry,
  type ModelActivation,
  type ModelEntry,
} from '@agent-native/agents/models';
import type { ModelFiles } from '@agent-native/model-server/arguments';
import { ASSISTANT_MODEL, assistantAgent } from './contracts/assistant-agent';

/** The context window of the entry, which a launch also gives llama-server as `--ctx-size`. */
export const ASSISTANT_CONTEXT_TOKENS = 16_384;

/** What the deployment chooses: the entry, its files on this host and the gate's activation. */
export interface AssistantModel {
  readonly entry: ModelEntry;
  readonly files: ModelFiles;
  readonly activation?: ModelActivation;
}

/** The `parts-desk-assistant` entry for a GGUF base, which only the assistant may run on. */
// #region entry
export function assistantModelEntry(
  base: { readonly name: string; readonly digest: string },
  license: string,
): ModelEntry {
  return defineModelEntry({
    id: ASSISTANT_MODEL,
    title: 'Parts Desk assistant',
    base,
    license,
    contextTokens: ASSISTANT_CONTEXT_TOKENS,
    agents: [assistantAgent.id],
  });
}
// #endregion entry

/**
 * The stand-in weights: fixed text that the llama-server stand-in loads and the plugin measures.
 * The application writes them at run time, because a source export holds no weight files.
 */
const standInText =
  'Stand-in weights for the Parts Desk assistant. The llama-server stand-in loads any file; the model server measures this one against the parts-desk-assistant entry.\n';

/** The entry for the stand-in weights, which the plugin measures at every start. */
export const standInEntry = assistantModelEntry(
  {
    name: 'parts-desk-assistant-stand-in',
    digest: 'sha256:5e53e6d795d9a5fa36295e2fb39811cedeb0a7fdabb05aa84d0298a6ef896d12',
  },
  'MIT',
);

/** The stand-in model, with its weights written once to the temporary directory. */
export function standInModel(): AssistantModel {
  const base = join(tmpdir(), `parts-desk-stand-in-${standInEntry.base.digest.slice(7, 19)}.gguf`);
  if (!existsSync(base)) {
    // Written under another name and renamed, so a concurrent start never measures half a file.
    const partial = `${base}.${process.pid}`;
    writeFileSync(partial, standInText);
    renameSync(partial, base);
  }
  return { entry: standInEntry, files: { base } };
}

/**
 * The model that the JSON file `PARTS_DESK_MODEL` names, with `entry`, `files` and an optional
 * `activation`, as `dev.ts` writes it for `LOCAL_MODEL_GGUF`. Without it, the stand-in model. A
 * deploying site writes its own file with the digests it approved. The plugin measures the files
 * against the entry before every start and refuses a mismatch.
 */
export function assistantModelFrom(
  env: Record<string, string | undefined> = process.env,
): AssistantModel {
  const path = env.PARTS_DESK_MODEL;
  if (!path) return standInModel();
  const model = JSON.parse(readFileSync(path, 'utf8')) as AssistantModel;
  if (model.entry?.id !== ASSISTANT_MODEL)
    throw new Error(
      `PARTS_DESK_MODEL names model ${model.entry?.id}, but the assistant runs on ${ASSISTANT_MODEL}`,
    );
  return model;
}
