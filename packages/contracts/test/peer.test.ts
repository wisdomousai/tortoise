import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  blobRefSchema,
  defineCapability,
  definePeerSurface,
  definePeerTarget,
  jsonSchema,
} from '../src/index';

const command = (id: string, input: z.ZodType = z.strictObject({ lot: z.string() })) =>
  defineCapability({
    id,
    kind: 'command',
    input: jsonSchema(input),
    output: jsonSchema(z.strictObject({ id: z.string() })),
    permission: { action: 'create', resourceType: 'arrival' },
    ui: { exception: 'test fixture' },
  });
const query = (id: string) =>
  defineCapability({
    id,
    kind: 'query',
    input: jsonSchema(z.strictObject({ cursor: z.string().optional() })),
    output: jsonSchema(z.strictObject({ items: z.array(z.string()), cursor: z.string() })),
    permission: { action: 'read', resourceType: 'arrival' },
    ui: { exception: 'test fixture' },
  });
const announce = command('inspection.arrival.announce');
const comment = command(
  'inspection.lot.comment',
  z.strictObject({ lot: z.string(), text: z.string() }),
);
const feed = query('inspection.arrival.feed');
const lots = query('inspection.lot.list');

const surface = definePeerSurface({
  application: 'quality-inspection',
  commands: [announce],
  queries: [feed],
  onBehalfOf: { commands: [comment], queries: [lots] },
});

describe('peer surface', () => {
  test('lists what the service principal and a person may call', () => {
    expect(surface.serviceOperations).toEqual([announce.id, feed.id]);
    expect(surface.onBehalfOfOperations).toEqual([comment.id, lots.id]);
  });

  test('refuses a wrong kind, a command on both lists and blobs on behalf of a person', () => {
    expect(() => definePeerSurface({ application: 'q', commands: [feed as never] })).toThrow(
      'Peer surface of q lists inspection.arrival.feed as a command',
    );
    expect(() =>
      definePeerSurface({
        application: 'q',
        commands: [announce],
        onBehalfOf: { commands: [announce] },
      }),
    ).toThrow('for the service principal and on behalf of a person');
    const photo = defineCapability({
      ...command('inspection.lot.photo', z.strictObject({ photo: blobRefSchema })),
      blobs: { maxBytes: 1024, mediaTypes: ['image/png'] },
    });
    expect(() =>
      definePeerSurface({ application: 'q', onBehalfOf: { commands: [photo] } }),
    ).toThrow('cannot take blobs on behalf of a person');
  });
});

describe('peer target', () => {
  const target = definePeerTarget({
    target: 'quality',
    resourceType: 'QualitySync',
    surface,
    settles: ['line'],
    feed: { query: feed, item: z.string(), max: 50, changes: ['line'] },
    status: {},
    descriptions: { settle: 'Settle.', sync: 'Sync.', status: 'Status.' },
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
      direction: 'egress',
      scope: 'site',
      protocol: 'https',
      authenticated: true,
      targets: ['quality'],
      reads: ['quality'],
    });
    expect(target.component).toMatchObject({
      id: 'quality-peer',
      requirements: { network: [target.destination] },
    });
    expect(target.feedQuery).toBe(feed.id);
    expect(target.sync?.id).toBe('quality.sync');
  });

  test('an effect is parsed by the peer command and knows whose it is', () => {
    expect(target.effect(announce, { resource: 'line:1', payload: { lot: 'L1' } })).toEqual({
      target: 'quality',
      type: announce.id,
      resource: 'line:1',
      payload: { lot: 'L1' },
    });
    expect(() =>
      target.effect(announce, { resource: 'line:1', payload: { lot: 7 } as never }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() =>
      target.effect(command('inspection.other') as never, {
        resource: 'r',
        payload: { lot: 'x' } as never,
      }),
    ).toThrow('inspection.other is not on the peer surface of quality-inspection');
    expect(target.onBehalfOf(comment.id)).toBe(true);
    expect(target.onBehalfOf(announce.id)).toBe(false);
  });

  test('feeds only from a service query of the surface', () => {
    expect(() =>
      definePeerTarget({
        target: 'quality',
        resourceType: 'QualitySync',
        surface,
        settles: ['line'],
        feed: { query: lots as never, item: z.string(), max: 50, changes: ['line'] },
        status: {},
        descriptions: { settle: 'Settle.', status: 'Status.' },
        destination: {
          id: 'q',
          purpose: 'q',
          dataClasses: [],
          availability: 'optional',
          offline: 'queue',
        },
      }),
    ).toThrow('feeds from inspection.lot.list, not a service query');
  });
});
