import { defineHostComponent, type Availability } from '@tortoise/contracts';

/**
 * Declare one OPC UA server as a host component: a `tcp` destination on the site network that
 * only reads. The site policy binds its address, `tcp://plc-gateway:4840`.
 */
export function opcUaServer(options: {
  readonly id: string;
  readonly destination: string;
  readonly description: string;
  readonly dataClasses: readonly string[];
  readonly availability?: Availability;
}) {
  return defineHostComponent({
    id: options.id,
    description: options.description,
    requirements: {
      network: [
        {
          id: options.destination,
          purpose: options.description,
          direction: 'egress',
          scope: 'site',
          protocol: 'tcp',
          dataClasses: options.dataClasses,
          availability: options.availability ?? 'optional',
          offline: 'degrade',
        },
      ],
    },
  });
}
