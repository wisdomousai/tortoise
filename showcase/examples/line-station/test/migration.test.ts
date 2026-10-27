import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import type { ApprovalRequest } from '@agent-native/contracts';
import { defaultWedgeProfile } from '@agent-native/devices';
import { LOCAL_WORKSPACE, createApplicationRuntime, workspaceStorage } from '@agent-native/host';
import type { ExecutionContext } from '@agent-native/runtime';
import { createLineStationApplication, MES_PRINCIPAL } from '../application';
import { bridgePrincipal } from '../domain';
import { createLineState } from '../server';

const WORKSPACE_DATABASE = 'workspace.sqlite';
const as = (principalId: string): ExecutionContext => ({
  workspaceId: LOCAL_WORKSPACE,
  principalId,
});
const sam = as('sam');
const olga = as('olga');
const vic = as('vic');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** A version 1 approval request to classify a stop, kept in the line slice. */
const pending: ApprovalRequest = {
  id: 'a1',
  operation: 'line.stop.classify',
  input: { stopId: 's1', reason: 'JAM' },
  rationale: 'Alarm E42 is the infeed jam sensor.',
  resource: 'stop:s1',
  baseRevisions: {},
  status: 'pending',
  requestedBy: 'sam',
  createdAt: 0,
  expiresAt: 4_000_000_000_000,
};
const wedge = defaultWedgeProfile();

/** Version 1 state: approval requests in the line slice, device configuration at the root. */
function storedV1() {
  const lineStation = createLineState({
    stations: [
      {
        id: 'line-1',
        name: 'Filler 1',
        line: 'Line 1',
        members: { sam: 'supervisor', olga: 'operator', vic: 'viewer' },
      },
    ],
  });
  lineStation.reasons.JAM = { code: 'JAM', text: 'Jam at infeed', category: 'unplanned' };
  lineStation.stops.s1 = {
    id: 's1',
    station: 'line-1',
    state: 'ALARM',
    alarm: 'E42 infeed jam',
    startedAt: 0,
  };
  return {
    lineStation: { ...lineStation, approvals: { a1: pending } },
    devices: { stations: { 'line-1': { scanners: { [wedge.id]: wedge }, routes: [] } } },
  };
}

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'line-station-migration-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const raw = new SQLiteStorage(join(directory, WORKSPACE_DATABASE), storedV1);
  await raw.transact(LOCAL_WORKSPACE, async () => {});
  await raw.close();
  const storage = workspaceStorage(createLineStationApplication(), directory);
  cleanup.push(() => storage.close());
  const application = createApplicationRuntime(createLineStationApplication(), { storage });
  const snapshot = async () => {
    const stored = new SQLiteStorage<Record<string, any>>(
      join(directory, WORKSPACE_DATABASE),
      () => ({}),
    );
    try {
      return await stored.read(LOCAL_WORKSPACE, async (value) => structuredClone(value));
    } finally {
      await stored.close();
    }
  };
  return { application, snapshot };
}

/** A new approval request for the pending one's command. */
const request = {
  operation: 'approval.request',
  input: {
    operation: pending.operation,
    input: pending.input,
    rationale: pending.rationale,
    resource: pending.resource,
    baseRevisions: {},
  },
};
const saveScanner = (label: string) => ({
  operation: 'device.scanner.save',
  input: { station: 'line-1', profile: { ...wedge, label } },
});

describe('line-station state version 2', () => {
  test('approval requests and device configuration move into their features', async () => {
    const { application, snapshot } = await workspace();
    const listed = await application.queryRaw({ operation: 'approval.list', input: {} }, vic);
    expect((listed.data as { items: ApprovalRequest[] }).items.map((item) => item.id)).toEqual([
      'a1',
    ]);
    const config = await application.queryRaw(
      { operation: 'device.config.get', input: { station: 'line-1' } },
      olga,
    );
    expect((config.data as { scanners: { id: string }[] }).scanners.map((item) => item.id)).toEqual(
      [wedge.id],
    );
    await application.invokeRaw({ operation: 'approval.approve', input: { id: 'a1' } }, olga);
    const stored = await snapshot();
    expect(stored.state.lineStation).not.toHaveProperty('approvals');
    expect(stored.state).not.toHaveProperty('devices');
    expect(stored.state.lineStation.stops.s1).toMatchObject({
      reason: 'JAM',
      classifiedBy: 'olga',
    });
    expect(stored.state.approval.requests.a1).toMatchObject({
      status: 'approved',
      closedBy: 'olga',
    });
    expect(stored.state.device.stations['line-1'].scanners[wedge.id]).toEqual(wedge);
    expect(stored.stateVersions).toMatchObject({
      application: { version: 2, readableFrom: 2 },
      'feature:approval': { version: 1, readableFrom: 1 },
      'feature:device': { version: 1, readableFrom: 1 },
    });
  });

  test('station bridges, the MES integration and non-members reach neither feature', async () => {
    const { application } = await workspace();
    for (const caller of [as(bridgePrincipal('line-1')), as(MES_PRINCIPAL), as('stranger')]) {
      await expect(
        application.queryRaw({ operation: 'approval.list', input: {} }, caller),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(application.invokeRaw(request, caller)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        application.invokeRaw({ operation: 'approval.approve', input: { id: 'a1' } }, caller),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        application.queryRaw(
          { operation: 'device.config.get', input: { station: 'line-1' } },
          caller,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  test('viewers neither request nor reject, and only supervisors configure devices', async () => {
    const { application } = await workspace();
    await expect(application.invokeRaw(request, vic)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      application.invokeRaw({ operation: 'approval.reject', input: { id: 'a1' } }, vic),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const caller of [vic, olga])
      await expect(application.invokeRaw(saveScanner('Renamed'), caller)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    await application.invokeRaw(saveScanner('Renamed'), sam);
  });
});
