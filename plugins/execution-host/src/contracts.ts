import { defineHostComponent, type Availability } from '@tortoise/contracts';

/**
 * Declare one sandbox as a host component, for an application manifest's `components`.
 * Browser-safe data. The sandbox is a child process (`bubblewrap`), so the site policy binds its
 * ID to the bwrap executable and can pin its digest, and `network` lists the only destinations
 * the sandbox may reach, through the network proxy.
 */
export function executionSandbox(options: {
  readonly id: string;
  readonly description: string;
  readonly network?: readonly string[];
  readonly availability?: Availability;
}) {
  return defineHostComponent({
    id: `sandbox-${options.id}`,
    description: options.description,
    requirements: {
      processes: [
        {
          id: options.id,
          executable: 'bwrap',
          purpose: `Bubblewrap sandbox: ${options.description}`,
          availability: options.availability ?? 'optional',
          ...(options.network?.length ? { network: [...options.network] } : {}),
        },
      ],
    },
  });
}
