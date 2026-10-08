import { validModel } from './validation';
import type { ModelSummary, ProviderState } from './state';

/** The listed models of an account-specific catalog; unlisted or malformed entries are skipped. */
function listedModels(payload: unknown): ModelSummary[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('models' in payload) ||
    !Array.isArray(payload.models)
  )
    throw new Error('Invalid model catalog');
  // Account-specific SIWC catalog: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
  return payload.models.flatMap((value: unknown): ModelSummary[] => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('visibility' in value) ||
      value.visibility !== 'list' ||
      !('slug' in value) ||
      typeof value.slug !== 'string'
    )
      return [];
    const id = validModel(value.slug);
    const title =
      'display_name' in value && typeof value.display_name === 'string'
        ? value.display_name.slice(0, 200)
        : id;
    return [{ id, title }];
  });
}

/** Fetch the models a ChatGPT plan may use, bounded in time and size; redirects are refused. */
export async function fetchModelCatalog(
  state: ProviderState,
  accessToken: string,
  signal: AbortSignal,
): Promise<ModelSummary[]> {
  const response = await state.fetcher('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error('Account model catalog unavailable');
  const text = await response.text();
  if (text.length > 1_048_576) throw new Error('Model catalog exceeds limit');
  return listedModels(JSON.parse(text));
}
