import { Reader, Writer } from './binary';
import {
  Encoding,
  formatNodeId,
  numeric,
  readExtensionObject,
  readNodeId,
  securityPolicyNone,
  writeDataValue,
  writeEndpointDescription,
  writeNodeId,
  writeResponseHeader,
  type EndpointDescription,
} from './types';

export type FakeValue =
  { value: number | string | boolean | null; status?: number } | { double: number };

/**
 * A loopback OPC UA server for tests, speaking the subset `OpcUaClient` uses: HEL/ACK, a
 * secure channel with security policy None, sessions, Read and close. Values are set per node ID
 * text. `chunkSize` splits responses into chunks so reassembly is exercised. `writes` stays
 * empty unless a client sends a service other than the ones above.
 */
export class FakeOpcUaServer {
  readonly values = new Map<string, FakeValue>();
  readonly requests: string[] = [];
  readonly hellos: string[] = [];
  endpoints: EndpointDescription[] = [
    {
      endpointUrl: 'opc.tcp://127.0.0.1/test',
      securityMode: 1,
      securityPolicyUri: securityPolicyNone,
      userIdentityTokens: [{ policyId: 'anonymous', tokenType: 0 }],
    },
  ];
  chunkSize = 0;
  tokenLifetimeMs = 3_600_000;
  renewals = 0;
  private listener?: Bun.TCPSocketListener<{ buffer: Uint8Array }>;
  private sessions = new Set<string>();
  private nextToken = 1;

  /** Listen on 127.0.0.1 at `port`, a free one by default; returns the port. */
  start(port = 0): number {
    this.listener = Bun.listen<{ buffer: Uint8Array }>({
      hostname: '127.0.0.1',
      port,
      socket: {
        open: (socket) => {
          socket.data = { buffer: new Uint8Array(0) };
        },
        data: (socket, chunk) => this.receive(socket, new Uint8Array(chunk)),
      },
    });
    return this.listener.port;
  }

  stop() {
    this.listener?.stop(true);
  }

  /** End every session, as a server restart that keeps listening would. */
  dropSessions() {
    this.sessions.clear();
  }

  private receive(socket: Bun.Socket<{ buffer: Uint8Array }>, chunk: Uint8Array) {
    const joined = new Uint8Array(socket.data.buffer.length + chunk.length);
    joined.set(socket.data.buffer);
    joined.set(chunk, socket.data.buffer.length);
    socket.data.buffer = joined;
    while (socket.data.buffer.length >= 8) {
      const head = new Reader(socket.data.buffer.subarray(0, 8));
      const type = new TextDecoder().decode(head.take(3));
      head.byte();
      const size = head.uint32();
      if (socket.data.buffer.length < size) return;
      const body = new Reader(socket.data.buffer.slice(8, size));
      socket.data.buffer = socket.data.buffer.slice(size);
      this.message(socket, type, body);
    }
  }

  private send(socket: Bun.Socket<unknown>, type: string, prefix: Uint8Array, body: Uint8Array) {
    const size = this.chunkSize > 0 ? this.chunkSize : body.length || 1;
    for (let offset = 0; offset < body.length || offset === 0; offset += size) {
      const part = body.subarray(offset, offset + size);
      const last = offset + size >= body.length;
      const header = new Writer()
        .raw(new TextEncoder().encode(type))
        .byte(last ? 0x46 : 0x43)
        .uint32(8 + prefix.length + part.length)
        .finish();
      socket.write(new Uint8Array([...header, ...prefix, ...part]));
      if (last) break;
    }
  }

