import { defineHostComponent } from '@tortoise/contracts';

/**
 * What the station bridge needs from the deployment, as data. Side-effect free: generators import
 * this without loading Playwright, model clients or child processes. Hosts compose it into the
 * catalog's requirements, where the site policy binds or disables each destination.
 *
 * The station screen itself and the MES are declared by the domain module that names their outbox
 * targets (for example `windingLineModule`), not here: this package is domain-neutral.
 */
export const stationBridgeComponent = defineHostComponent({
  id: 'station-bridge',
  description:
    'Reads station screens with local recognition models and runs declared screen procedures behind the outbox.',
  requirements: {
    network: [
      {
        id: 'station-vision',
        purpose:
          'Local OpenAI-compatible vision model reading counters and other pixel-only fields.',
        direction: 'outbound',
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
        direction: 'outbound',
        scope: 'site',
        protocol: 'https',
        dataClasses: ['screen-frame'],
        availability: 'optional',
        offline: 'degrade',
      },
    ],
    processes: [
      {
        id: 'recognition-worker',
        // Bound by the site policy's `processes` section; the process port starts it with a built environment.
        executable: 'configured',
        purpose: 'JSON-lines recognition worker for local OCR, classifier or audio models.',
        availability: 'optional',
        // Frames are sent over stdin; the worker needs no network.
        network: [],
      },
    ],
  },
});
