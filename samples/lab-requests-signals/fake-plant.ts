import { DataType } from '@agent-native/connector-mqtt/sparkplug';
import { FakeBroker, encodeSparkplug } from '@agent-native/connector-mqtt/testing';
import { FakeOpcUaServer } from '@agent-native/connector-opcua/testing';
import type { ChamberDefinition } from './domain';

const HUMIDITY = 1;

/**
 * A stand-in for the lab's chamber controllers and humidity edge nodes, for tests and the
 * development launch: a loopback OPC UA server holding each chamber's temperature node, and a
 * loopback MQTT broker where one Sparkplug B edge node per chamber publishes its humidity.
 *
 * An edge node births when it starts and again whenever a new client connects, the way a node
 * answers a host application coming online. The birth is retained, so a client that subscribes
 * after it still starts from a birth and follows the data messages in sequence.
 */
export class FakePlant {
  readonly gateway = new FakeOpcUaServer();
  readonly broker = new FakeBroker();
  private readonly nodes = new Map<
    string,
    { group: string; node: string; seq: number; bdSeq: number; humidity: number; alive: boolean }
  >();
  private connects = 0;
  private watch?: ReturnType<typeof setInterval>;

  constructor(private readonly chambers: readonly ChamberDefinition[]) {}

  /** Start both servers; ports default to free ones. Returns the ports. */
  start(ports: { gateway?: number; broker?: number } = {}) {
    const gateway = this.gateway.start(ports.gateway ?? 0);
    const broker = this.broker.start(ports.broker ?? 0);
    for (const chamber of this.chambers) {
      this.setTemperature(chamber.id, chamber.setpoint.temperature);
      this.nodes.set(chamber.id, {
        group: chamber.humidity.group,
        node: chamber.humidity.node,
        seq: 0,
        bdSeq: 0,
        humidity: chamber.setpoint.humidity,
        alive: true,
      });
      this.birth(chamber.id);
    }
    this.watch = setInterval(() => {
      if (this.broker.connects.length === this.connects) return;
      this.connects = this.broker.connects.length;
      for (const id of this.nodes.keys()) this.birth(id);
    }, 20);
    return { gateway, broker };
  }

  stop() {
    clearInterval(this.watch);
    this.gateway.stop();
    this.broker.stop();
  }

  setTemperature(chamber: string, value: number) {
    const node = this.chambers.find((candidate) => candidate.id === chamber)!.temperatureNode;
    this.gateway.values.set(node, { double: value });
  }

  /** Publish a humidity change as the chamber's edge node would, in sequence. */
  setHumidity(chamber: string, value: number) {
    const node = this.nodes.get(chamber)!;
    node.humidity = value;
    if (!node.alive) return;
    node.seq = (node.seq + 1) % 256;
    this.broker.publish(
      `spBv1.0/${node.group}/NDATA/${node.node}`,
      encodeSparkplug({
        seq: node.seq,
        metrics: [{ alias: HUMIDITY, datatype: DataType.Double, value }],
      }),
    );
  }

  /** The edge node goes offline: its death certificate makes its values stale. */
  kill(chamber: string) {
    const node = this.nodes.get(chamber)!;
    node.alive = false;
    this.broker.publish(
      `spBv1.0/${node.group}/NDEATH/${node.node}`,
      encodeSparkplug({
        metrics: [{ name: 'bdSeq', datatype: DataType.Int64, value: node.bdSeq }],
      }),
    );
  }

  /** The edge node comes back with a new birth. */
  revive(chamber: string) {
    const node = this.nodes.get(chamber)!;
    node.alive = true;
    node.bdSeq += 1;
    this.birth(chamber);
  }

  private birth(chamber: string) {
    const node = this.nodes.get(chamber)!;
    if (!node.alive) return;
    node.seq = 0;
    this.broker.publish(
      `spBv1.0/${node.group}/NBIRTH/${node.node}`,
      encodeSparkplug({
        seq: 0,
        metrics: [
          { name: 'bdSeq', datatype: DataType.Int64, value: node.bdSeq },
          { name: 'Humidity', alias: HUMIDITY, datatype: DataType.Double, value: node.humidity },
        ],
      }),
      { retain: true },
    );
  }
}
