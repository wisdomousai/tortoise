import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runGolden, type GoldenFrame } from '../src/golden';
import { createAccessibilityExtractor } from '../src/recognition/accessibility';
import { createFixtureExtractor } from '../src/recognition/fixture';
import {
  createOpenAiCompatibleVisionExtractor,
  visionEndpoint,
} from '../src/recognition/openai-compatible-vision';
import { createWorkerExtractor } from '../src/recognition/worker';
import type { ExtractionField, Frame } from '../src/ports';
import { toAccessibility } from '../src/transports/playwright';
import { createHmi, profile } from './support';

const signal = new AbortController().signal;
const echoWorker = fileURLToPath(new URL('./fixtures/echo-worker.ts', import.meta.url));
/** Starts the fixture worker directly; a host starts it through its process port instead. */
async function startEchoWorker() {
  const child = spawn(process.execPath, [echoWorker], { env: {}, stdio: 'pipe' });
  return { child, terminate: () => void child.kill() };
}
const pixels: Frame = {
  capturedAt: 1,
  width: 1024,
  height: 768,
  digest: 'f1',
  image: new Uint8Array([1, 2, 3]),
};
const fields: ExtractionField[] = [
  { id: 'count', type: 'number', decimals: 0 },
  { id: 'machine', type: 'enum', options: ['STOPPED', 'RUNNING'] },
];

test('vision endpoints must be loopback or explicitly allowlisted, without embedded credentials', () => {
  expect(visionEndpoint('http://127.0.0.1:11434/v1').href).toBe(
    'http://127.0.0.1:11434/v1/chat/completions',
  );
  expect(visionEndpoint('http://localhost:8080/v1/').href).toBe(
    'http://localhost:8080/v1/chat/completions',
  );
  expect(() => visionEndpoint('https://api.example.com/v1')).toThrow(
    'neither loopback nor allowlisted',
  );
  expect(visionEndpoint('http://gpu-box.plant.local/v1', ['gpu-box.plant.local']).hostname).toBe(
    'gpu-box.plant.local',
  );
  expect(() => visionEndpoint('http://user:pw@localhost/v1')).toThrow('credentials');
  expect(() => visionEndpoint('file:///etc/passwd')).toThrow('http');
});

test('vision confidence is agreement across reads, and off-type values are not read', async () => {
  const replies = [
    { count: 1200, machine: 'stopped' },
    { count: 1200, machine: 'RUNNING' },
    { count: '1 200', machine: 'Exploded' },
  ];
  const requests: any[] = [];
  const extractor = createOpenAiCompatibleVisionExtractor({
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5vl:7b',
    reads: 3,
    fetch: (async (_url: URL, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        choices: [{ message: { content: JSON.stringify(replies[requests.length - 1]) } }],
      });
    }) as unknown as typeof fetch,
  });
  const readings = await extractor.extract(pixels, fields, signal);
  expect(readings).toEqual([
    { field: 'count', value: 1200, confidence: 1 },
    // 'stopped' normalizes to STOPPED; 'Exploded' is not an option and counts as not read.
    { field: 'machine', value: 'STOPPED', confidence: 1 / 3 },
  ]);
  expect(requests[0].messages[0].content[1].image_url.url).toStartWith('data:image/png;base64,');
  expect(requests[0].response_format.json_schema.schema.required).toEqual(['count', 'machine']);
  expect(extractor.model).toEqual({ id: 'qwen2.5vl:7b' });
});

test('a single vision read is never confident enough to become a fact by default', async () => {
  const extractor = createOpenAiCompatibleVisionExtractor({
    baseUrl: 'http://[::1]:8000/v1',
    model: 'local-vlm',
    fetch: (async () =>
      Response.json({
        choices: [{ message: { content: '```json\n{"count": 7, "machine": null}\n```' } }],
      })) as unknown as typeof fetch,
  });
  expect(await extractor.extract(pixels, fields, signal)).toEqual([
    { field: 'count', value: 7, confidence: 0.5 },
    { field: 'machine', value: null, confidence: 0 },
  ]);
});

test('vision errors report status only', async () => {
  const extractor = createOpenAiCompatibleVisionExtractor({
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'm',
    fetch: (async () =>
      new Response('secret prompt echo', { status: 500 })) as unknown as typeof fetch,
  });
  await expect(extractor.extract(pixels, fields, signal)).rejects.toThrow(
    /^Vision endpoint returned 500$/,
  );
});

