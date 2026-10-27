import {
  createAccessibilityExtractor,
  createOpenAiCompatibleVisionExtractor,
  createPlaywrightTransport,
  createWorkerExtractor,
  type Extractor,
  type PlaywrightPageLike,
} from '@agent-native/screen-bridge';
import { createLineStationBridge, filler, loadProfile } from './bridge';
import { createSimulatorOcr } from './fake-hmi/memory';
import type { HostedApplication } from '@agent-native/host/application';
import { bunProcesses, noProcesses, type ProcessPort } from '@agent-native/host/plugin';

/**
 * How the host reaches one station's screen. Supplied explicitly by the deploying application
 * (or the demo from its environment); nothing is discovered. Counters are pixel-only on the
 * reference HMI, so they need a screen recognizer:
 * - `simulator`: ground truth from the simulated HMI (demo and tests only);
 * - `vision`: a local OpenAI-compatible vision model, loopback or allowlisted;
 * - `worker`: the JSON-lines `recognition-worker` process the site policy binds, started through the
 *   process port;
 * - `none`: counters stay unread.
 */
export interface StationBridgeConfig {
  readonly station: string;
  readonly hmiUrl: string;
  readonly profilePath?: string;
  /** The simulated HMI reports local input; real stations need an input hook to offer this. */
  readonly localInputProbe?: boolean;
  readonly counters:
    | { readonly kind: 'simulator' }
    | {
        readonly kind: 'vision';
        readonly baseUrl: string;
        readonly model: string;
        readonly allowedHosts?: readonly string[];
        readonly reads?: number;
      }
    | { readonly kind: 'worker' }
    | { readonly kind: 'none' };
  readonly observeMs?: number;
  readonly deliverMs?: number;
}

function counterExtractor(
  config: StationBridgeConfig,
  processes: ProcessPort,
  closers: (() => Promise<void>)[],
): Extractor {
  const id = 'counter-ocr';
  const counters = config.counters;
  switch (counters.kind) {
    case 'simulator':
      return createSimulatorOcr(async () => {
        const response = await fetch(new URL('/__sim/counters', config.hmiUrl));
        if (!response.ok) throw new Error(`Simulator returned ${response.status}`);
        return (await response.json()) as { good: number; scrap: number };
      });
    case 'vision':
      return createOpenAiCompatibleVisionExtractor({ id, ...counters });
    case 'worker': {
      // Refuse at startup, with the port's reason, rather than on the first frame.
      const ready = processes.availability('recognition-worker');
      if (!ready.available) throw new Error(ready.reason);
      const spawn = bunProcesses(processes);
      const worker = createWorkerExtractor({
        id,
        modality: 'ocr',
        start: () => spawn('recognition-worker'),
      });
      closers.push(() => worker.close());
      return worker;
    }
    case 'none':
      return { id, modality: 'ocr', extract: async () => [] };
  }
}

/**
 * Start one station bridge against a browser-based station screen (the simulated HMI, or station
 * software that is itself a web application). Playwright is loaded only here, only when a station
 * is configured; other screens need their own transport (VNC, RDP, KVM-over-IP, UI Automation).
 */
export async function startStationBridge(options: {
  application: HostedApplication;
  workspaceId: string;
  config: StationBridgeConfig;
  /** Starts the `recognition-worker` for `worker` counters; without it they are refused. */
  processes?: ProcessPort;
  onError?: (error: unknown) => void;
}) {
  const { config } = options;
  const profile = config.profilePath ? loadProfile(config.profilePath) : filler;
  // Optional and external to standalone builds (see @agent-native/host/optional-packages).
  const { chromium } = await import('@playwright/test').catch(() => {
    throw new Error(
      'The browser station bridge needs @playwright/test installed where the service runs',
    );
  });
  const browser = await chromium.launch();
  const closers: (() => Promise<void>)[] = [() => browser.close()];
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.goto(config.hmiUrl);
    const transport = createPlaywrightTransport({
      page: page as unknown as PlaywrightPageLike,
      pixels: config.counters.kind === 'vision' || config.counters.kind === 'worker',
      ...(config.localInputProbe
        ? {
            localInputSince: async (since: number) => {
              const url = new URL('/local-input', config.hmiUrl);
              url.searchParams.set('since', String(since));
              return ((await (await fetch(url)).json()) as { used: boolean }).used;
            },
          }
        : {}),
    });
    const bridge = createLineStationBridge({
      application: options.application,
      workspaceId: options.workspaceId,
      station: config.station,
      profile,
      transport,
      extractors: [
        createAccessibilityExtractor(),
        counterExtractor(config, options.processes ?? noProcesses, closers),
      ],
    });
    bridge.start(config.observeMs ?? 1_000, config.deliverMs ?? 1_000, options.onError);
    return {
      bridge,
      async stop() {
        await bridge.stop();
        for (const close of closers) await close().catch(() => undefined);
      },
    };
  } catch (error) {
    for (const close of closers) await close().catch(() => undefined);
    throw error;
  }
}
