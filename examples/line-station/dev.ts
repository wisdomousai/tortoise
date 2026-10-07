import { startFakeHmi } from './fake-hmi/server';

/**
 * Development only (`bun run dev` here): start the fake HMI with simulation endpoints in this
 * process and point the demo station bridge at it. Counters come from the simulator unless a
 * vision model or perception worker is configured; explicit `STATION_*` variables win.
 */
const hmi = startFakeHmi({ simulationEndpoints: true });
process.env.STATION_HMI_URL ??= hmi.url;
if (!process.env.STATION_VISION_BASE_URL && !process.env.STATION_PERCEPTION_WORKER)
  process.env.STATION_SIMULATOR ??= '1';
console.log(`Fake HMI: ${hmi.url} (simulation endpoints under /__sim/)`);
