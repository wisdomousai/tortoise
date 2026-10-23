import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildCatalog,
  defineCapability,
  defineModule,
  defineWorkflow,
  from,
  jsonSchema,
  step,
  workflowMarkdown,
  type AnyCapability,
  type WorkflowStep,
} from '../src/index';

const capability = (id: string, kind: 'command' | 'query', input: z.ZodObject, extra = {}) =>
  defineCapability({
    id,
    kind,
    input: jsonSchema(input),
    output: jsonSchema(z.strictObject({ id: z.string(), status: z.string().optional() })),
    permission: { action: kind === 'command' ? 'update' : 'read', resourceType: 'Capture' },
    ui: { exception: 'test fixture' },
    ...extra,
  });
const place = capability(
  'capture.place',
  'command',
  z.strictObject({ id: z.string(), nodeId: z.string() }),
);
const unplace = capability('capture.unplace', 'command', z.strictObject({ id: z.string() }));
const extract = capability(
  'extraction.request',
  'command',
  z.strictObject({ captureId: z.string() }),
);
const status = capability('extraction.get', 'query', z.strictObject({ captureId: z.string() }));
const start = capability('workflow.start', 'command', z.strictObject({ workflow: z.string() }));
const spawning = capability('capture.spawn', 'command', z.strictObject({}), {
  invokes: ['workflow.start'],
});
const capabilities: AnyCapability[] = [place, unplace, extract, status, start, spawning];

const steps: WorkflowStep[] = [
  step.run('place', 'capture.place', {
    input: { id: from.input('captureId'), nodeId: from.input('nodeId') },
    compensate: { command: 'capture.unplace', input: { id: from.step('place', 'id') } },
  }),
  step.run('extract', 'extraction.request', {
    input: { captureId: from.input('captureId') },
    await: 'effects',
    retry: { attempts: 3, backoffMs: 1_000, on: ['UNAVAILABLE'] },
  }),
  step.wait('proposed', 'extraction.get', {
    input: { captureId: from.input('captureId') },
    watch: ['extraction'],
    until: { in: [from.result('status'), ['proposed', 'accepted']] },
    timeoutMs: 3_600_000,
  }),
  step.run('again', 'extraction.request', {
    input: { captureId: from.step('place', 'id') },
    when: { not: { equals: [from.effect('extract', 0, 'status'), 'accepted'] } },
  }),
];
const workflow = (overrides: Partial<Parameters<typeof defineWorkflow>[0]> = {}) =>
  defineWorkflow({
    id: 'capture-to-proposal',
    version: 1,
    text: 'Place a capture, ask for its extraction and wait for the proposal.',
    input: jsonSchema(z.strictObject({ captureId: z.string(), nodeId: z.string() })),
    maxDurationMs: 86_400_000,
    steps,
    ...overrides,
  });
const catalogOf = (declared = workflow()) =>
  buildCatalog([defineModule({ id: 'survey', capabilities, workflows: [declared] })]);

describe('declared workflows', () => {
  test('the catalog carries the steps, the operations they name and the input schema', () => {
    const [entry] = catalogOf().workflows;
    expect(entry?.operations).toEqual([
      'capture.place',
      'capture.unplace',
      'extraction.request',
      'extraction.get',
    ]);
    expect(entry?.steps?.map((step) => step.id)).toEqual(['place', 'extract', 'proposed', 'again']);
    expect(entry?.inputSchema?.required).toEqual(['captureId', 'nodeId']);
    expect(entry).not.toHaveProperty('input');
    expect(workflowMarkdown(entry!)).toContain(
      '3. `proposed`: wait on `extraction.get` (captureId from input.captureId) until result.status in ["proposed","accepted"], at most 3600 s, checking on changes to extraction.',
    );
    expect(workflowMarkdown(entry!)).toContain('undone by `capture.unplace`');
  });

  test('bindings, waits, spawning, durations and inputs are checked', () => {
    const refused = (message: string, change: Partial<Parameters<typeof defineWorkflow>[0]>) =>
      expect(() => catalogOf(workflow(change))).toThrow(`Workflow capture-to-proposal ${message}`);
    const extractStep = steps[1] as Extract<WorkflowStep, { kind: 'run' }>;
    refused('step place reads extract before it runs', {
      steps: [
        step.run('place', 'capture.place', {
          input: { id: from.step('extract', 'id'), nodeId: 'n' },
        }),
        extractStep,
      ],
    });
    refused('step again reads an effect of place, which does not await its effects', {
      steps: [
        steps[0]!,
        step.run('again', 'extraction.request', {
          input: { captureId: from.effect('place', 0, 'id') },
        }),
      ],
    });
    refused('step proposed waits with neither a watch nor a recheck', {
      steps: [
        step.wait('proposed', 'extraction.get', {
          input: { captureId: 'c' },
          until: { exists: from.result() },
          timeoutMs: 60_000,
        }),
      ],
    });
    refused('step place reads a wait result outside its condition', {
      steps: [
        step.run('place', 'capture.place', { input: { id: from.result('id'), nodeId: 'n' } }),
      ],
    });
    refused('step spawn reaches a workflow operation through capture.spawn', {
      steps: [step.run('spawn', 'capture.spawn', { input: {} })],
    });
    refused('step place leaves capture.place input nodeId unbound', {
      steps: [step.run('place', 'capture.place', { input: { id: from.input('captureId') } })],
    });
    refused('step place names unknown command extraction.get', {
      steps: [step.run('place', 'extraction.get', { input: { captureId: 'c' } })],
    });
    refused('needs a maximum duration between one minute and 90 days', {
      maxDurationMs: 91 * 86_400_000,
    });
    refused('step proposed times out out of range', {
      maxDurationMs: 60_000,
      steps: [{ ...(steps[2] as Extract<WorkflowStep, { kind: 'wait' }>), timeoutMs: 120_000 }],
    });
    refused('step extract retries out of range', {
      steps: [{ ...extractStep, retry: { attempts: 50 } }],
    });
    refused('has an invalid or duplicate step place', { steps: [steps[0]!, steps[0]!] });
    refused('starts from unknown command capture.missing', { start: 'capture.missing' });
  });

  test('prose workflows keep their text and operations', () => {
    const catalog = buildCatalog([
      defineModule({
        id: 'survey',
        capabilities,
        workflows: [{ id: 'review', operations: ['capture.place'], text: 'Place captures.' }],
      }),
    ]);
    expect(catalog.workflows).toEqual([
      { id: 'review', operations: ['capture.place'], text: 'Place captures.' },
    ]);
    expect(workflowMarkdown(catalog.workflows[0]!)).toBe('Place captures.');
  });
});
