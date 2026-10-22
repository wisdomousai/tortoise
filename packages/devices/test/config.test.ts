import { describe, expect, test } from 'bun:test';
import {
  createApplication,
  createMemoryStorage,
  featureHandlers,
  routeAuthorization,
} from '@agent-native/runtime';
import { featureConformance } from '@agent-native/testing/features';
import { defaultWedgeProfile } from '../src/index';
import {
  createDeviceState,
  deviceConfigModule,
  deviceFeature,
  type DeviceAccess,
  type DeviceState,
} from '../src/server';

/** A composing application owns station roles; the device feature only receives the view. */
interface Root {
  roles: Record<string, Record<string, 'operator' | 'supervisor'>>;
  device: DeviceState;
}

const access = (state: Root): DeviceAccess => ({
  relation: (context, station) => {
    const role = state.roles[station]?.[context.principalId];
    return role === 'supervisor' ? 'administer' : role ? 'read' : undefined;
  },
});

function setup() {
  const feature = deviceFeature();
  const root: Root = {
    roles: { L1: { sam: 'supervisor', olga: 'operator' }, L2: { olga: 'supervisor' } },
    device: createDeviceState(),
  };
  return createApplication({
    modules: [deviceConfigModule],
    handlers: featureHandlers<Root, unknown>(
      { key: 'device', feature, access },
      { modules: [deviceConfigModule], applicationModules: [] },
    ),
    storage: createMemoryStorage(root),
    authorization: routeAuthorization<Root>(undefined, [
      {
        id: 'device',
        operations: deviceConfigModule.capabilities.map((capability) => capability.id),
        resourceTypes: feature.authorization!.resourceTypes,
        select: (state) => state.device,
        access,
        port: feature.authorization!.port,
      },
    ]),
    services: {},
  });
}
const as = (principalId: string) => ({ workspaceId: 'w', principalId });

test('station administrators configure scanners; operators read; strangers see nothing', async () => {
  const app = setup();
  const profile = { ...defaultWedgeProfile('line-1'), groupSeparator: '|' };
  const saved = await app.invokeRaw(
    { operation: 'device.scanner.save', input: { station: 'L1', profile } },
    as('sam'),
  );
  expect(saved.result).toMatchObject({ station: 'L1', revision: 1, scanners: [profile] });

  const read = await app.queryRaw(
    { operation: 'device.config.get', input: { station: 'L1' } },
    as('olga'),
  );
  expect((read.data as { scanners: unknown[] }).scanners).toHaveLength(1);

  await expect(
    app.invokeRaw(
      { operation: 'device.scanner.save', input: { station: 'L1', profile } },
      as('olga'),
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'device.config.get', input: { station: 'L1' } }, as('eve')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  // A supervisor of another station is not an administrator here.
  await expect(
    app.invokeRaw(
      { operation: 'device.routes.save', input: { station: 'L2', routes: [] } },
      as('sam'),
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('routes are compiled before they are stored and stale writers conflict', async () => {
  const app = setup();
  await expect(
    app.invokeRaw(
      {
        operation: 'device.routes.save',
        input: { station: 'L1', routes: [{ intent: 'order', pattern: '(' }] },
      },
      as('sam'),
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT', details: { field: 'routes' } });
  await app.invokeRaw(
    {
      operation: 'device.routes.save',
      input: { station: 'L1', routes: [{ intent: 'order', pattern: '^WO(\\d+)$' }] },
    },
    as('sam'),
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'device.routes.save',
        input: { station: 'L1', routes: [] },
        expectedRevisions: { 'device:L1': 0 },
      },
      as('sam'),
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

describe('device feature conformance', () => {
  const profile = defaultWedgeProfile('line-1');
  const cases = featureConformance(deviceFeature(), {
    allowAll: { relation: () => 'administer' },
    denyAll: { relation: () => undefined },
    sampleSlice: { stations: { L1: { scanners: {}, routes: [] } } },
    requests: [
      { operation: 'device.config.get', input: { station: 'L1' } },
      { operation: 'device.scanner.save', input: { station: 'L1', profile } },
    ],
    events: [{ cursor: 1, resource: 'device:L1', revision: 1, type: 'changed', operation: 'x' }],
  });
  for (const check of cases) test(check.name, check.run);
});
