import type { AnyCapability, InputOf, OutputOf } from '@tortoise/contracts';
import type { CommandOptions, Transport } from './types.js';

/** Typed capability bindings preserve the input/output types declared by an independently authored module. */
export function createClient(transport: Transport) {
  return {
    transport,
    query<C extends AnyCapability>(
      capability: C & { kind: 'query' },
      input: InputOf<C>,
      signal?: AbortSignal,
    ) {
      return transport.query<OutputOf<C>>(capability.id, input, signal);
    },
    command<C extends AnyCapability>(
      capability: C & { kind: 'command' },
      input: InputOf<C>,
      options?: CommandOptions,
    ) {
      return transport.command<OutputOf<C>>(capability.id, input, options);
    },
  };
}
