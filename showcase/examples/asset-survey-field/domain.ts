import type { StateMigrations } from '@agent-native/runtime';
import { createWorklistSlice, type WorklistSlice } from '@agent-native/assignments/server';

/**
 * The field device's workspace: its one person, the principal that talks to the hub, and the
 * worklist. The hub owns the surveys and their structure; the device keeps the copy its feed last
 * delivered. It keeps every capture it recorded, with whether the hub took it.
 */
export interface FieldState {
  ownerId: string;
  integrationPrincipalId: string;
  worklist: WorklistSlice;
}

export interface FieldServices {
  now?: () => number;
  /** A new capture ID; `crypto.randomUUID()` when omitted. The hub keeps it. */
  newId?: () => string;
}

export const createFieldState = (ownerId: string, integrationPrincipalId: string): FieldState => ({
  ownerId,
  integrationPrincipalId,
  worklist: createWorklistSlice(),
});

type Delivery = { sync: 'pending' | 'accepted' | 'rejected' };

/**
 * Version 1 kept assignments, captures and returns in records of its own. Version 2 starts the
 * worklist empty: the next feed brings back the surveys still open for this device, and the
 * captures the hub took are at the hub. A workspace with a capture or return still waiting for
 * the hub is refused, so nothing is lost; the previous version delivers it first. The pairing is
 * hub-link's and is kept.
 */
export const migrations: StateMigrations = {
  version: 2,
  steps: [
    {
      from: 1,
      to: 2,
      up: (stored) => {
        const v1 = stored as {
          ownerId: string;
          integrationPrincipalId: string;
          captures?: Record<string, Delivery>;
          returns?: Record<string, Delivery>;
        };
        const waiting = [
          ...Object.values(v1.captures ?? {}),
          ...Object.values(v1.returns ?? {}),
        ].filter((record) => record.sync === 'pending').length;
        if (waiting)
          throw new Error(
            `Deliver the ${waiting} record(s) waiting for the hub with the previous version first`,
          );
        return createFieldState(v1.ownerId, v1.integrationPrincipalId);
      },
    },
  ],
};
