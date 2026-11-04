import { randomBytes } from 'node:crypto';
import { bunSocket } from '@tortoise/host/plugin';
import type { NetworkPort } from '@tortoise/kernel/plugin';
import { Reader, Writer } from './binary';
import {
  Encoding,
  isBad,
  numeric,
  readDataValue,
  readEndpointDescription,
  readNodeId,
  readResponseHeader,
  securityPolicyNone,
  writeApplicationDescription,
  writeExtensionObject,
  writeNodeId,
  writeRequestHeader,
  type DataValue,
  type NodeId,
} from './types';

export interface OpcUaClientOptions {
  readonly network: NetworkPort;
  /** A declared `tcp` destination; the site policy binds the server's address. */
  readonly destination: string;
  /** The endpoint URL the server expects to be told, `opc.tcp://host:4840/path`. */
  readonly endpointUrl: string;
  /** Per request. Default 10 000 ms. */
  readonly timeoutMs?: number;
  /** Requested session timeout. Default 60 000 ms. */
  readonly sessionTimeoutMs?: number;
  readonly sessionName?: string;
}

/** A service or protocol error, with the status code the server gave. */
export class OpcUaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(
      status === undefined ? message : `${message} (0x${status.toString(16).padStart(8, '0')})`,
    );
    this.name = 'OpcUaError';
  }
}

const receiveBuffer = 65_536;
const maxMessage = 16 * 1024 * 1024;
const maxChunks = 512;
const ascii = (text: string) => new TextEncoder().encode(text);

function frame(type: 'HEL' | 'OPN' | 'MSG' | 'CLO', body: Uint8Array): Uint8Array {
  const header = new Writer()
    .raw(ascii(type))
    .byte(0x46)
    .uint32(8 + body.length)
    .finish();
  const out = new Uint8Array(header.length + body.length);
  out.set(header);
  out.set(body, header.length);
  return out;
}

interface Pending {
  resolve(body: Reader): void;
  reject(error: Error): void;
  chunks: Uint8Array[];
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A reading OPC UA client: UA TCP, a secure channel with security policy None, an anonymous
 * session and the Read service. It reaches the server only through the network port.
 *
 * Limits: no signing or encryption and no user name or certificate sign-in, so it fits only an
 * OT network where the server allows an unsecured anonymous endpoint; a server that requires
 * more is refused at connect with the reason. It reads; it never writes, calls methods or
 * browses beyond the nodes it is given.
 */
export class OpcUaClient {
  private socket?: { write(data: Uint8Array): number; end(): void };
  private buffer = new Uint8Array(0);
  private readonly pending = new Map<number, Pending>();
  private hello?: { resolve(): void; reject(error: Error): void };
  private channelId = 0;
  private tokenId = 0;
  private sequence = 1;
  private requestId = 1;
  private handle = 1;
  private authenticationToken?: NodeId;
  private renewal?: ReturnType<typeof setTimeout>;
  private closed = false;
  private failure?: Error;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpcUaClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  get connected() {
    return Boolean(this.socket && this.authenticationToken && !this.failure);
  }

  /** Open the connection, the channel and an anonymous session. */
  async connect(): Promise<void> {
    this.socket = await bunSocket(this.options.network)(this.options.destination, {
      data: (_socket, chunk: Uint8Array) => this.receive(new Uint8Array(chunk)),
      close: () => this.fail(new OpcUaError('The OPC UA server closed the connection')),
      error: (_socket, error) => this.fail(error),
    });
    await this.sayHello();
    await this.openChannel(0);
    await this.createSession();
  }

  /** Read the Value attribute of each node, in order. */
  async read(nodes: readonly NodeId[]): Promise<DataValue[]> {
    const body = new Writer();
    writeRequestHeader(body, this.header());
    body.double(0).int32(2);
    body.int32(nodes.length);
    for (const node of nodes) {
      writeNodeId(body, node);
      body.uint32(13).string(undefined).uint16(0).string(undefined);
    }
    const reader = await this.call(Encoding.ReadRequest, Encoding.ReadResponse, body.finish());
    const results = reader.array(() => readDataValue(reader));
    if (results.length !== nodes.length)
      throw new OpcUaError(
        `The server returned ${results.length} values for ${nodes.length} nodes`,
      );
    return results;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.renewal);
    if (this.connected) {
      const body = new Writer();
      writeRequestHeader(body, this.header());
      body.boolean(true);
      await this.call(
        Encoding.CloseSessionRequest,
        Encoding.CloseSessionResponse,
        body.finish(),
      ).catch(() => undefined);
      const close = new Writer();
      writeRequestHeader(close, this.header());
      this.send('CLO', this.symmetric(Encoding.CloseSecureChannelRequest, close.finish()).bytes);
    }
    this.socket?.end();
    this.fail(new OpcUaError('The client was closed'));
  }

