import {
  canonicalJson,
  defineHostComponent,
  type HostComponent,
  type JsonObject,
  type JsonValue,
} from '@agent-native/contracts';
import type { DriverContract } from './define';

/** The protocol version this host speaks; a driver answering another is refused. */
export const driverProtocolVersion = '1';

/**
 * The contract as plain JSON, with schemas as JSON Schema: what the stub generators read and what
 * the digest covers. Two contracts with the same document behave the same.
 */
export function driverContractDocument(contract: DriverContract): JsonObject {
  const strip = (value: object): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
  return {
    protocol: driverProtocolVersion,
    id: contract.id,
    version: contract.version,
    title: contract.title,
    state: strip(contract.state),
    actions: Object.fromEntries(
      Object.entries(contract.actions).map(([name, { input, result, ...rest }]) => [
        name,
        {
          ...(strip(rest) as JsonObject),
          input: input.jsonSchema,
          ...(result ? { result: result.jsonSchema } : {}),
        },
      ]),
    ),
    events: Object.fromEntries(
      Object.entries(contract.events ?? {}).map(([name, { payload, ...rest }]) => [
        name,
        { ...(strip(rest) as JsonObject), ...(payload ? { payload: payload.jsonSchema } : {}) },
      ]),
    ),
    ...(contract.control ? { control: strip(contract.control) } : {}),
    lookup: contract.lookup ?? false,
  };
}

/** The canonical text the contract digest is the SHA-256 of. */
export const driverContractText = (contract: DriverContract) =>
  canonicalJson(driverContractDocument(contract));

/**
 * The host component that declares what the driver needs: its process (an executable the site
 * policy binds), its devices and its network destinations. List it in the application manifest's
 * `components`, so the security manifest, the site policy check and the firewall exports see it.
 */
export function driverComponent(contract: DriverContract): HostComponent {
  const { id, purpose, availability, network, secrets } = contract.process;
  return defineHostComponent({
    id: `driver.${contract.id}`,
    description: `${contract.title} driver`,
    requirements: {
      processes: [
        {
          id,
          executable: 'configured',
          purpose,
          availability,
          network: network ?? [],
          ...(secrets ? { secrets } : {}),
        },
      ],
      ...(contract.devices ? { devices: contract.devices } : {}),
      ...(contract.network ? { network: contract.network } : {}),
    },
  });
}
