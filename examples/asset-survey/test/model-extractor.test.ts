import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import type { NetworkPort } from '@agent-native/host/plugin';
import type { Photo } from '../connectors/extractor';
import { createModelExtractor, modelExtractorFromEnv } from '../connectors/model-extractor';

const photo = (digest: string): Photo => ({
  ref: { digest, size: 3, mediaType: 'image/jpeg' },
  data: new Uint8Array([1, 2, 3]),
});
const photos = [photo('sha256:aa'), photo('sha256:bb')];
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const answer = {
  fields: [
    { name: 'manufacturer', value: ' Norvik ', confidence: 0.97, photo: 0, region: null },
    {
      name: 'serial',
      value: 'BF-0093-221',
      confidence: 1.4,
      photo: 1,
      region: { x: 0.1, y: 0.5, width: 2, height: 0.1 },
    },
    { name: 'serial', value: 'BF-0098-221', confidence: 0.4, photo: 1, region: null },
    // Dropped: not an attribute name, empty, a photo that does not exist.
    { name: 'Rated Voltage', value: '400 V', confidence: 0.9, photo: 0, region: null },
    { name: 'model', value: '  ', confidence: 0.9, photo: 0, region: null },
    { name: 'year', value: '2011', confidence: 0.9, photo: 2, region: null },
  ],
};

describe('model extractor', () => {
  test('sends every photo in one structured call and keeps only well-formed values', async () => {
    const calls: unknown[] = [];
    const extractor = createModelExtractor({
      label: 'mock-vision',
      model: new MockLanguageModelV4({
        doGenerate: async (options) => {
          calls.push(options.prompt);
          return {
            content: [{ type: 'text', text: JSON.stringify(answer) }],
            finishReason: { unified: 'stop', raw: undefined },
            usage,
            warnings: [],
          };
        },
      }),
    });
    const fields = await extractor.extract(photos, 'nameplate', new AbortController().signal);
    expect(extractor.model).toBe('mock-vision');
    expect(fields).toEqual([
      { name: 'manufacturer', value: 'Norvik', confidence: 0.97, source: { digest: 'sha256:aa' } },
      {
        name: 'serial',
        value: 'BF-0093-221',
        confidence: 1,
        source: { digest: 'sha256:bb', region: { x: 0.1, y: 0.5, width: 1, height: 0.1 } },
      },
    ]);
    // One user message: the instructions, then both photos as files.
    const [message] = calls[0] as {
      role: string;
      content: { type: string; mediaType?: string }[];
    }[];
    expect(message!.role).toBe('user');
    expect(message!.content.map((part) => part.mediaType ?? part.type)).toEqual([
      'text',
      'image/jpeg',
      'image/jpeg',
    ]);
    expect(await extractor.extract([], 'nameplate', new AbortController().signal)).toEqual([]);
  });

  test('live extraction is configured only explicitly and reaches only model-api', async () => {
    expect(modelExtractorFromEnv({ OPENAI_API_KEY: 'sk-ambient' })).toBeUndefined();
    const requests: { destination: string; path: string; init?: RequestInit }[] = [];
    const network = {
      client: (destination: string) => ({
        destination,
        fetch: async (path: string | URL, init?: RequestInit) => {
          requests.push({ destination, path: String(path), ...(init ? { init } : {}) });
          return Response.json({
            id: 'chatcmpl-1',
            object: 'chat.completion',
            created: 0,
            model: 'vision-1',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify(answer) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          });
        },
      }),
      routedFetch: () => {
        throw new Error('not used');
      },
    } as unknown as NetworkPort;
    const build = modelExtractorFromEnv({
      ASSET_SURVEY_MODEL: 'vision-1',
      ASSET_SURVEY_MODEL_API_KEY: 'test-key',
      OPENAI_API_KEY: 'sk-ambient',
    });
    const extractor = build!(network);
    const fields = await extractor.extract(photos, 'nameplate', new AbortController().signal);
    expect(fields.map((field) => field.name)).toEqual(['manufacturer', 'serial']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ destination: 'model-api', path: 'chat/completions' });
    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key');
    const body = JSON.parse(String(requests[0]!.init?.body)) as { model: string };
    expect(body.model).toBe('vision-1');
  });
});
