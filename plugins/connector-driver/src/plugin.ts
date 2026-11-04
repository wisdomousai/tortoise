import { defineHostPlugin } from '@tortoise/host/plugin';
import { driverCliCommand } from './cli';
import { openDrivers, type DriverPluginOptions } from './open';
import { driverPluginManifest } from './plugin-manifest';
import { createDriverHandlers, createDriverState, driverPolicy, type DriverState } from './server';

/**
 * The driver plugin for one application's drivers. It needs the process plugin, which starts
 * each driver from the executable the site policy binds. Its service (`driverServiceOf`) holds
 * one supervisor per driver; its query `driver.status.get` reports them to the workspace owner.
 *
 * Pass the same contracts as to `driverPluginManifest`, so the manifest declares exactly the
 * processes the plugin starts.
 */
export function createDriverPlugin(options: DriverPluginOptions) {
  return defineHostPlugin<DriverState>({
    manifest: driverPluginManifest(options.contracts),
    requires: ['process'],
    state: { create: (ownerId) => createDriverState([ownerId]) },
    handlers: createDriverHandlers(),
    authorization: { resourceTypes: ['driver'], port: driverPolicy },
    commands: [driverCliCommand(options.contracts)],
    open: async (context) => openDrivers(options, context),
  });
}
