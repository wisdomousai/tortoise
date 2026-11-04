import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  blobRefSchema,
  defineCapability,
  definePeerApi,
  definePeerTarget,
  jsonSchema,
} from '../src/index';

const command = (id: string, input: z.ZodType = z.strictObject({ lot: z.string() })) =>
  defineCapability({
    id,
    kind: 'command',
    input: jsonSchema(input),
    output: jsonSchema(z.strictObject({ id: z.string() })),
    permission: { action: 'create', resourceType: 'inspection-request' },
    ui: { exception: 'test fixture' },
  });
const query = (id: string) =>
  defineCapability({
    id,
    kind: 'query',
    input: jsonSchema(z.strictObject({ cursor: z.string().optional() })),
    output: jsonSchema(z.strictObject({ items: z.array(z.string()), cursor: z.string() })),
    permission: { action: 'read', resourceType: 'inspection-request' },
    ui: { exception: 'test fixture' },
  });
const requestInspection = command('inspection.request.create');
const comment = command(
  'inspection.lot.comment',
  z.strictObject({ lot: z.string(), text: z.string() }),
);
const inbound = query('inspection.request.outcomes');
const lots = query('inspection.lot.list');

const api = definePeerApi({
  application: 'quality-inspection',
  commands: [requestInspection],
  queries: [inbound],
  onBehalfOf: { commands: [comment], queries: [lots] },
});

describe('peer API', () => {
  test('lists what the service principal and a person may call', () => {
    expect(api.serviceOperations).toEqual([requestInspection.id, inbound.id]);
    expect(api.onBehalfOfOperations).toEqual([comment.id, lots.id]);
  });

  test('refuses a wrong kind, a command on both lists and blobs on behalf of a person', () => {
    expect(() => definePeerApi({ application: 'q', commands: [inbound as never] })).toThrow(
      'Peer API of q lists inspection.request.outcomes as a command',
    );
    expect(() =>
      definePeerApi({
        application: 'q',
        commands: [requestInspection],
        onBehalfOf: { commands: [requestInspection] },
      }),
    ).toThrow('for the service principal and on behalf of a person');
    const photo = defineCapability({
      ...command('inspection.lot.photo', z.strictObject({ photo: blobRefSchema })),
      blobs: { maxBytes: 1024, mediaTypes: ['image/png'] },
    });
    expect(() => definePeerApi({ application: 'q', onBehalfOf: { commands: [photo] } })).toThrow(
      'cannot take blobs on behalf of a person',
    );
  });
});

describe('peer target', () => {
  const target = definePeerTarget({
    target: 'quality',
    resourceType: 'QualitySync',
    api,
    changes: ['line'],
    inbound: { query: inbound, item: z.string(), max: 50, changes: ['line'] },
    status: {},
    descriptions: { complete: 'Complete.', sync: 'Sync.', status: 'Status.' },
    destination: {
      id: 'quality-peer',
      purpose: 'The quality inspection application',
      dataClasses: ['lot'],
      availability: 'optional',
      offline: 'queue',
    },
    reads: true,
  });

  test('declares an authenticated https destination for its target and reads', () => {
    expect(target.destination).toMatchObject({
      id: 'quality-peer',
      direction: 'outbound',
      scope: 'local',
      protocol: 'https',
      authenticated: true,
      targets: ['quality'],
      reads: ['quality'],
    });
    expect(target.component).toMatchObject({
      id: 'quality-peer',
      requirements: { network: [target.destination] },
    });
    expect(target.inboundQuery).toBe(inbound.id);
    expect(target.sync?.id).toBe('quality.sync');
  });

  test('an effect is parsed by the peer command and knows whose it is', () => {
    expect(
      target.effect(requestInspection, { resource: 'line:1', payload: { lot: 'L1' } }),
    ).toEqual({
      target: 'quality',
      type: requestInspection.id,
      resource: 'line:1',
      payload: { lot: 'L1' },
    });
    expect(() =>
      target.effect(requestInspection, { resource: 'line:1', payload: { lot: 7 } as never }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() =>
      target.effect(command('inspection.other') as never, {
        resource: 'r',
        payload: { lot: 'x' } as never,
      }),
    ).toThrow('inspection.other is not on the peer API of quality-inspection');
    expect(target.onBehalfOf(comment.id)).toBe(true);
    expect(target.onBehalfOf(requestInspection.id)).toBe(false);
  });

  test('pulls inbound items only from a service query of the API', () => {
    expect(() =>
      definePeerTarget({
        target: 'quality',
        resourceType: 'QualitySync',
        api,
        changes: ['line'],
        inbound: { query: lots as never, item: z.string(), max: 50, changes: ['line'] },
        status: {},
        descriptions: { complete: 'Complete.', status: 'Status.' },
        destination: {
          id: 'q',
          purpose: 'q',
          dataClasses: [],
          availability: 'optional',
          offline: 'queue',
        },
      }),
    ).toThrow('pulls inbound items from inspection.lot.list, not a service query');
  });
});
