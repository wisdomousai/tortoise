import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { NetworkPort } from '@agent-native/host/plugin';
import { attributeName } from '../contracts/schemas';
import type { ProposedField } from '../domain';
import type { Extractor, Photo } from './extractor';

/** The attribute names the model is asked to use, so values land on the same node fields. */
export const NAMEPLATE_FIELDS = [
  'manufacturer',
  'model',
  'serial',
  'year',
  'ratedVoltage',
  'ratedCurrent',
  'ratedPower',
  'frequency',
  'phases',
  'speed',
  'powerFactor',
  'efficiencyClass',
  'insulationClass',
  'protection',
  'breakingCapacity',
  'vectorGroup',
  'impedance',
  'pressure',
  'pressureClass',
  'flow',
  'head',
  'size',
  'bodyMaterial',
  'weight',
  'standard',
] as const;

// Every property required and nullable: OpenAI-compatible strict schemas allow no optionals.
const answerSchema = z.object({
  fields: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      confidence: z.number(),
      photo: z.number().int(),
      region: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .nullable(),
    }),
  ),
});
type Answer = z.output<typeof answerSchema>;

const instructions = (kind: string, count: number) =>
  [
    `You read equipment ${kind} photos from an industrial site survey (${count} photo${count === 1 ? '' : 's'}, numbered from 0 in order).`,
    'Transcribe only values printed on the equipment. Never guess or complete a value; leave out a field you cannot read.',
    `Use these names where they fit: ${NAMEPLATE_FIELDS.join(', ')}. Any other value gets a short lowerCamelCase name.`,
    'Keep each value as printed, including its unit (for example "6300 A", "24 kV", "IP55").',
    'confidence is your certainty from 0 to 1 that the value is exactly what the plate shows; below 0.8 when any character is worn, covered or ambiguous.',
    'photo is the number of the photo the value was read from. region is where it appears, as fractions of that photo (x, y of the top left corner, width, height), or null.',
  ].join('\n');

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The model's answer as proposals. The answer is outside this application's trust: a name that
 * is not an attribute name, a value that is empty or too long, or a photo number that does not
 * exist is dropped; confidence and region are clamped to [0, 1]; of two values with one name the
 * more confident one stays.
 */
export function proposedFields(answer: Answer, photos: readonly Photo[]): ProposedField[] {
  const byName = new Map<string, ProposedField>();
  for (const field of answer.fields) {
    const value = field.value.trim();
    const photo = photos[field.photo];
    if (!attributeName.safeParse(field.name).success || !value || value.length > 200 || !photo)
      continue;
    const region = field.region && {
      x: clamp(field.region.x),
      y: clamp(field.region.y),
      width: clamp(field.region.width),
      height: clamp(field.region.height),
    };
    const proposed: ProposedField = {
      name: field.name,
      value,
      confidence: clamp(field.confidence),
      source: { digest: photo.ref.digest, ...(region ? { region } : {}) },
    };
    const kept = byName.get(field.name);
    if (!kept || kept.confidence < proposed.confidence) byName.set(field.name, proposed);
  }
  return [...byName.values()];
}

/**
 * A vision model as the extractor: one structured-output call per request with every photo of
 * the capture. A failed call throws, so the outbox retries the request later.
 */
export function createModelExtractor(options: {
  readonly model: LanguageModel;
  /** Recorded with each proposal, so a reviewer sees which model read it. */
  readonly label: string;
  readonly maxOutputTokens?: number;
}): Extractor {
  return {
    model: options.label,
    async extract(photos, kind, signal) {
      if (!photos.length) return [];
      const { output } = await generateText({
        model: options.model,
        abortSignal: signal,
        maxOutputTokens: options.maxOutputTokens ?? 2_000,
        output: Output.object({ schema: answerSchema }),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instructions(kind, photos.length) },
              ...photos.map((photo) => ({
                type: 'file' as const,
                mediaType: photo.ref.mediaType,
                data: photo.data,
              })),
            ],
          },
        ],
      });
      return proposedFields(output, photos);
    },
  };
}

// Requests name this origin; the network port sends their path to the site's `model-api` URL.
const PLACEHOLDER = 'http://model-api.invalid';

/** A `fetch` for the provider SDK that reaches only the `model-api` destination. */
function modelApiFetch(network: NetworkPort): typeof fetch {
  const adapter = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input));
    if (url.origin !== PLACEHOLDER) throw new Error('Model requests stay on model-api');
    return network
      .client('model-api')
      .fetch(
        `${url.pathname.replace(/^\/+/, '')}${url.search}`,
        request
          ? { method: request.method, headers: request.headers, body: request.body, ...init }
          : init,
      );
  };
  return adapter as typeof fetch;
}

/**
 * Opt-in live extraction through an OpenAI-compatible chat completions API. Configured only by
 * `ASSET_SURVEY_MODEL` (the model ID) and `ASSET_SURVEY_MODEL_API_KEY`; the address is the site
 * policy's `model-api` binding, for example `https://api.openai.com/v1` or a local server's
 * `http://127.0.0.1:11434/v1`. No other variable, key store or provider login is read. Without
 * `ASSET_SURVEY_MODEL` the answer is undefined and the demo extractor stays.
 */
export function modelExtractorFromEnv(
  env: Record<string, string | undefined> = process.env,
): ((network: NetworkPort) => Extractor) | undefined {
  const model = env.ASSET_SURVEY_MODEL?.trim();
  if (!model) return undefined;
  return (network) =>
    createModelExtractor({
      label: model,
      model: createOpenAI({
        name: 'asset-survey-model',
        // A local server accepts any key; a hosted one refuses the placeholder.
        apiKey: env.ASSET_SURVEY_MODEL_API_KEY ?? 'none',
        baseURL: PLACEHOLDER,
        fetch: modelApiFetch(network),
      }).chat(model),
    });
}
