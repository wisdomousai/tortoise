import { defineHostComponent } from '@tortoise/contracts';
import { definePluginManifest } from '@tortoise/host/plugin-manifest';

/** The destination the exporter posts OTLP/HTTP JSON to: a collector on this machine. */
export const TELEMETRY_DESTINATION = 'telemetry';

export const telemetryExportComponent = defineHostComponent({
  id: 'telemetry-export',
  description:
    'Exports command, delivery, outbox and run metrics and spans as OpenTelemetry, without record contents.',
  requirements: {
    network: [
      {
        id: TELEMETRY_DESTINATION,
        purpose:
          'Post OpenTelemetry metrics and traces (OTLP/HTTP JSON) to a collector on this machine, which forwards them on.',
        direction: 'egress',
        scope: 'loopback',
        protocol: 'http',
        dataClasses: ['telemetry'],
        availability: 'optional',
        offline: 'degrade',
      },
    ],
  },
});

/** The browser-safe part of the telemetry plugin: no module and no settings, one destination. */
export const telemetryPluginManifest = definePluginManifest({
  id: 'telemetry',
  title: 'Telemetry',
  components: [telemetryExportComponent],
});
