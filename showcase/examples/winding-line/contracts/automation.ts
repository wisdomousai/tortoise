import { z } from 'zod';
import { jsonSchema } from '@tortoise/contracts';
import { defineDriverContract } from '@tortoise/connector-driver/contracts';

/**
 * The station software's automation interface (a vendor COM server or similar), reached through a
 * driver on the station PC instead of through the screen. It carries the same fields the screen
 * profile reads and the same `recipe.load` procedure with the same precondition, readback and
 * risk level, so the domain cannot tell which route a station uses. `control` shows when someone
 * works the station locally; deliveries wait then, as they do when the operator holds the screen.
 */
export const stationAutomationContract = defineDriverContract({
  id: 'station-automation',
  version: '1.0.0',
  title: 'Station automation',
  process: {
    id: 'station-automation-driver',
    purpose: "Reads and loads recipes through the station software's automation interface",
    availability: 'optional',
  },
  control: { field: 'control', local: 'local' },
  state: {
    machine: { type: 'enum', options: ['STOPPED', 'RUNNING', 'ALARM'], stableReads: 2 },
    alarm: { type: 'text' },
    recipe: { type: 'text' },
    good: { type: 'number', decimals: 0 },
    scrap: { type: 'number', decimals: 0 },
    control: { type: 'enum', options: ['remote', 'local'] },
  },
  actions: {
    'recipe.load': {
      title: 'Load recipe',
      input: jsonSchema(
        z.strictObject({
          recipe: z.string().min(1).max(64),
          order: z.string().min(1).max(128),
          presence: z.strictObject({ confirmedBy: z.string().min(1).max(128) }),
        }),
      ),
      delivery: 'convergent',
      // As the screen procedure: the person who started the order confirmed they are at the machine.
      risk: 'operator-present',
      timeoutMs: 20_000,
      preconditions: [{ field: 'machine', equals: 'STOPPED' }],
      readback: [{ field: 'recipe', equals: '$input.recipe' }],
    },
  },
});
