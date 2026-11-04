import { defineHostComponent, type Availability } from '@tortoise/contracts';

/**
 * Declare one broker as a host component: a `tcp` destination on the site network that only
 * reads. The site policy binds its address (`tcp://broker:1883`, or with `tls: true` for 8883).
 */
export function mqttBroker(options: {
  readonly id: string;
  readonly destination: string;
  readonly description: string;
  /** What the broker sends, for the data-flow inventory. */
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
          direction: 'outbound',
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
