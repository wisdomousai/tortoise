import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  approvalFeatureManifest,
  approvalOperations,
  buildCatalog,
  checkNamespace,
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
  operationNamespace,
  reconciliationFeatureManifest,
} from '../src/index';

const capability = (id: string, extra: Record<string, unknown> = {}) =>
  defineCapability({
    id,
    kind: 'command',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.null()),
    permission: { action: 'run', resourceType: 'fixture' },
    ui: { exception: 'fixture' },
    ...extra,
  });

describe('feature manifests', () => {
  test('the built-in features keep their operation ids under their own namespace', () => {
    expect(approvalFeatureManifest.modules[0]!.capabilities.map((c) => c.id)).toEqual(
      Object.values(approvalOperations).map((c) => c.id),
    );
    expect(reconciliationFeatureManifest.modules[0]!.capabilities.map((c) => c.id)).toEqual([
      'reconciliation.list',
      'reconciliation.resolve',
    ]);
    expect(() =>
      buildCatalog([...approvalFeatureManifest.modules, ...reconciliationFeatureManifest.modules]),
    ).not.toThrow();
  });

  test('operations, modules and targets must sit in the feature id', () => {
    expect(() =>
      defineFeatureManifest({
        id: 'stock',
        title: 'Stock',
        modules: [defineModule({ id: 'stock', capabilities: [capability('task.create')] })],
      }),
    ).toThrow('outside its namespace');
    expect(() =>
      defineFeatureManifest({
        id: 'stock',
        title: 'Stock',
        modules: [defineModule({ id: 'stock', capabilities: [capability('stock')] })],
      }),
    ).toThrow('outside its namespace');
    expect(() =>
      defineFeatureManifest({
        id: 'stock',
        title: 'Stock',
        modules: [defineModule({ id: 'inventory', capabilities: [capability('stock.count')] })],
      }),
    ).toThrow('module "inventory"');
    expect(() =>
      defineFeatureManifest({
        id: 'stock',
        title: 'Stock',
        modules: [
          defineModule({
            id: 'stock-erp',
            capabilities: [
              capability('stock.post', { integration: { target: 'erp', delivery: 'outbox' } }),
            ],
          }),
        ],
      }),
    ).toThrow('target "erp"');
    const ok = defineFeatureManifest({
      id: 'stock',
      title: 'Stock',
      modules: [
        defineModule({
          id: 'stock-erp',
          capabilities: [
            capability('stock.post', { integration: { target: 'stock-erp', delivery: 'outbox' } }),
          ],
        }),
      ],
    });
    expect(Object.isFrozen(ok)).toBe(true);
    expect(() => defineFeatureManifest({ id: 'Stock', title: 'x' })).toThrow('Invalid feature id');
    expect(() => defineFeatureManifest({ id: 'stock', title: 'x', requires: ['stock'] })).toThrow(
      'requires',
    );
  });

  test('namespace helpers', () => {
    expect(operationNamespace('approval.request')).toBe('approval');
    expect(operationNamespace('device.scanner.save')).toBe('device');
    expect(() =>
      checkNamespace('Plugin x', 'link', [
        defineModule({ id: 'x', capabilities: [capability('link.pair')] }),
      ]),
    ).not.toThrow();
    expect(() => checkNamespace('Plugin x', 'a.b', [])).toThrow('invalid operation namespace');
  });
});
