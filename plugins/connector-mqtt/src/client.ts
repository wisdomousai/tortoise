import type { NetworkPort } from '@tortoise/kernel/plugin';
import { bunSocket } from '@tortoise/host/plugin';
import {
  PacketReader,
  PacketType,
  decodePublish,
  encodeConnect,
  encodeDisconnect,
  encodePingreq,
  encodePuback,
  encodeSubscribe,
  type Publish,
} from './packets';

export interface MqttSubscriberOptions {
  readonly network: NetworkPort;
  /** A declared `tcp` destination; the site policy binds the broker's address and TLS. */
  readonly destination: string;
  readonly clientId: string;
  readonly filters: readonly string[];
  readonly username?: string;
  /** From the deployment's secret store, never from a policy or manifest. */
  readonly password?: string;
  /** Default 30 s. */
  readonly keepAliveSeconds?: number;
  readonly onMessage: (message: Publish) => void;
  /** Connection state changes; `false` means values may be stale from now on. */
  readonly onConnection?: (connected: boolean) => void;
  readonly onError?: (error: unknown) => void;
  /** First reconnect delay; doubles to 60 s. Default 1 s. */
  readonly retryMs?: number;
}

/**
 * A read-only MQTT 3.1.1 subscriber over the network port. It connects with a clean session,
 * subscribes at QoS 1, acknowledges what it receives and reconnects with backoff. It never
 * publishes, so it cannot change anything on the broker or the devices behind it.
 */
export function createMqttSubscriber(options: MqttSubscriberOptions) {
  const keepAlive = options.keepAliveSeconds ?? 30;
  const firstRetry = options.retryMs ?? 1_000;
  let stopped = false;
  let retry = firstRetry;
  let socket: { write(data: Uint8Array): number; end(): void } | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let lastHeard = Date.now();
  let connected = false;

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    options.onConnection?.(value);
  };

  const drop = (error?: unknown) => {
    if (error) options.onError?.(error);
    clearInterval(ping);
    socket = undefined;
    setConnected(false);
    if (stopped || reconnect) return;
    reconnect = setTimeout(() => {
      reconnect = undefined;
      void connect();
    }, retry);
    retry = Math.min(retry * 2, 60_000);
  };

  async function connect() {
    const reader = new PacketReader();
    try {
      const opened = await bunSocket(options.network)(options.destination, {
        data(live, chunk: Uint8Array) {
          lastHeard = Date.now();
          let packets;
          try {
            packets = reader.push(new Uint8Array(chunk));
          } catch (error) {
            live.end();
            return drop(error);
          }
          for (const packet of packets) {
            if (packet.type === PacketType.connack) {
              if (packet.body[1] !== 0) {
                live.end();
                return drop(
                  new Error(`The broker refused the connection (code ${packet.body[1]})`),
                );
              }
              live.write(
                encodeSubscribe(
                  1,
                  options.filters.map((topic) => ({ topic, qos: 1 as const })),
                ),
              );
            } else if (packet.type === PacketType.suback) {
              if ([...packet.body.subarray(2)].some((code) => code === 0x80)) {
                live.end();
                return drop(new Error('The broker refused a subscription'));
              }
              retry = firstRetry;
              setConnected(true);
            } else if (packet.type === PacketType.publish) {
              const message = decodePublish(packet);
              if (message.qos > 0 && message.packetId !== undefined)
                live.write(encodePuback(message.packetId));
              try {
                options.onMessage(message);
              } catch (error) {
                options.onError?.(error);
              }
            }
          }
        },
        close: () => drop(),
        error: (_live, error) => drop(error),
      });
      socket = opened;
      if (stopped) return opened.end();
      opened.write(
        encodeConnect({
          clientId: options.clientId,
          keepAliveSeconds: keepAlive,
          ...(options.username !== undefined ? { username: options.username } : {}),
          ...(options.password !== undefined ? { password: options.password } : {}),
        }),
      );
      lastHeard = Date.now();
      ping = setInterval(
        () => {
          // Nothing heard for one and a half keep-alive periods: the broker or the path is gone.
          if (Date.now() - lastHeard > keepAlive * 1_500) {
            opened.end();
            return drop(new Error('The broker stopped responding'));
          }
          opened.write(encodePingreq());
        },
        (keepAlive * 1_000) / 2,
      );
    } catch (error) {
      drop(error);
    }
  }

  return {
    start() {
      stopped = false;
      void connect();
    },
    get connected() {
      return connected;
    },
    async stop() {
      stopped = true;
      clearTimeout(reconnect);
      reconnect = undefined;
      clearInterval(ping);
      if (socket) {
        socket.write(encodeDisconnect());
        socket.end();
      }
      socket = undefined;
      setConnected(false);
    },
  };
}
export type MqttSubscriber = ReturnType<typeof createMqttSubscriber>;
