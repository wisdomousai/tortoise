import {
  operationSchemaDigest,
  peerApiOperations,
  type Catalog,
  type ContractApplication,
  type PeerApi,
} from '@tortoise/contracts';

/** Why an operation of the API no longer matches what the peer serves. */
export type DriftReason = 'changed' | 'missing' | 'application';

export interface PeerDriftStatus {
  readonly checkedAt?: number;
  readonly application?: ContractApplication;
  readonly drifted: readonly { readonly operation: string; readonly reason: DriftReason }[];
  /** Why the last check could not read the peer's contract; the previous result stands. */
  readonly error?: string;
}

export interface PeerDriftOptions {
  readonly api: PeerApi;
  /** The peer's served contract, read as this application's service principal. */
  readonly contract: () => Promise<Catalog>;
  readonly now?: () => number;
  /** How long a check stands before the next call checks again; ten minutes by default. */
  readonly intervalMs?: number;
  /** `block` (the default) stops calls to drifted operations; `warn` only reports them. */
  readonly onDrift?: 'block' | 'warn';
}

/**
 * Compares the API this application was built against with the contract the peer serves,
 * by each operation's schema digest. It checks on first contact, again once `intervalMs` has
 * passed, and at the next call after `invalidate`, which a peer's `INVALID_INPUT` triggers.
 * A drifted operation is blocked, so the outbox keeps its effects pending and reads report the
 * peer unavailable, instead of sending input the peer would read differently.
 */
export function createPeerDrift(options: PeerDriftOptions) {
  const now = options.now ?? Date.now;
  const interval = options.intervalMs ?? 600_000;
  const expected = new Map(
    peerApiOperations(options.api).map((capability) => [
      capability.id,
      operationSchemaDigest({
        id: capability.id,
        kind: capability.kind,
        inputSchema: capability.input.jsonSchema,
        outputSchema: capability.output.jsonSchema,
      }),
    ]),
  );
  let status: PeerDriftStatus = { drifted: [] };
  let due = true;
  let running: Promise<void> | undefined;
  const compare = (contract: Catalog): PeerDriftStatus => {
    const served = new Map(
      contract.operations.map((operation) => [
        operation.id,
        operation.schemaDigest ?? operationSchemaDigest(operation),
      ]),
    );
    const wrong = contract.application && contract.application.id !== options.api.application;
    return {
      checkedAt: now(),
      ...(contract.application ? { application: contract.application } : {}),
      drifted: [...expected].flatMap(([operation, digest]) => {
        const reason: DriftReason | undefined = wrong
          ? 'application'
          : !served.has(operation)
            ? 'missing'
            : served.get(operation) !== digest
              ? 'changed'
              : undefined;
        return reason ? [{ operation, reason }] : [];
      }),
    };
  };
  return {
    /** Check now when a check is due; concurrent callers share one read of the contract. */
    async check(): Promise<void> {
      if (!due && status.checkedAt !== undefined && now() - status.checkedAt < interval) return;
      running ??= options
        .contract()
        .then(
          (contract) => {
            status = compare(contract);
            due = false;
          },
          (error: Error) => {
            status = { ...status, error: error.message };
          },
        )
        .finally(() => (running = undefined));
      await running;
    },
    invalidate() {
      due = true;
    },
    blocked(operation: string): boolean {
      return (
        options.onDrift !== 'warn' && status.drifted.some((entry) => entry.operation === operation)
      );
    },
    status: (): PeerDriftStatus => status,
  };
}
export type PeerDrift = ReturnType<typeof createPeerDrift>;
