import { defineModule } from '@agent-native/contracts';
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

export const operations = { ...queryOperations, ...commandOperations } as const;

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
  workflows: [
    {
      id: 'explain-stop',
      operations: ['line.stop.list', 'line.station.get', 'line.reason.list', 'line.stop.classify'],
      text: 'Find the unclassified stop, read the station state and alarm text at the stop and the MES stop reasons, and propose the reason that the alarm and history support, with your evidence. Classify only after the operator confirms the reason; never classify a stop from a guess. If no reason fits, say so.',
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
