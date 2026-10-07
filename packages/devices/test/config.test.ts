import { expect, test } from 'bun:test';
import {
  composeAuthorization,
  createApplication,
  createMemoryStorage,
  sliceHandlers,
} from '@agent-native/runtime';
import { defaultWedgeProfile } from '../src/index';
import {
  createDeviceHandlers,
  createDeviceState,
  deviceAuthorizationRoute,
  deviceConfigModule,
  type DeviceState,
} from '../src/server';

/** A composing application owns station roles; the device module only receives the view. */
interface Root {
  roles: Record<string, Record<string, 'operator' | 'supervisor'>>;
  devices: DeviceState;
}

function setup() {
  const root: Root = {
    roles: { L1: { sam: 'supervisor', olga: 'operator' }, L2: { olga: 'supervisor' } },
    devices: createDeviceState(),
  };
  return createApplication({
    modules: [deviceConfigModule],
    handlers: sliceHandlers<Root, 'devices', unknown>('devices', createDeviceHandlers()),
    storage: createMemoryStorage(root),
    authorization: composeAuthorization<Root>([
      deviceAuthorizationRoute<Root>((state) => ({
        config: state.devices,
        access: (principal, station) => {
          const role = state.roles[station]?.[principal];
          return role === 'supervisor' ? 'administer' : role ? 'read' : undefined;
        },
      })),
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
