import { isDeepStrictEqual } from 'node:util';
import type { AnyCapability, CapabilityModule } from '@agent-native/contracts';
import type { ChangeEvent, ExecutionContext, FeatureServer } from '@agent-native/runtime';
import type { ConformanceCase } from './connectors';

/** A command or query the suite asks the feature's policy about, over `sampleSlice`. */
export interface FeatureRequest {
  readonly operation: string;
  readonly input: unknown;
}

export interface FeatureConformanceOptions<Slice, Access> {
  /** An access view that allows every check the feature asks the application to make. */
  readonly allowAll: Access;
  /** An access view that denies every check. */
  readonly denyAll: Access;
  /** A slice holding records, so rules over records have something to decide. Default: `create`. */
  readonly sampleSlice?: Slice;
  /** The modules a handler function receives as the application's own. Default: none. */
  readonly applicationModules?: readonly CapabilityModule[];
  /**
   * Requests over `sampleSlice` that the allow-all view admits for a person and the deny-all view
   * refuses, which proves the policy reads the access view. Commands without an entry are still
   * asked with `{}` under deny-all.
   */
  readonly requests?: readonly FeatureRequest[];
  /** Events on records in `sampleSlice` that the allow-all view shows a person and deny-all hides. */
  readonly events?: readonly ChangeEvent[];
  /** Operations the feature's own policy refuses to a delegated caller under any access view. */
  readonly personOnly?: readonly string[];
}

const person: ExecutionContext = { workspaceId: 'conformance', principalId: 'person' };
const delegated: ExecutionContext = {
  ...person,
  runId: 'run',
  grant: { operations: ['*'], principalId: 'person', workspaceId: 'conformance' },
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const passed = { passed: true } as const;

/**
 * What composition relies on from any feature, as cases a test runs against it: one handler per
 * operation, a slice that survives storage, and a policy that follows the access view the
 * application supplies. A case without the data it needs reports `skipped`. Failures throw with
 * what was observed. Run them with any test runner: `for (const c of cases) test(c.name, c.run)`.
 */
export function featureConformance<Slice, Access>(
  feature: FeatureServer<Slice, Access>,
  options: FeatureConformanceOptions<Slice, Access>,
): ConformanceCase[] {
  const { id, modules } = feature.manifest;
  const operations = new Map<string, AnyCapability>(
    modules.flatMap((module) => module.capabilities.map((c) => [c.id, c] as const)),
  );
  const slice = () =>
    structuredClone(options.sampleSlice ?? (feature.state?.create('owner') as Slice));
  const port = feature.authorization?.port;
  const capability = (operation: string) => {
    const found = operations.get(operation);
    check(found, `"${operation}" is not an operation of feature "${id}"`);
    return found;
  };
  const authorize = async (request: FeatureRequest, context: ExecutionContext, access: Access) => {
    const state = slice();
    return port!.authorize({
      capability: capability(request.operation),
      input: request.input,
      context,
      state,
      phase: 'invoke',
      access,
    });
  };
  const readable = async (event: ChangeEvent, access: Access) => {
    const state = slice();
    const read = { event, context: person, state, access };
    const resource = port!.canReadResource
      ? await port!.canReadResource({ ...read, resource: event.resource })
      : await port!.canReadEvent(read);
    return { event: await port!.canReadEvent(read), resource };
  };

  return [
    {
      name: 'every operation has one handler and every handler an operation',
      async run() {
        const declared = feature.handlers;
        const applicationModules = options.applicationModules ?? [];
        const handlers =
          typeof declared === 'function'
            ? declared({ modules: [...applicationModules, ...modules], applicationModules })
            : (declared ?? []);
        const seen = new Set<string>();
        for (const handler of handlers) {
          const operation = handler.capability.id;
          check(operations.has(operation), `Handler for ${operation} has no operation in "${id}"`);
          check(!seen.has(operation), `${operation} has two handlers`);
          seen.add(operation);
          check(
            Boolean(handler.remote) === Boolean(handler.capability.remote),
            `${operation} has a remote handler exactly when it declares remote`,
          );
        }
        for (const operation of operations.keys())
          check(seen.has(operation), `${operation} has no handler`);
        return passed;
      },
    },
    {
      name: 'a new slice survives storage and normalization unchanged',
      async run() {
        if (!feature.state) return { skipped: `Feature "${id}" keeps no state` };
        const created = feature.state.create('owner');
        const stored = JSON.parse(JSON.stringify(created)) as unknown;
        check(
          isDeepStrictEqual(stored, created),
          'The new slice holds a value JSON does not keep, such as a Date, Map or undefined',
        );
        if (feature.state.upgrade)
          check(
            isDeepStrictEqual(feature.state.upgrade(stored, 'owner'), created),
            'upgrade changes a slice that create just made',
          );
        return passed;
      },
    },
    {
      name: 'a deny-all access view refuses every command and hides every sample event',
      async run() {
        if (!port) return { skipped: `Feature "${id}" has no policy` };
        const inputs = new Map((options.requests ?? []).map((r) => [r.operation, r.input]));
        for (const [operation, found] of operations) {
          if (found.kind !== 'command') continue;
          const request = { operation, input: inputs.get(operation) ?? {} };
          for (const context of [person, delegated]) {
            const decision = await authorize(request, context, options.denyAll);
            check(
              !decision.allowed,
              `${operation} is allowed under deny-all for a ${context === person ? 'person' : 'delegated caller'}`,
            );
          }
        }
        for (const request of options.requests ?? [])
          check(
            !(await authorize(request, person, options.denyAll)).allowed,
            `${request.operation} is allowed under deny-all`,
          );
        for (const event of options.events ?? []) {
          const read = await readable(event, options.denyAll);
          check(!read.event, `${event.resource} is readable under deny-all`);
          check(!read.resource, `${event.resource} is readable as a resource under deny-all`);
        }
        return passed;
      },
    },
    {
      name: 'an allow-all access view admits the sample requests and shows the sample events to a person',
      async run() {
        if (!port) return { skipped: `Feature "${id}" has no policy` };
        if (!options.requests?.length && !options.events?.length)
          return { skipped: 'No sample requests or events' };
        for (const request of options.requests ?? []) {
          const decision = await authorize(request, person, options.allowAll);
          check(
            decision.allowed,
            `${request.operation} is refused under allow-all (${decision.reason ?? 'no reason'})`,
          );
        }
        for (const event of options.events ?? []) {
          const read = await readable(event, options.allowAll);
          check(read.event, `${event.resource} is hidden under allow-all`);
          check(read.resource, `${event.resource} is hidden as a resource under allow-all`);
        }
        return passed;
      },
    },
    {
      name: 'person-only operations refuse a delegated caller under allow-all',
      async run() {
        if (!port) return { skipped: `Feature "${id}" has no policy` };
        if (!options.personOnly?.length) return { skipped: 'No person-only operations' };
        const inputs = new Map((options.requests ?? []).map((r) => [r.operation, r.input]));
        for (const operation of options.personOnly) {
          const request = { operation, input: inputs.get(operation) ?? {} };
          const decision = await authorize(request, delegated, options.allowAll);
          check(!decision.allowed, `${operation} is allowed for a delegated caller`);
        }
        return passed;
      },
    },
  ];
}
