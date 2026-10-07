/**
 * What the station bridge needs from the deployment, as data. Side-effect free: generators import
 * this without loading Playwright, model clients or child processes. Shaped as a `HostComponent`
 * (`@agent-native/contracts` requirements); wrap it with `defineHostComponent` once that is
 * available on this branch.
 *
 * The station screen itself and the MES are declared by the domain module that names their outbox
 * targets (for example `lineStationModule`), not here: this package is domain-neutral.
 */
export const stationBridgeComponent = Object.freeze({
  id: 'station-bridge',
  description:
    'Reads station screens with local perception models and runs declared screen procedures behind the outbox.',
  requirements: {
    network: [
      {
        id: 'station-vision',
        purpose:
          'Local OpenAI-compatible vision model reading counters and other pixel-only fields.',
        direction: 'egress',
        scope: 'loopback',
        protocol: 'http',
        dataClasses: ['screen-frame'],
        availability: 'optional',
        // Without the model, pixel-only fields stay unread and become attention items.
        offline: 'degrade',
      },
      {
        id: 'station-vision-site',
        purpose:
          'Vision model on a site host the deployment allowlists explicitly (STATION_VISION_ALLOWED_HOSTS).',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        dataClasses: ['screen-frame'],
        availability: 'optional',
        offline: 'degrade',
      },
    ],
    processes: [
      {
        id: 'perception-worker',
        // Deployment-configured command (STATION_PERCEPTION_WORKER), spawned with an empty environment.
        executable: 'configured',
        purpose: 'JSON-lines perception worker for local OCR, classifier or audio models.',
        availability: 'optional',
        // Frames arrive over stdin; the worker needs no network.
        network: [],
      },
    ],
  },
} as const);
