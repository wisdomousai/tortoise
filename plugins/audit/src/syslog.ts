import { hostname } from 'node:os';
import type { AuditEvent } from '@tortoise/contracts';
import { rfc5424, type EventSink } from '@tortoise/event-log';
import { bunSocket, type NetworkPort } from '@tortoise/host/plugin';

/**
 * Forward audit events to a bound `tcp` destination as RFC 5424 syslog with RFC 5425
 * octet-counted framing (TLS when the binding sets `tls`). The connection opens through the
 * composed network port, so under the network plugin it is declared, bound, address-checked and
 * audited like any other; without one it is refused and the forwarder counts the failure. Delivery is
 * at-most-once: a dropped connection fails the in-flight batch, which the forwarder counts.
 */
export function syslogSink(
  network: () => NetworkPort,
  destination: string,
  appName: string,
): EventSink & { close(): void } {
  const host = hostname();
  let connection: Promise<Bun.Socket<undefined>> | undefined;
  let backlog = Buffer.alloc(0);
  let waiters: { resolve(): void; reject(error: Error): void }[] = [];
  const complete = (error?: Error) => {
    for (const waiter of waiters.splice(0)) error ? waiter.reject(error) : waiter.resolve();
  };
  const reset = () => {
    connection = undefined;
    backlog = Buffer.alloc(0);
    complete(new Error('Audit collector connection closed'));
  };
  /** Write what the socket accepts; true when the backlog is empty. */
  const pump = (socket: Bun.Socket<undefined>) => {
    while (backlog.length) {
      const written = socket.write(backlog);
      if (written <= 0) return false;
      backlog = backlog.subarray(written);
    }
    complete();
    return true;
  };
  const connect = () =>
    (connection ??= bunSocket(network())(destination, {
      data() {},
      drain: (socket) => void pump(socket),
      close: reset,
      error: reset,
    }).catch((error: unknown) => {
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
