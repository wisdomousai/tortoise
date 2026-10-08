import type { AnyCapability, JsonValue, RemoteReadDeclaration } from '@agent-native/contracts';
import {
  createRemoteQueryFactory,
  type HandlerContext,
  type RemoteHandler,
  type RemoteItemOf,
} from '@agent-native/runtime';

type RemoteQuery = AnyCapability & {
  readonly kind: 'query';
  readonly remote: RemoteReadDeclaration;
};

export interface DataProviderImplementation<State, Services, Provider extends ProviderShape> {
  /**
   * Turn one record the source returned into an output item, for example marking whether a
   * local copy exists, or drop it with `undefined`. Pure; runs in a read snapshot. Validate
   * the record's shape here: an item that does not match the provider's schema fails the query.
   */
  item(
    found: unknown,
    context: HandlerContext<State, Services>,
  ): RemoteItemOf<Provider['search']> | undefined;
}
interface ProviderShape {
  readonly search: RemoteQuery;
  readonly lookup: RemoteQuery;
}

/**
 * Server handlers for a provider declared with `defineDataProvider`. The source receives the
 * validated input as its query (`request.operation` tells search from lookup), so the port owns
 * how a query maps to the target's API. Compose the returned handlers like any others and bind
 * the target's source with `createRemoteSource`.
 */
export function implementDataProvider<State, Services, Provider extends ProviderShape>(
  provider: Provider,
  implementation: DataProviderImplementation<State, Services, Provider>,
) {
  const remote = createRemoteQueryFactory<State, Services>();
  // Both queries return the provider's item schema, so one mapper serves both. The casts only
  // restate that for TypeScript, which cannot evaluate `RemoteItemOf` over a generic provider.
  const handler = <C extends RemoteQuery>() =>
    ({
      request: (input: unknown) => input as JsonValue,
      item: implementation.item,
    }) as unknown as RemoteHandler<State, Services, C>;
  return [
    remote(provider.search, handler<Provider['search']>()),
    remote(provider.lookup, handler<Provider['lookup']>()),
  ] as const;
}
