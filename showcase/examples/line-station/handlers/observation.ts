import type { InputOf, OutputOf } from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import {
  FIELDS,
  openAttention,
  openStop,
  own,
  put,
  type LineState,
  type AttentionItem,
  type FieldValue,
  type Station,
  type Stop,
} from '../domain';
import { stationOf, counters } from '../server/access';
import { compact, now, newId, handler, type Context, type LineServices } from '../server/context';

type Observation = InputOf<typeof operations.observationIngest>;

/**
 * Confident readings become the record and supersede any open attention item about their field;
 * unsure ones become attention items unless they agree with the record or the open item.
 */
function recordReadings(ctx: Context, station: Station, input: Observation) {
  for (const reading of input.readings) {
    const [open] = openAttention(ctx.state, station.id, reading.field);
    if (reading.status === 'observed') {
      put(
        station.readings,
        reading.field,
        compact({
          value: reading.value,
          confidence: reading.confidence,
          source: reading.extractor,
          model: reading.model,
          observedAt: reading.observedAt,
          frameDigest: reading.frameDigest,
          profile: { ...input.profile },
          status: 'observed' as const,
        }),
      );
      // A confident reading supersedes the open attention item about this field.
      if (open) {
        open.resolvedAt = reading.observedAt;
        open.resolution = 'superseded';
        ctx.change(`attention:${open.id}`);
      }
      continue;
    }
    // An unsure value never overwrites the record; a person confirms or corrects it.
    const current = own(station.readings, reading.field);
    // Agreeing with what is on record raises no question; the record just does not get fresher.
    if (current !== undefined && current.value === reading.value) continue;
    if (open && open.proposed === reading.value) continue;
    const item: AttentionItem = compact({
      id: open?.id ?? newId(ctx),
      station: station.id,
      field: reading.field,
      proposed: reading.value,
      confidence: reading.confidence,
      source: reading.extractor,
      model: reading.model,
      observedAt: reading.observedAt,
      frameDigest: reading.frameDigest,
      profile: { ...input.profile },
      declared: reading.declared && structuredClone(reading.declared),
      createdAt: open?.createdAt ?? now(ctx),
    });
    put(ctx.state.attention, item.id, item);
    ctx.change(`attention:${item.id}`);
  }
}

/**
 * Stops are transitions the bridge saw with confidence: RUNNING → STOPPED/ALARM opens one,
 * → RUNNING closes it. A first observation of a stopped machine has no known start.
 */
function trackStop(
  ctx: Context,
  station: Station,
  input: Observation,
  previousMachine: FieldValue | undefined,
) {
  let openedStop: string | undefined;
  let closedStop: string | undefined;
  const machine = input.readings.find(
    (reading) => reading.field === FIELDS.machine && reading.status === 'observed',
  );
  const alarm = input.readings.find(
    (reading) => reading.field === FIELDS.alarm && reading.status === 'observed',
  );
  const current = openStop(ctx.state, station.id);
  if (machine && (machine.value === 'STOPPED' || machine.value === 'ALARM')) {
    if (!current && previousMachine === 'RUNNING') {
      const stop: Stop = compact({
        id: newId(ctx),
        station: station.id,
        orderId: station.orderId,
        state: machine.value,
        alarm: typeof alarm?.value === 'string' && alarm.value ? alarm.value : undefined,
        startedAt: machine.observedAt,
      });
      put(ctx.state.stops, stop.id, stop);
      ctx.change(`stop:${stop.id}`);
      openedStop = stop.id;
    } else if (current && machine.value === 'ALARM' && current.state === 'STOPPED') {
      current.state = 'ALARM';
      if (typeof alarm?.value === 'string' && alarm.value) current.alarm = alarm.value;
      ctx.change(`stop:${current.id}`);
    }
  } else if (machine?.value === 'RUNNING' && current) {
    current.endedAt = machine.observedAt;
    ctx.change(`stop:${current.id}`);
    closedStop = current.id;
  }
  return { openedStop, closedStop };
}

/** Apply what the station screen shows: readings, attention items and stop transitions. */
function ingestObservation(
  input: Observation,
  ctx: Context,
): OutputOf<typeof operations.observationIngest> {
  const station = stationOf(ctx.state, input.station);
  // A slow observation pass finishing after a newer one never rolls state back.
  if (station.observedAt !== undefined && input.observedAt < station.observedAt)
    return { station: station.id, applied: false };
  station.screen = input.screen;
  station.observedAt = input.observedAt;
  // The station keeps the latest profile; each reading keeps the one that produced it.
  station.profile = { ...input.profile };
  if (input.localInput) station.localInputAt = input.observedAt;
  const previousMachine = own(station.readings, FIELDS.machine)?.value;
  const before = [FIELDS.good, FIELDS.scrap].map((field) => own(station.readings, field)?.value);
  recordReadings(ctx, station, input);
  const after = [FIELDS.good, FIELDS.scrap].map((field) => own(station.readings, field)?.value);
  if (before.some((value, index) => value !== after[index])) ctx.change(counters(station.id));
  const { openedStop, closedStop } = trackStop(ctx, station, input, previousMachine);
  ctx.change(`station:${station.id}`);
  return compact({ station: station.id, applied: true, openedStop, closedStop });
}

/** The station bridge's observation intake. */
export function observationHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [handler(operations.observationIngest, ingestObservation)];
}
