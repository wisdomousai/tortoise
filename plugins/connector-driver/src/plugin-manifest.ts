import { defineModule } from '@tortoise/contracts';
import { definePluginManifest } from '@tortoise/host/plugin-manifest';
import type { DriverAction, DriverContract } from './contracts/define';
import { driverComponent } from './contracts/document';
import { driverModule, driverOperations } from './contracts/status';

const riskText: Record<DriverAction['risk'], string> = {
  none: 'risk none; runs in assist or actuate mode',
  low: 'risk low; runs only in actuate mode',
  'operator-present':
    'runs only in actuate mode with presence.confirmedBy naming the person at the machine; never fill it in yourself',
};

/** Agent guidance for one driver: what each action does to the equipment, and when it may run. */
function driverWorkflow(contract: DriverContract) {
  const actions = Object.entries(contract.actions).map(
    ([id, action]) => `${id} (${action.title}): ${action.delivery}, ${riskText[action.risk]}.`,
  );
  return {
    id: `driver-${contract.id.replace(/[._]/g, '-')}`,
    operations: [driverOperations.statusGet.id],
    text: [
      `Commands whose effects target ${contract.id} act on the ${contract.title} through its driver. Check driver.status.get first; while the driver is not ready, or the equipment is under local control, those effects wait.`,
      ...actions,
    ].join(' '),
  };
}

/**
 * The browser-safe part of the driver plugin for one application's drivers:
 * - the status query, with one workflow per driver naming each action's delivery mode and risk
 *   level, so the generated agent skill says what acting on the equipment means;
 * - per driver a component naming its process, devices and network, so the site policy, the
 *   generated security manifest and the frame see every driver the application can start.
 *
 * The application lists the result in its manifest and passes the same contracts to
 * `createDriverPlugin`.
 */
export function driverPluginManifest(contracts: readonly DriverContract[]) {
  const ids = new Set<string>();
  for (const contract of contracts) {
    if (ids.has(contract.id)) throw new Error(`Driver ${contract.id} is declared twice`);
    ids.add(contract.id);
  }
  return definePluginManifest({
    id: 'driver',
    title: 'Drivers',
    modules: [
      defineModule({
        ...driverModule,
        workflows: contracts.map(driverWorkflow),
      }),
    ],
    components: contracts.map(driverComponent),
  });
}