  private message(socket: Bun.Socket<{ buffer: Uint8Array }>, type: string, body: Reader) {
    if (type === 'HEL') {
      for (let index = 0; index < 5; index++) body.uint32();
      this.hellos.push(body.string() ?? '');
      const ack = new Writer().uint32(0).uint32(65_536).uint32(65_536).uint32(0).uint32(0).finish();
      const header = new Writer()
        .raw(new TextEncoder().encode('ACK'))
        .byte(0x46)
        .uint32(8 + ack.length)
        .finish();
      socket.write(new Uint8Array([...header, ...ack]));
      return;
    }
    if (type === 'CLO') {
      this.requests.push('CloseSecureChannel');
      socket.end();
      return;
    }
    const channel = body.uint32();
    if (type === 'OPN') {
      body.string();
      body.byteString();
      body.byteString();
    } else body.uint32();
    body.uint32();
    const requestId = body.uint32();
    const request = readNodeId(body);
    const id = 'numeric' in request ? request.numeric : -1;
    // Request header: token, timestamp, handle, diagnostics, audit ID, timeout, additional header.
    const token = formatNodeId(readNodeId(body));
    body.int64();
    const handle = body.uint32();
    body.uint32();
    body.string();
    body.uint32();
    readExtensionObject(body);
    const out = new Writer();
    const respond = (encoding: number) => writeNodeId(out, numeric(encoding));
    if (id === Encoding.OpenSecureChannelRequest) {
      body.uint32();
      const kind = body.int32();
      this.requests.push(kind === 1 ? 'RenewSecureChannel' : 'OpenSecureChannel');
      if (kind === 1) this.renewals++;
      respond(Encoding.OpenSecureChannelResponse);
      writeResponseHeader(out, handle);
      out
        .uint32(0)
        .uint32(channel || 7)
        .uint32(this.nextToken++)
        .dateTime(Date.now());
      out.uint32(this.tokenLifetimeMs).byteString(new Uint8Array());
      const prefix = new Writer()
        .uint32(channel || 7)
        .string(securityPolicyNone)
        .byteString(undefined)
        .byteString(undefined)
        .uint32(1)
        .uint32(requestId)
        .finish();
      return this.send(socket, 'OPN', prefix, out.finish());
    }
    const prefix = new Writer().uint32(channel).uint32(1).uint32(1).uint32(requestId).finish();
    const fault = (status: number) => {
      respond(Encoding.ServiceFault);
      writeResponseHeader(out, handle, status);
      this.send(socket, 'MSG', prefix, out.finish());
    };
    if (id === Encoding.CreateSessionRequest) {
      this.requests.push('CreateSession');
      const session = `s=session-${this.sessions.size + 1}-${Date.now()}`;
      this.sessions.add(session);
      respond(Encoding.CreateSessionResponse);
      writeResponseHeader(out, handle);
      writeNodeId(out, { namespace: 1, string: `id-${session}` });
      writeNodeId(out, { namespace: 1, string: session.slice(2) });
      out.double(60_000).byteString(new Uint8Array(32)).byteString(undefined);
      out.int32(this.endpoints.length);
      for (const endpoint of this.endpoints) writeEndpointDescription(out, endpoint);
      out.int32(0).string(undefined).byteString(undefined).uint32(0);
      return this.send(socket, 'MSG', prefix, out.finish());
    }
    const session = token.replace(/^ns=1;/, '');
    if (!this.sessions.has(session)) return fault(0x80250000);
    if (id === Encoding.ActivateSessionRequest) {
      this.requests.push('ActivateSession');
      respond(Encoding.ActivateSessionResponse);
      writeResponseHeader(out, handle);
      out.byteString(new Uint8Array(32)).int32(0).int32(0);
      return this.send(socket, 'MSG', prefix, out.finish());
    }
    if (id === Encoding.ReadRequest) {
      this.requests.push('Read');
      body.double();
      body.int32();
      const nodes = body.array(() => {
        const node = formatNodeId(readNodeId(body));
        body.uint32();
        body.string();
        body.uint16();
        body.string();
        return node;
      });
      respond(Encoding.ReadResponse);
      writeResponseHeader(out, handle);
      out.int32(nodes.length);
      for (const node of nodes) {
        const value = this.values.get(node);
        if (!value) writeDataValue(out, { status: 0x80340000 });
        else if ('double' in value)
          writeDataValue(out, { value: { double: value.double }, sourceTimestamp: Date.now() });
        else
          writeDataValue(out, {
            value: value.value,
            ...(value.status ? { status: value.status } : {}),
            sourceTimestamp: Date.now(),
          });
      }
      out.int32(0);
      return this.send(socket, 'MSG', prefix, out.finish());
    }
    if (id === Encoding.CloseSessionRequest) {
      this.requests.push('CloseSession');
      this.sessions.delete(session);
      respond(Encoding.CloseSessionResponse);
      writeResponseHeader(out, handle);
      return this.send(socket, 'MSG', prefix, out.finish());
    }
    this.requests.push(`unsupported ${id}`);
    fault(0x800b0000);
  }
}
