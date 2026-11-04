import type { ModelEntry } from '@tortoise/agents/models';
import type { ModelRuntime } from './contracts';

/** The weights on this host: the base, and the adapter or merged fine-tune its entry names. */
export interface ModelFiles {
  readonly base: string;
  readonly adapter?: string;
}

/**
 * The arguments the plugin adds after the site binding's fixed ones (which set the listening
 * address): what to load and the name to list it under, which is always the entry ID. A merged
 * fine-tune is loaded instead of its base; a LoRA adapter is loaded on top of it.
 */
export function serverArguments(
  runtime: ModelRuntime,
  entry: ModelEntry,
  files: ModelFiles,
): string[] {
  const { adapter } = entry;
  if (adapter && !files.adapter)
    throw new Error(`Model ${entry.id} names an adapter but no adapter file is configured`);
  if (!adapter && files.adapter)
    throw new Error(`Model ${entry.id} has no adapter, but an adapter file is configured`);
  const weights = adapter?.kind === 'merged' ? files.adapter! : files.base;
  const lora = adapter?.kind === 'lora' ? files.adapter : undefined;
  if (runtime === 'llama-server')
    return ['--model', weights, ...(lora ? ['--lora', lora] : []), '--alias', entry.id];
  // vLLM lists a LoRA under its module name and the base under the served model name.
  return lora
    ? [
        'serve',
        weights,
        '--served-model-name',
        `${entry.id}-base`,
        '--enable-lora',
        '--lora-modules',
        `${entry.id}=${lora}`,
      ]
    : ['serve', weights, '--served-model-name', entry.id];
}
