import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Catalog, CatalogOperation } from './catalog';
import { canonicalJson } from './json';

const digestOf = (value: unknown) =>
  `sha256:${bytesToHex(sha256(utf8ToBytes(canonicalJson(value))))}`;

/**
 * `sha256:` over an operation's ID, kind and input and output schemas. A caller that recorded it
 * learns from a changed digest that the operation no longer takes or returns what it was built for.
 */
export const operationSchemaDigest = (
  operation: Pick<CatalogOperation, 'id' | 'kind' | 'inputSchema' | 'outputSchema'>,
) =>
  digestOf({
    id: operation.id,
    kind: operation.kind,
    input: operation.inputSchema,
    output: operation.outputSchema,
  });

/** Which application a contract describes: its ID, its contract version and a digest of every operation's schemas. */
export interface ContractApplication {
  readonly id: string;
  readonly contractVersion: string;
  readonly digest: string;
}

/** The catalog as `/api/v1/contract` serves it: with the application and each operation's schema digest. */
export function describeContract(
  catalog: Catalog,
  id: string,
  contractVersion: string,
): Catalog & { readonly application: ContractApplication } {
  const operations = catalog.operations.map((operation) => ({
    ...operation,
    schemaDigest: operationSchemaDigest(operation),
  }));
  return {
    ...catalog,
    application: {
      id,
      contractVersion,
      digest: digestOf(
        operations.map(({ id: operation, schemaDigest }) => [operation, schemaDigest]),
      ),
    },
    operations,
  };
}
