import { defineCollection } from '@tortoise/contracts';
import { lotSummarySchema } from './schemas';

/** Inspection lots published by the quality system, keyed by lot number, grouped by plant. */
export const lots = defineCollection({
  type: 'lot',
  resourceType: 'InspectionLot',
  item: lotSummarySchema,
  container: 'plant',
  label: { one: 'Lot', many: 'Lots' },
});
