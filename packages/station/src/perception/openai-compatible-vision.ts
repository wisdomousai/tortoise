import type { Extractor, ExtractionField, FieldValue } from '../ports';
import { parseDisplayed } from './accessibility';

/**
 * Local vision model behind an OpenAI-compatible chat completions endpoint (Ollama, llama.cpp
 * server, vLLM, LM Studio). Screens of the shop floor stay on site: the base URL must be a
 * loopback address or a host the deployment allowlists explicitly; nothing is discovered.
 *
 * Model output is untrusted: it is constrained by a JSON schema where the server supports it and
 * validated again here. Confidence is agreement, not the model's own claim: with `reads` > 1 the
 * same frame is read several times and confidence is the share of reads agreeing with the most
 * common value. With one read, confidence is `singleReadConfidence` (default 0.5), below the
 * usual thresholds, so single model reads become attention items until golden frames justify more.
 */
export interface VisionExtractorOptions {
  readonly id?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly modelVersion?: string;
  /** Non-loopback hosts the deployment approved for frames of this station. */
  readonly allowedHosts?: readonly string[];
  /** Only for servers that require one; supplied by configuration, never read from the host. */
  readonly apiKey?: string;
  readonly reads?: number;
  readonly singleReadConfidence?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

const loopback = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '[::1]' ||
  hostname === '::1' ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

/** Validate the endpoint before any frame is sent; throws for anything not loopback or allowlisted. */
export function visionEndpoint(baseUrl: string, allowedHosts: readonly string[] = []): URL {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Vision endpoint must use http or https');
  if (url.username || url.password) throw new Error('Vision endpoint must not embed credentials');
  if (!loopback(url.hostname) && !allowedHosts.includes(url.hostname))
    throw new Error(`Vision endpoint ${url.hostname} is neither loopback nor allowlisted`);
  return new URL(`${url.href.replace(/\/$/, '')}/chat/completions`);
}

function schemaFor(field: ExtractionField) {
  const base =
    field.type === 'number'
      ? { type: ['number', 'null'] }
      : field.type === 'boolean'
        ? { type: ['boolean', 'null'] }
        : field.type === 'enum'
          ? { type: ['string', 'null'], enum: [...(field.options ?? []), null] }
          : { type: ['string', 'null'], maxLength: 200 };
  return base;
}

function prompt(fields: readonly ExtractionField[], width: number, height: number) {
  const lines = fields.map((field) => {
    const where = field.region
      ? ` inside the box x=${field.region.x}, y=${field.region.y}, width=${field.region.width}, height=${field.region.height}`
      : '';
    const extra = [
      field.unit && `unit ${field.unit}`,
      field.decimals !== undefined && `${field.decimals} decimals`,
      field.options && `one of ${field.options.join(', ')}`,
      field.hint,
    ]
      .filter(Boolean)
      .join('; ');
    return `- "${field.id}" (${field.type})${where}${extra ? `: ${extra}` : ''}`;
  });
  return [
    `This is a ${width}x${height} pixel screenshot of industrial machine software.`,
    'Read exactly what is displayed for each field below. Use null when a field is not visible or not legible. Never guess.',
    ...lines,
    'Answer with one JSON object keyed by field id.',
  ].join('\n');
}

/** Chat completions request: the prompt, the frame and a strict JSON schema over the fields. */
function requestBody(
  model: string,
  image: string,
  fields: readonly ExtractionField[],
  width: number,
  height: number,
) {
  return JSON.stringify({
    model,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt(fields, width, height) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'station_fields',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: fields.map((field) => field.id),
          properties: Object.fromEntries(fields.map((field) => [field.id, schemaFor(field)])),
        },
      },
    },
  });
}

/** Re-validate one value against the field; anything off-type is "not read". */
const fieldValue = (field: ExtractionField, raw: unknown): FieldValue =>
  raw === null || raw === undefined
    ? null
    : typeof raw === 'number' || typeof raw === 'boolean'
      ? field.type === 'number'
        ? typeof raw === 'number' && Number.isFinite(raw)
          ? raw
          : null
        : field.type === 'boolean'
          ? typeof raw === 'boolean'
            ? raw
            : null
          : parseDisplayed(field, String(raw))
      : parseDisplayed(field, String(raw).slice(0, 200));

/** Field values from the model's answer; unparseable output reads as nothing. */
function parseAnswer(content: unknown, fields: readonly ExtractionField[]) {
  let parsed: unknown;
  try {
    parsed =
      typeof content === 'string'
        ? JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
        : undefined;
  } catch {
    parsed = undefined;
  }
  const values: Record<string, FieldValue> = {};
  if (!parsed || typeof parsed !== 'object') return values;
  for (const field of fields)
    values[field.id] = fieldValue(field, (parsed as Record<string, unknown>)[field.id]);
  return values;
}

/** The most common value per field; confidence is the share of reads agreeing with it. */
function agreement(
  fields: readonly ExtractionField[],
  results: readonly Record<string, FieldValue>[],
  singleReadConfidence: number,
) {
  const reads = results.length;
  return fields.map((field) => {
    const counts = new Map<string, { value: FieldValue; count: number }>();
    for (const result of results) {
      const value = result[field.id] ?? null;
      const key = JSON.stringify(value);
      counts.set(key, { value, count: (counts.get(key)?.count ?? 0) + 1 });
    }
    const best = [...counts.values()].sort((a, b) => b.count - a.count)[0]!;
    const confidence =
      best.value === null ? 0 : reads === 1 ? singleReadConfidence : best.count / reads;
    return { field: field.id, value: best.value, confidence };
  });
}

export function createOpenAiCompatibleVisionExtractor(options: VisionExtractorOptions): Extractor {
  const endpoint = visionEndpoint(options.baseUrl, options.allowedHosts);
  const fetcher = options.fetch ?? fetch;
  const reads = Math.max(1, Math.min(5, options.reads ?? 1));

  async function readOnce(
    image: string,
    fields: readonly ExtractionField[],
    width: number,
    height: number,
    signal: AbortSignal,
  ): Promise<Record<string, FieldValue>> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
    const response = await fetcher(endpoint, {
      method: 'POST',
      // The allowlist is the user's control over where screen content goes; a redirect would
      // forward the screenshot to a host that was never validated.
      redirect: 'error',
      signal: AbortSignal.any([signal, timeout]),
      headers: {
        'content-type': 'application/json',
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: requestBody(options.model, image, fields, width, height),
    });
    // Status only: response bodies may echo prompts or server details.
    if (!response.ok) throw new Error(`Vision endpoint answered ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    return parseAnswer(body.choices?.[0]?.message?.content, fields);
  }

  return {
    id: options.id ?? 'vision',
    modality: 'vision',
    model: {
      id: options.model,
      ...(options.modelVersion ? { version: options.modelVersion } : {}),
    },
    async extract(frame, fields, signal) {
      if (!frame.image || fields.length === 0) return [];
      const image = Buffer.from(frame.image).toString('base64');
      const results: Record<string, FieldValue>[] = [];
      for (let index = 0; index < reads; index++)
        results.push(await readOnce(image, fields, frame.width, frame.height, signal));
      return agreement(fields, results, options.singleReadConfidence ?? 0.5);
    },
  };
}