test('a JSON-lines worker reports its model and returns only requested fields', async () => {
  const worker = createWorkerExtractor({
    id: 'worker-ocr',
    modality: 'ocr',
    start: startEchoWorker,
    startupTimeoutMs: 10_000,
  });
  try {
    expect(await worker.extract(pixels, fields, signal)).toEqual([
      { field: 'count', value: 42, confidence: 0.8 },
      { field: 'machine', value: 'machine:pixels', confidence: 0.8 },
    ]);
    expect(worker.model).toEqual({ id: 'echo-ocr', version: '0.1' });
    await expect(worker.extract(pixels, [{ id: 'boom', type: 'text' }], signal)).rejects.toThrow(
      'worker-ocr: cannot read',
    );
  } finally {
    await worker.close();
  }
});

test('a worker that exits is restarted and becomes ready again', async () => {
  const worker = createWorkerExtractor({
    id: 'worker-ocr',
    modality: 'ocr',
    start: startEchoWorker,
    startupTimeoutMs: 5_000,
  });
  try {
    const [reading] = await worker.extract(pixels, [{ id: 'exit', type: 'text' }], signal);
    expect(reading).toMatchObject({ field: 'exit' });
    // Wait for the first process to be gone, then the next request needs a second lifetime.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await worker.extract(pixels, fields, signal)).toHaveLength(2);
    expect(worker.model).toEqual({ id: 'echo-ocr', version: '0.1' });
  } finally {
    await worker.close();
  }
}, 10_000);

test('vision requests never follow a redirect away from the configured endpoint', async () => {
  let forwarded = 0;
  const elsewhere = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => (forwarded++, Response.json({ choices: [] })),
  });
  const configured = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.redirect(`http://127.0.0.1:${elsewhere.port}/v1/chat/completions`, 307),
  });
  try {
    const extractor = createOpenAiCompatibleVisionExtractor({
      baseUrl: `http://127.0.0.1:${configured.port}/v1`,
      model: 'm',
    });
    await expect(extractor.extract(pixels, fields, signal)).rejects.toThrow();
    expect(forwarded).toBe(0);
  } finally {
    configured.stop(true);
    elsewhere.stop(true);
  }
});

test('Playwright aria JSON maps to accessibility nodes with boxes', () => {
  expect(
    toAccessibility([
      {
        role: 'dialog',
        name: 'Load recipe',
        box: { x: 1, y: 2, width: 3, height: 4 },
        children: [
          'Pick one',
          { role: 'textbox', name: 'Recipe', text: 'R-1', disabled: true },
          { nope: 1 },
        ],
      },
    ]),
  ).toEqual([
    {
      role: 'dialog',
      name: 'Load recipe',
      box: { x: 1, y: 2, width: 3, height: 4 },
      children: [
        { role: 'text', text: 'Pick one' },
        { role: 'textbox', name: 'Recipe', text: 'R-1' },
      ],
    },
  ]);
});

test('golden frames gate on confident misreads, not on uncertainty', async () => {
  const hmi = createHmi();
  const main = await hmi.transport.capture(signal);
  hmi.state.screen = 'popup';
  const popup = await hmi.transport.capture(signal);
  const recorded = (count: number, confidence: number) =>
    createFixtureExtractor(
      { [main.digest]: { count: { value: count, confidence } } },
      { id: 'ocr', modality: 'ocr' },
    );
  const frames: GoldenFrame[] = [
    {
      name: 'main',
      frame: main,
      screen: 'main',
      expected: { machine: 'STOPPED', recipe: 'R-10', count: 1200 },
    },
    { name: 'popup', frame: popup, screen: null, expected: {} },
  ];

  const unsure = await runGolden(
    profile,
    [createAccessibilityExtractor(), recorded(1290, 0.5)],
    frames,
  );
  expect(unsure.pass).toBe(true);
  expect(unsure.fields.find((field) => field.field === 'count')).toMatchObject({
    correct: 0,
    confident: 0,
  });

  const wrong = await runGolden(
    profile,
    [createAccessibilityExtractor(), recorded(1290, 0.95)],
    frames,
  );
  expect(wrong.pass).toBe(false);
  expect(wrong.fields.find((field) => field.field === 'count')).toMatchObject({
    wrongButConfident: 1,
  });
  expect(wrong.screens).toEqual({ frames: 2, correct: 2 });
});
