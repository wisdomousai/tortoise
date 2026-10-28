import { z } from 'zod';
import {
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import { scannerProfileSchema } from './scanner/profile';
import { scanRouteSchema } from './scanner/router';

/**
 * Reusable capability module for per-station device configuration. It is domain-neutral: the
 * composing application decides who may read or administer a station through the access view it
 * gives `mountFeature` for `deviceFeature()`. Profiles are configuration, not secrets; vendor SDK credentials, if
 * any, stay in the host.
 */
const station = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const revision = z.number().int().min(0);
export const stationDeviceConfigSchema = z.strictObject({
  station,
  revision,
  scanners: z.array(scannerProfileSchema).max(16),
  routes: z.array(scanRouteSchema).max(64),
});

const configResource = { action: 'read', resourceType: 'DeviceConfig' } as const;
const administer = { action: 'administer', resourceType: 'DeviceConfig' } as const;

export const deviceOperations = {
  configGet: defineCapability({
    id: 'device.config.get',
    kind: 'query',
    description:
      'Read the scanner profiles and scan routes configured for one station. Stations use them to decode scanner input and map scans to intents without a model turn.',
    input: jsonSchema(z.strictObject({ station })),
    output: jsonSchema(stationDeviceConfigSchema),
    permission: configResource,
    dependencies: ['device'],
    ui: { binding: 'scanner-setup' },
  }),
  scannerSave: defineCapability({
    id: 'device.scanner.save',
    kind: 'command',
    description:
      'Create or replace one scanner profile at a station as its administrator. Use the calibration result from the setup screen; supply device:<station> in expectedRevisions to avoid overwriting a concurrent change.',
    input: jsonSchema(z.strictObject({ station, profile: scannerProfileSchema })),
    output: jsonSchema(stationDeviceConfigSchema),
    permission: administer,
    dependencies: ['device'],
    ui: { binding: 'scanner-setup' },
  }),
  scannerRemove: defineCapability({
    id: 'device.scanner.remove',
    kind: 'command',
    description: 'Remove one scanner profile from a station as its administrator.',
    input: jsonSchema(z.strictObject({ station, id: z.string().min(1).max(64) })),
    output: jsonSchema(stationDeviceConfigSchema),
    permission: administer,
    dependencies: ['device'],
    ui: { binding: 'scanner-setup' },
  }),
  routesSave: defineCapability({
    id: 'device.routes.save',
    kind: 'command',
    description:
      'Replace the ordered scan routes of a station as its administrator. The first matching route wins; patterns are validated before they are stored.',
    input: jsonSchema(z.strictObject({ station, routes: z.array(scanRouteSchema).max(64) })),
    output: jsonSchema(stationDeviceConfigSchema),
    permission: administer,
    dependencies: ['device'],
    ui: { exception: 'administrator configuration over CLI or MCP; scanner setup shows routes' },
  }),
} as const;

export const deviceConfigModule = defineModule({
  id: 'device-config',
  capabilities: Object.values(deviceOperations),
  workflows: [
    {
      id: 'configure-scanner',
      operations: ['device.config.get', 'device.scanner.save', 'device.routes.save'],
      text: 'Read the station configuration first. Save a scanner profile only from values the user confirmed or a calibration produced; never guess prefixes, suffixes or layouts. Keep specific scan routes before general ones and test a pattern against an example code the user supplies.',
    },
  ],
});

/**
 * The `device` feature: per-station device configuration as one mountable part. Its state slice is
 * `device`, its resource type `device:<station>`.
 */
export const deviceFeatureManifest = defineFeatureManifest({
  id: 'device',
  title: 'Device configuration',
  modules: [deviceConfigModule],
});
