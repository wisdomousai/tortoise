import { ApplicationError } from '@tortoise/contracts';
import { WorkspaceOwnedError } from '@tortoise/adapters/ownership';
import type { AnyApplicationDefinition } from '@tortoise/kernel/application';
import { openInstance } from '@tortoise/kernel/instance';
import type { PluginSettings } from '@tortoise/kernel/plugins/settings';
import { bunPlatform } from './platform/bun';

export { LOCAL_OWNER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
export { workspaceStorage } from './platform/bun';

/**
 * Open the workspace in this process with no network listener, for stdio MCP and one-shot CLI
 * use inside a sandbox. Ownership is the same OS lock the HTTP host takes, so an embedded process
 * and a running host can never both write one workspace. Fails with CONFLICT when one is live.
 *
 * The same plugins open as for the HTTP host, before the workspace, and their `ready` hooks run
 * before the first call; so a security plugin checks its policy, audits every command and
 * resolves crash-orphaned entries here too. Plugins never `start` here and observers never
 * start; integrations are built but only run when the caller starts them.
 */
export async function openEmbeddedInstance(
  definition: AnyApplicationDefinition,
  options: { workspacePath: string; settings?: PluginSettings },
) {
  const ownership = await bunPlatform
    .acquireOwnership(options.workspacePath)
    .catch((error: unknown) => {
      if (error instanceof WorkspaceOwnedError)
        throw new ApplicationError(
          'CONFLICT',
          'A live instance owns this workspace; attach with --connection or stop it first',
        );
      throw error;
    });
  const instance = await openInstance(definition, {
    platform: bunPlatform,
    ownership,
    component: 'embedded',
    serving: false,
    ...(options.settings ? { settings: options.settings } : {}),
  }).catch(async (error: unknown) => {
    await ownership.release();
    throw error;
  });
  let closed = false;
  return {
    application: instance.application,
    integrations: instance.integrations,
    ports: instance.ports,
    /** Services the plugins expose, keyed by plugin id. */
    services: instance.services,
    workspacePath: ownership.canonicalPath,
    /** Stop background delivery, release storage, close the plugins, then the ownership lock. */
    async close() {
      if (closed) return;
      closed = true;
      await instance.close();
      await ownership.release();
    },
  };
}
export type EmbeddedInstance = Awaited<ReturnType<typeof openEmbeddedInstance>>;
