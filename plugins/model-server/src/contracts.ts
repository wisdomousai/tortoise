import { defineHostComponent, type Availability } from '@tortoise/contracts';

/** The servers this plugin can start, each an OpenAI-compatible HTTP server. */
export type ModelRuntime = 'llama-server' | 'vllm';

/**
 * Declare the model server as a host component, for an application manifest's `components`.
 * Browser-safe data. The server is a child process, so the site policy binds its ID to the
 * executable (and can pin it) and gives the fixed arguments that make it listen on the address
 * it binds `local-inference` to. It declares no destinations: a model server needs no network.
 */
export function modelServer(options: {
  readonly id: string;
  readonly runtime: ModelRuntime;
  readonly description?: string;
  readonly availability?: Availability;
}) {
  return defineHostComponent({
    id: `model-server-${options.id}`,
    description: options.description ?? `Local model server (${options.runtime})`,
    requirements: {
      processes: [
        {
          id: options.id,
          executable: options.runtime,
          purpose: `Serves a measured local model to agents over local-inference (${options.runtime})`,
          availability: options.availability ?? 'optional',
        },
      ],
    },
  });
}
