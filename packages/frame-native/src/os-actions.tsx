import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { JsonObject, OsActionOutcome, OsActionRequest } from '@agent-native/contracts';

/** How the frame asks the device for an OS action: the mobile host's OS connection, or a fake. */
export type PerformOsAction = (request: OsActionRequest) => Promise<OsActionOutcome>;

const OsActionsContext = createContext<PerformOsAction | undefined>(undefined);

export function OsActionsProvider({
  perform,
  children,
}: {
  perform?: PerformOsAction;
  children: ReactNode;
}) {
  return <OsActionsContext.Provider value={perform}>{children}</OsActionsContext.Provider>;
}

/**
 * Ask for one of the application's declared OS actions, such as a share or an Android intent,
 * from a press handler. The shell port builds the instruction from the declaration and the
 * params, and the device performs it. Without the mobile host's OS connection, every action is
 * refused as `unattached`.
 */
export function useOsAction() {
  const perform = useContext(OsActionsContext);
  return useCallback(
    (action: string, params?: JsonObject): Promise<OsActionOutcome> =>
      perform
        ? perform({ action, ...(params ? { params } : {}) })
        : Promise.resolve({ status: 'refused', reason: 'unattached', action }),
    [perform],
  );
}
