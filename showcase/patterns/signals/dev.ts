import { resolve } from 'node:path';
import { defaultChambers } from './domain';
import { FakePlant } from './fake-plant';

/**
 * Run by `bun run dev:web` before the launch. It starts the plant stand-in, the chamber OPC UA
 * gateway on 127.0.0.1:4374 and the humidity broker on 127.0.0.1:4373, and binds both
 * destinations to it. Chamber 1 holds its setpoint with a little noise; chamber 2's humidity
 * drifts out of tolerance and back every two minutes. An explicit `TORTOISE_SITE_POLICY`
 * wins.
 */
const plant = new FakePlant(defaultChambers);
const ports = plant.start({ gateway: 4374, broker: 4373 });
const started = Date.now();
const round = (value: number) => Math.round(value * 10) / 10;
setInterval(() => {
  const minutes = (Date.now() - started) / 60_000;
  const wave = Math.sin(minutes * Math.PI);
  plant.setTemperature('chamber-1', round(23 + 0.3 * wave));
  plant.setHumidity('chamber-1', round(50 + 2 * wave));
  plant.setTemperature('chamber-2', 23);
  plant.setHumidity('chamber-2', round(55 + 12 * wave));
}, 3_000).unref();
process.env.TORTOISE_SITE_POLICY ??= resolve(import.meta.dir, 'site-policy.dev.json');
console.log(
  `Plant stand-in: OPC UA opc.tcp://127.0.0.1:${ports.gateway}, MQTT tcp://127.0.0.1:${ports.broker}`,
);
