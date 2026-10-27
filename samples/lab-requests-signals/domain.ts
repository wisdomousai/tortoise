import type { LabRequestsState } from '@agent-native/sample-lab-requests/server';
import type { SparkplugField } from '@agent-native/connector-mqtt/observe';
import type { Condition } from './contracts';

/** The principal the OPC UA and MQTT observers submit as; it holds no lab role. */
export const OBSERVER_PRINCIPAL = 'chamber-observer';

/**
 * Where a chamber's quantities come from: the controller's temperature node on the OPC UA
 * gateway, and the humidity metric of a Sparkplug B edge node.
 */
export interface ChamberDefinition {
  readonly id: string;
  readonly label: string;
  readonly temperatureNode: string;
  readonly humidity: SparkplugField['sparkplug'];
  readonly setpoint: { readonly temperature: number; readonly humidity: number };
  readonly tolerance: { readonly temperature: number; readonly humidity: number };
}

const standardAtmosphere = {
  setpoint: { temperature: 23, humidity: 50 },
  tolerance: { temperature: 2, humidity: 10 },
};

/** Two chambers held at 23 °C and 50 % relative humidity. */
export const defaultChambers: readonly ChamberDefinition[] = [
  {
    id: 'chamber-1',
    label: 'Climate chamber 1',
    temperatureNode: 'ns=2;s=Chamber1.Temperature',
    humidity: { group: 'lab', node: 'chamber-1', metric: 'Humidity' },
    ...standardAtmosphere,
  },
  {
    id: 'chamber-2',
    label: 'Climate chamber 2',
    temperatureNode: 'ns=2;s=Chamber2.Temperature',
    humidity: { group: 'lab', node: 'chamber-2', metric: 'Humidity' },
    ...standardAtmosphere,
  },
];

export type Quantity = 'temperature' | 'humidity';

/** The `chambers` slice: the last conditions per chamber and the chamber of each request. */
export interface ChambersState {
  conditions: Record<string, Partial<Record<Quantity, Condition>>>;
  placements: Record<string, string>;
}

export interface LabSignalsRoot {
  labRequests: LabRequestsState;
  chambers: ChambersState;
}

export const createChambersState = (): ChambersState => ({ conditions: {}, placements: {} });

/** The reading field for one quantity of one chamber, such as `chamber-1.temperature`. */
export const fieldId = (chamber: string, quantity: Quantity) => `${chamber}.${quantity}`;
