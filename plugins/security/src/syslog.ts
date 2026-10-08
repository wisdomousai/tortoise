import { hostname } from 'node:os';
import type { AuditEvent } from '@agent-native/contracts';
import type { Egress } from '@agent-native/egress';
import { rfc5424, type EventSink } from '@agent-native/event-log';

/**
 * Forward audit events to a bound `tcp` destination as RFC 5424 syslog with RFC 5425
 * octet-counted framing (TLS when the binding sets `tls`). The connection opens through the
 * egress guard, so it is itself declared, bound, address-checked and audited. Delivery is
 * at-most-once: a dropped connection fails the in-flight batch, which the forwarder counts.
 */
export function syslogSink(
  egress: () => Egress,
  destination: string,
  appName: string,
): EventSink & { close(): void } {
  const host = hostname();
  let connection: Promise<Bun.Socket<undefined>> | undefined;
  let backlog = Buffer.alloc(0);
  let waiters: { resolve(): void; reject(error: Error): void }[] = [];
  const settle = (error?: Error) => {
    for (const waiter of waiters.splice(0)) error ? waiter.reject(error) : waiter.resolve();
  };
  const reset = () => {
    connection = undefined;
    backlog = Buffer.alloc(0);
    settle(new Error('Audit collector connection closed'));
  };
  /** Write what the socket accepts; true when the backlog is empty. */
  const pump = (socket: Bun.Socket<undefined>) => {
    while (backlog.length) {
      const written = socket.write(backlog);
      if (written <= 0) return false;
      backlog = backlog.subarray(written);
    }
    settle();
    return true;
  };
  const connect = () =>
    (connection ??= egress()
      .socket(destination, {
        data() {},
        drain: (socket) => void pump(socket),
        close: reset,
        error: reset,
      })
      .catch((error: unknown) => {
        connection = undefined;
        throw error;
      }));
  const sink = async (events: readonly AuditEvent[]) => {
    const socket = await connect();
    const frames = events.map((event) => {
      const message = rfc5424(event, { appName, hostname: host });
      return `${Buffer.byteLength(message)} ${message}`;
    });
    backlog = Buffer.concat([backlog, Buffer.from(frames.join(''))]);
    if (pump(socket)) return;
    await new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
  };
  return Object.assign(sink, {
    close() {
      void connection?.then((socket) => socket.end()).catch(() => undefined);
      connection = undefined;
    },
  });
}