  private header() {
    return {
      ...(this.authenticationToken ? { authenticationToken: this.authenticationToken } : {}),
      requestHandle: this.handle++,
      timeoutHint: this.timeoutMs,
    };
  }

  private send(type: 'HEL' | 'OPN' | 'MSG' | 'CLO', body: Uint8Array) {
    if (!this.socket) throw new OpcUaError('Not connected');
    this.socket.write(frame(type, body));
  }

  private sayHello() {
    const body = new Writer()
      .uint32(0)
      .uint32(receiveBuffer)
      .uint32(receiveBuffer)
      .uint32(maxMessage)
      .uint32(maxChunks)
      .string(this.options.endpointUrl)
      .finish();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new OpcUaError('The OPC UA server did not acknowledge the connection')),
        this.timeoutMs,
      );
      this.hello = {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (error) => (clearTimeout(timer), reject(error)),
      };
      this.send('HEL', body);
    });
  }

  /** Issue (0) or renew (1) the channel's security token. */
  private async openChannel(requestType: 0 | 1) {
    const request = new Writer();
    writeNodeId(request, numeric(Encoding.OpenSecureChannelRequest));
    writeRequestHeader(request, { requestHandle: this.handle++, timeoutHint: this.timeoutMs });
    request.uint32(0).int32(requestType).int32(1).byteString(new Uint8Array()).uint32(3_600_000);
    const id = this.requestId++;
    const body = new Writer()
      .uint32(this.channelId)
      .string(securityPolicyNone)
      .byteString(undefined)
      .byteString(undefined)
      .uint32(this.sequence++)
      .uint32(id)
      .raw(request.finish())
      .finish();
    const reader = await this.await(id, () => this.send('OPN', body));
    this.expect(reader, Encoding.OpenSecureChannelResponse);
    this.checkHeader(reader);
    reader.uint32();
    this.channelId = reader.uint32();
    this.tokenId = reader.uint32();
    reader.dateTime();
    const lifetime = reader.uint32();
    // Renew at three quarters of the lifetime, as Part 4 recommends; the old token stays
    // valid until the new one is used, so requests in flight are unaffected.
    clearTimeout(this.renewal);
    this.renewal = setTimeout(
      () => void this.openChannel(1).catch((error: unknown) => this.fail(error as Error)),
      Math.max(1_000, lifetime * 0.75),
    );
  }

  private async createSession() {
    const body = new Writer();
    writeRequestHeader(body, this.header());
    writeApplicationDescription(body, {
      uri: 'urn:tortoise:opcua-observer',
      name: 'tortoise OPC UA observer',
      type: 1,
    });
    body.string(undefined).string(this.options.endpointUrl);
    body.string(this.options.sessionName ?? 'tortoise observer');
    body.byteString(randomBytes(32)).byteString(undefined);
    body.double(this.options.sessionTimeoutMs ?? 60_000).uint32(0);
    const reader = await this.call(
      Encoding.CreateSessionRequest,
      Encoding.CreateSessionResponse,
      body.finish(),
    );
    readNodeId(reader);
    const token = readNodeId(reader);
    reader.double();
    reader.byteString();
    reader.byteString();
    const endpoints = reader.array(() => readEndpointDescription(reader));
    const anonymous = endpoints
      .filter(
        (endpoint) =>
          endpoint.securityMode === 1 && endpoint.securityPolicyUri === securityPolicyNone,
      )
      .flatMap((endpoint) => endpoint.userIdentityTokens)
      .find((policy) => policy.tokenType === 0);
    if (!anonymous)
      throw new OpcUaError(
        'The server offers no anonymous sign-in on an unsecured endpoint; this client supports no other',
      );
    this.authenticationToken = token;
    const activate = new Writer();
    writeRequestHeader(activate, this.header());
    activate.string(undefined).byteString(undefined);
    activate.int32(0).int32(0);
    const identity = new Writer().string(anonymous.policyId).finish();
    writeExtensionObject(activate, numeric(Encoding.AnonymousIdentityToken), identity);
    activate.string(undefined).byteString(undefined);
    const result = await this.call(
      Encoding.ActivateSessionRequest,
      Encoding.ActivateSessionResponse,
      activate.finish(),
    );
    result.byteString();
    for (const status of result.array(() => result.uint32()))
      if (isBad(status)) throw new OpcUaError('The server refused to activate the session', status);
  }

  private symmetric(type: number, payload: Uint8Array) {
    const request = new Writer();
    writeNodeId(request, numeric(type));
    request.raw(payload);
    const id = this.requestId++;
    const bytes = new Writer()
      .uint32(this.channelId)
      .uint32(this.tokenId)
      .uint32(this.sequence++)
      .uint32(id)
      .raw(request.finish())
      .finish();
    return { id, bytes };
  }

  private async call(type: number, response: number, payload: Uint8Array): Promise<Reader> {
    if (this.failure) throw this.failure;
    const { id, bytes } = this.symmetric(type, payload);
    const reader = await this.await(id, () => this.send('MSG', bytes));
    this.expect(reader, response);
    this.checkHeader(reader);
    return reader;
  }

  private await(id: number, send: () => void): Promise<Reader> {
    return new Promise<Reader>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OpcUaError('The OPC UA server did not respond in time'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, chunks: [], timer });
      try {
        send();
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  /** The response's type, or the service fault's status when the server refused. */
  private expect(reader: Reader, response: number) {
    const type = readNodeId(reader);
    if ('numeric' in type && type.numeric === response) return;
    if ('numeric' in type && type.numeric === Encoding.ServiceFault) {
      const header = readResponseHeader(reader);
      throw new OpcUaError('The server refused the request', header.serviceResult);
    }
    throw new OpcUaError('The server replied with an unexpected message');
  }

  private checkHeader(reader: Reader) {
    const header = readResponseHeader(reader);
    if (isBad(header.serviceResult))
      throw new OpcUaError('The server refused the request', header.serviceResult);
  }

  private receive(chunk: Uint8Array) {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    try {
      while (this.buffer.length >= 8) {
        const header = new Reader(this.buffer.subarray(0, 8));
        const type = new TextDecoder().decode(header.take(3));
        const chunkType = String.fromCharCode(header.byte());
        const size = header.uint32();
        if (size < 8 || size > maxMessage) throw new OpcUaError('Malformed OPC UA message size');
        if (this.buffer.length < size) break;
        const body = this.buffer.slice(8, size);
        this.buffer = this.buffer.slice(size);
        this.message(type, chunkType, new Reader(body));
      }
    } catch (error) {
      this.fail(error as Error);
      this.socket?.end();
    }
  }

  private message(type: string, chunkType: string, reader: Reader) {
    if (type === 'ACK') {
      reader.uint32();
      this.hello?.resolve();
      return;
    }
    if (type === 'ERR') {
      const status = reader.uint32();
      const reason = reader.string();
      const error = new OpcUaError(
        `The OPC UA server reported an error${reason ? `: ${reason}` : ''}`,
        status,
      );
      this.hello?.reject(error);
      return this.fail(error);
    }
    if (type !== 'OPN' && type !== 'MSG') throw new OpcUaError(`Unexpected OPC UA message ${type}`);
    reader.uint32();
    if (type === 'OPN') {
      if (reader.string() !== securityPolicyNone)
        throw new OpcUaError(
          'The server replied with a security policy this client did not ask for',
        );
      reader.byteString();
      reader.byteString();
    } else reader.uint32();
    reader.uint32();
    const id = reader.uint32();
    const pending = this.pending.get(id);
    if (!pending) return;
    if (chunkType === 'A') {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      const status = reader.uint32();
      return pending.reject(new OpcUaError('The server aborted the response', status));
    }
    pending.chunks.push(reader.rest());
    if (pending.chunks.length > maxChunks) throw new OpcUaError('The response has too many chunks');
    if (chunkType === 'C') return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const total = pending.chunks.reduce((sum, part) => sum + part.length, 0);
    const whole = new Uint8Array(total);
    let offset = 0;
    for (const part of pending.chunks) {
      whole.set(part, offset);
      offset += part.length;
    }
    pending.resolve(new Reader(whole));
  }

  private fail(error: Error) {
    this.failure ??= error;
    clearTimeout(this.renewal);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.hello?.reject(error);
    this.authenticationToken = undefined;
  }
}
