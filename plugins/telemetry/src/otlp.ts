import {
  durationBounds,
  type Attributes,
  type CounterPoint,
  type HistogramPoint,
  type RecordedMetrics,
  type Span,
} from './recorder';

/**
 * OTLP/HTTP JSON (the protobuf JSON mapping with hex trace and span IDs, integer enums and
 * 64-bit integers as decimal strings), for `POST /v1/metrics` and `POST /v1/traces`.
 */

export interface Resource {
  readonly 'service.name': string;
  readonly 'service.instance.id': string;
  readonly 'service.version'?: string;
}

/** One gauge point: effects waiting in the outbox for one target in one state. */
export interface BacklogPoint {
  readonly target: string;
  readonly state: 'pending' | 'held' | 'acknowledged';
  readonly count: number;
}

const CUMULATIVE = 2;
const scope = { name: '@tortoise/telemetry', version: '0.1.0' };
const nanos = (ms: number) => (BigInt(Math.round(ms)) * 1_000_000n).toString();
const attributes = (values: Attributes | Resource) =>
  Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value: { stringValue: value as string } }));
const resourceOf = (resource: Resource) => ({ attributes: attributes(resource) });

function sum(
  name: string,
  unit: string,
  description: string,
  points: CounterPoint[],
  times: Times,
) {
  return {
    name,
    unit,
    description,
    sum: {
      aggregationTemporality: CUMULATIVE,
      isMonotonic: true,
      dataPoints: points.map((point) => ({
        attributes: attributes(point.attributes),
        startTimeUnixNano: times.start,
        timeUnixNano: times.now,
        asInt: String(point.value),
      })),
    },
  };
}

function histogram(name: string, description: string, points: HistogramPoint[], times: Times) {
  return {
    name,
    unit: 'ms',
    description,
    histogram: {
      aggregationTemporality: CUMULATIVE,
      dataPoints: points.map((point) => ({
        attributes: attributes(point.attributes),
        startTimeUnixNano: times.start,
        timeUnixNano: times.now,
        count: String(point.count),
        sum: point.sum,
        min: point.min,
        max: point.max,
        bucketCounts: point.buckets.map(String),
        explicitBounds: durationBounds,
      })),
    },
  };
}

interface Times {
  readonly start: string;
  readonly now: string;
}

type Metric =
  | { readonly sum: { readonly dataPoints: readonly unknown[] } }
  | { readonly histogram: { readonly dataPoints: readonly unknown[] } }
  | { readonly gauge: { readonly dataPoints: readonly unknown[] } };
const pointsOf = (metric: Metric) =>
  'sum' in metric
    ? metric.sum.dataPoints
    : 'histogram' in metric
      ? metric.histogram.dataPoints
      : metric.gauge.dataPoints;

export function metricsRequest(
  resource: Resource,
  recorded: RecordedMetrics,
  backlog: readonly BacklogPoint[],
  window: { readonly start: number; readonly now: number },
) {
  const times = { start: nanos(window.start), now: nanos(window.now) };
  const metrics = [
    sum('tortoise.commands', '{command}', 'Commands by outcome', recorded.commands, times),
    histogram(
      'tortoise.command.duration',
      'From final authorization to the outcome',
      recorded.commandDuration,
      times,
    ),
    sum(
      'tortoise.deliveries',
      '{effect}',
      'Outbox effects completed by the target',
      recorded.deliveries,
      times,
    ),
    histogram(
      'tortoise.delivery.duration',
      'From the committing command to completion',
      recorded.deliveryDuration,
      times,
    ),
    sum(
      'tortoise.delivery.attempts',
      '{attempt}',
      'Delivery attempts that did not complete the effect',
      recorded.attempts,
      times,
    ),
    {
      name: 'tortoise.outbox.backlog',
      unit: '{effect}',
      description: 'Effects waiting in the outbox',
      gauge: {
        dataPoints: backlog.map((point) => ({
          attributes: attributes({
            'tortoise.target': point.target,
            'tortoise.outbox.state': point.state,
          }),
          timeUnixNano: times.now,
          asInt: String(point.count),
        })),
      },
    },
    sum('tortoise.runs', '{run}', 'Agent and job runs by end state', recorded.runs, times),
    histogram('tortoise.run.duration', 'From queued to ended', recorded.runDuration, times),
  ].filter((metric) => pointsOf(metric).length > 0);
  return {
    resourceMetrics: [{ resource: resourceOf(resource), scopeMetrics: [{ scope, metrics }] }],
  };
}

export function tracesRequest(resource: Resource, spans: readonly Span[]) {
  return {
    resourceSpans: [
      {
        resource: resourceOf(resource),
        scopeSpans: [
          {
            scope,
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: span.kind,
              startTimeUnixNano: nanos(span.start),
              endTimeUnixNano: nanos(span.end),
              attributes: attributes(span.attributes),
              // 1 OK, 2 ERROR.
              status: { code: span.error ? 2 : 1 },
            })),
          },
        ],
      },
    ],
  };
}
