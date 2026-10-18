import { defineAgent, defineModule, approvalOperations } from '@agent-native/contracts';
import { commandOperations } from './contracts/commands';
import { queryOperations } from './contracts/queries';

/**
 * Line station contracts: operator workstations whose machine software can only be read and
 * driven through its screen, on top of a homebrew MES that owns orders and stop reasons.
 *
 * Three principals touch this module. People (operator, supervisor, viewer per station) use the
 * station surface and MCP. Each station's bridge (`station-bridge:<station>`) submits what the
 * screen shows and settles screen procedures. The MES integration syncs orders and reasons and
 * settles forwarded records. Neither integration principal can do what people do.
 */
export {
  stationRoleSchema,
  bridgeModeSchema,
  seatSchema,
  syncSchema,
  observedReadingSchema,
  observationSchema,
  readingSchema,
  stopSchema,
  countReportSchema,
  attentionSchema,
  orderSchema,
  reasonSchema,
  stationSummarySchema,
  stationDetailSchema,
} from './contracts/schemas';
export { mesTarget } from './contracts/target';

export const operations = {
  ...queryOperations,
  ...commandOperations,
  ...approvalOperations,
} as const;

/**
 * Requests approval for a reason for an unclassified stop. Its run can read and request approval, never classify: an
 * operator at the station approves the approval request, which classifies the stop as that operator.
 */
export const stopExplainer = defineAgent({
  id: 'stop.explainer',
  title: 'Stop explainer',
  instructions:
    'Find the unclassified stop, read the station state and alarm text at the stop and the MES stop reasons, and request approval for line.stop.classify with the reason the alarm and history support. Put your evidence in the rationale, the stop as the resource (stop:<id>) and the stop revision you read as baseRevisions. If no reason fits, request nothing and say so.',
  operations: [
    'line.stop.list',
    'line.station.get',
    'line.reason.list',
    'line.stop.classify',
    'approval.list',
  ],
  // Not resource-scoped: grant resources match exactly, so a run scoped to `station:<id>` could
  // not create its approval request record. The starter's station roles bound the run instead.
  model: 'any',
  output: 'request-approval',
  budgets: { turns: 12, toolCalls: 24, wallTimeMs: 120_000 },
});

export const lineStationModule = defineModule({
  id: 'line-station',
  capabilities: Object.values(operations),
  requirements: {
    network: [
      {
        id: 'station-screen',
        purpose:
          'Reach the legacy station software screen to observe it and run declared procedures (web HMI, VNC or RDP, per site).',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['legacy-hmi'],
        dataClasses: ['screen-input', 'recipe-selection'],
        availability: 'optional',
        offline: 'queue',
      },
      {
        id: 'mes-api',
        purpose:
          'Forward stop classifications and count confirmations to the MES and pull orders and reasons.',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['mes'],
        dataClasses: ['stop-classification', 'count-confirmation'],
        availability: 'required',
        offline: 'queue',
      },
    ],
  },
  agents: [stopExplainer],
  workflows: [
    {
      id: 'explain-stop',
      operations: ['line.stop.list', 'line.station.get', 'line.reason.list', 'approval.request'],
      text: 'Find the unclassified stop, read the station state and alarm text at the stop and the MES stop reasons, and submit an approval to classify it with the reason the alarm and history support, with your evidence as the rationale. The operator accepts or rejects it at the station; never classify a stop from a guess. If no reason fits, say so.',
    },
    {
      id: 'shift-handover',
      operations: [
        'line.station.list',
        'line.station.get',
        'line.stop.list',
        'line.attention.list',
        'line.sync.status',
      ],
      text: 'Summarize each station for the next shift: active order and counters with their freshness and source, stops and their classification, open attention items and held screen procedures, and records the MES rejected. Report observed values as observed (with time and confidence), not as facts.',
    },
  ],
});
