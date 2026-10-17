import { Reader, Writer } from './binary';

/** A node identifier: numeric (`i=`), string (`s=`), GUID (`g=`) or opaque (`b=`). */
export type NodeId =
  | { readonly namespace: number; readonly numeric: number }
  | { readonly namespace: number; readonly string: string }
  | { readonly namespace: number; readonly guid: string }
  | { readonly namespace: number; readonly opaque: Uint8Array };

/** Parse the standard text form: `ns=2;s=Press.Temp`, `i=2258`, `ns=3;g=…`, `ns=1;b=…`. */
export function parseNodeId(text: string): NodeId {
  const match = /^(?:ns=(\d+);)?([isgb])=(.+)$/s.exec(text);
  if (!match) throw new Error(`Not an OPC UA node ID: ${text}`);
  const namespace = Number(match[1] ?? 0);
  if (namespace > 0xffff) throw new Error(`Namespace index out of range: ${text}`);
  const [, , kind, value] = match as unknown as [string, string, string, string];
  if (kind === 'i') {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0xffffffff)
      throw new Error(`Numeric node ID out of range: ${text}`);
    return { namespace, numeric };
  }
  if (kind === 's') return { namespace, string: value };
  if (kind === 'g') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      throw new Error(`Not a GUID node ID: ${text}`);
    return { namespace, guid: value.toLowerCase() };
  }
  return { namespace, opaque: Uint8Array.from(Buffer.from(value, 'base64')) };
}

export function formatNodeId(node: NodeId): string {
  const ns = node.namespace ? `ns=${node.namespace};` : '';
  if ('numeric' in node) return `${ns}i=${node.numeric}`;
  if ('string' in node) return `${ns}s=${node.string}`;
  if ('guid' in node) return `${ns}g=${node.guid}`;
  return `${ns}b=${Buffer.from(node.opaque).toString('base64')}`;
}

export const numeric = (numeric: number, namespace = 0): NodeId => ({ namespace, numeric });

function guidBytes(guid: string) {
  const hex = guid.replace(/-/g, '');
  const bytes = Buffer.from(hex, 'hex');
  // Data1–Data3 are little-endian; Data4 is a byte array.
  const out = Buffer.alloc(16);
  out.writeUInt32LE(bytes.readUInt32BE(0), 0);
  out.writeUInt16LE(bytes.readUInt16BE(4), 4);
  out.writeUInt16LE(bytes.readUInt16BE(6), 6);
  bytes.copy(out, 8, 8);
  return out;
}
function guidText(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(b.readUInt32LE(0), 0);
  head.writeUInt16BE(b.readUInt16LE(4), 4);
  head.writeUInt16BE(b.readUInt16LE(6), 6);
  const hex = Buffer.concat([head, b.subarray(8)]).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function writeNodeId(writer: Writer, node: NodeId) {
  if ('numeric' in node) {
    if (node.namespace === 0 && node.numeric <= 0xff) return writer.byte(0).byte(node.numeric);
    if (node.namespace <= 0xff && node.numeric <= 0xffff)
      return writer.byte(1).byte(node.namespace).uint16(node.numeric);
    return writer.byte(2).uint16(node.namespace).uint32(node.numeric);
  }
  if ('string' in node) return writer.byte(3).uint16(node.namespace).string(node.string);
  if ('guid' in node) return writer.byte(4).uint16(node.namespace).raw(guidBytes(node.guid));
  return writer.byte(5).uint16(node.namespace).byteString(node.opaque);
}

/** A node ID, or an expanded one with its namespace URI and server index dropped. */
export function readNodeId(reader: Reader): NodeId {
  const encoding = reader.byte();
  let node: NodeId;
  switch (encoding & 0x0f) {
    case 0:
      node = { namespace: 0, numeric: reader.byte() };
      break;
    case 1:
      node = { namespace: reader.byte(), numeric: reader.uint16() };
      break;
    case 2:
      node = { namespace: reader.uint16(), numeric: reader.uint32() };
      break;
    case 3:
      node = { namespace: reader.uint16(), string: reader.string() ?? '' };
      break;
    case 4:
      node = { namespace: reader.uint16(), guid: guidText(reader.take(16)) };
      break;
    case 5:
      node = { namespace: reader.uint16(), opaque: reader.byteString() ?? new Uint8Array() };
      break;
    default:
      throw new Error(`Unknown node ID encoding ${encoding}`);
  }
  if (encoding & 0x80) reader.string();
  if (encoding & 0x40) reader.uint32();
  return node;
}

export const sameNode = (a: NodeId, b: NodeId) => formatNodeId(a) === formatNodeId(b);

/** Skip a DiagnosticInfo; the client reports status codes, not server diagnostics. */
export function skipDiagnosticInfo(reader: Reader): void {
  const mask = reader.byte();
  if (mask & 0x01) reader.int32();
  if (mask & 0x02) reader.int32();
  if (mask & 0x04) reader.int32();
  if (mask & 0x08) reader.int32();
  if (mask & 0x10) reader.string();
  if (mask & 0x20) reader.uint32();
  if (mask & 0x40) skipDiagnosticInfo(reader);
}

/** Read an ExtensionObject's type and binary body; the body is left to the caller to decode. */
export function readExtensionObject(reader: Reader): { type: NodeId; body?: Uint8Array } {
  const type = readNodeId(reader);
  const encoding = reader.byte();
  if (encoding === 0) return { type };
  const body = reader.byteString();
  return body ? { type, body } : { type };
}

export function writeExtensionObject(writer: Writer, type: NodeId | undefined, body?: Uint8Array) {
  writeNodeId(writer, type ?? numeric(0));
  if (!body) return writer.byte(0);
  return writer.byte(1).byteString(body);
}

export type Scalar = string | number | boolean | null;

/** A Variant's value as a scalar, or `unsupported` for arrays and structured types. */
export type VariantValue = { readonly value: Scalar } | { readonly unsupported: string };

const unsupported = (name: string): VariantValue => ({ unsupported: name });
const exact = (value: bigint): Scalar =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value.toString();

/** Read one value of built-in `type`; structured values are skipped and reported unsupported. */
function readBuiltIn(reader: Reader, type: number): VariantValue {
  switch (type) {
    case 0:
      return { value: null };
    case 1:
      return { value: reader.boolean() };
    case 2:
      return { value: reader.sbyte() };
    case 3:
      return { value: reader.byte() };
    case 4:
      return { value: reader.int16() };
    case 5:
      return { value: reader.uint16() };
    case 6:
      return { value: reader.int32() };
    case 7:
      return { value: reader.uint32() };
    case 8:
      return { value: exact(reader.int64()) };
    case 9:
      return { value: exact(reader.uint64()) };
    case 10:
      return { value: reader.float() };
    case 11:
      return { value: reader.double() };
    case 12:
      return { value: reader.string() ?? null };
    case 13:
      return { value: reader.dateTime() ?? null };
    case 14:
      return { value: guidText(reader.take(16)) };
    case 15:
      reader.byteString();
      return unsupported('ByteString');
    case 16:
      reader.string();
      return unsupported('XmlElement');
    case 17:
    case 18:
      return { value: formatNodeId(readNodeId(reader)) };
    case 19:
      return { value: reader.uint32() };
    case 20: {
      reader.uint16();
      return { value: reader.string() ?? null };
    }
    case 21: {
      const mask = reader.byte();
      if (mask & 0x01) reader.string();
      return { value: mask & 0x02 ? (reader.string() ?? null) : null };
    }
    case 22:
      readExtensionObject(reader);
      return unsupported('ExtensionObject');
    case 23:
      readDataValue(reader);
      return unsupported('DataValue');
    case 24:
      readVariant(reader);
      return unsupported('Variant');
    case 25:
      skipDiagnosticInfo(reader);
      return unsupported('DiagnosticInfo');
    default:
      throw new Error(`Unknown OPC UA built-in type ${type}`);
  }
}

export function readVariant(reader: Reader): VariantValue {
  const mask = reader.byte();
  const type = mask & 0x3f;
  if (!(mask & 0x80)) return readBuiltIn(reader, type);
  const count = reader.int32();
  for (let index = 0; index < count; index++) readBuiltIn(reader, type);
  if (mask & 0x40) reader.array(() => reader.int32());
  return unsupported('array');
}

export function writeVariant(
  writer: Writer,
  value: Scalar | { double: number } | { int32: number },
) {
  if (value === null) return writer.byte(0);
  if (typeof value === 'boolean') return writer.byte(1).boolean(value);
  if (typeof value === 'string') return writer.byte(12).string(value);
  if (typeof value === 'number') return writer.byte(11).double(value);
  if ('double' in value) return writer.byte(11).double(value.double);
  return writer.byte(6).int32(value.int32);
}

export interface DataValue {
  readonly value?: VariantValue;
  /** 0 is Good; the top two bits say Bad (`0x80000000`) or Uncertain (`0x40000000`). */
  readonly status: number;
  readonly sourceTimestamp?: number;
  readonly serverTimestamp?: number;
}

export function readDataValue(reader: Reader): DataValue {
  const mask = reader.byte();
  const value = mask & 0x01 ? readVariant(reader) : undefined;
  const status = mask & 0x02 ? reader.uint32() : 0;
  const sourceTimestamp = mask & 0x04 ? reader.dateTime() : undefined;
  if (mask & 0x10) reader.uint16();
  const serverTimestamp = mask & 0x08 ? reader.dateTime() : undefined;
  if (mask & 0x20) reader.uint16();
  return {
    ...(value ? { value } : {}),
    status,
    ...(sourceTimestamp !== undefined ? { sourceTimestamp } : {}),
    ...(serverTimestamp !== undefined ? { serverTimestamp } : {}),
  };
}

export function writeDataValue(
  writer: Writer,
  data: { value?: Parameters<typeof writeVariant>[1]; status?: number; sourceTimestamp?: number },
) {
  const mask =
    (data.value !== undefined ? 0x01 : 0) |
    (data.status ? 0x02 : 0) |
    (data.sourceTimestamp !== undefined ? 0x04 : 0);
  writer.byte(mask);
  if (data.value !== undefined) writeVariant(writer, data.value);
  if (data.status) writer.uint32(data.status);
  if (data.sourceTimestamp !== undefined) writer.dateTime(data.sourceTimestamp);
  return writer;
}

/** Status code classes. */
export const isBad = (status: number) => (status & 0x80000000) !== 0;
export const isUncertain = (status: number) => (status & 0xc0000000) === 0x40000000;

/** Binary encoding IDs of the service types this client sends and reads (namespace 0). */
export const Encoding = {
  ServiceFault: 397,
  OpenSecureChannelRequest: 446,
  OpenSecureChannelResponse: 449,
  CloseSecureChannelRequest: 452,
  CreateSessionRequest: 461,
  CreateSessionResponse: 464,
  ActivateSessionRequest: 467,
  ActivateSessionResponse: 470,
  CloseSessionRequest: 473,
  CloseSessionResponse: 476,
  ReadRequest: 631,
  ReadResponse: 634,
  AnonymousIdentityToken: 321,
} as const;

export const securityPolicyNone = 'http://opcfoundation.org/UA/SecurityPolicy#None';

export interface RequestHeaderFields {
  readonly authenticationToken?: NodeId;
  readonly requestHandle: number;
  readonly timeoutHint?: number;
}

export function writeRequestHeader(writer: Writer, header: RequestHeaderFields) {
  writeNodeId(writer, header.authenticationToken ?? numeric(0));
  writer.dateTime(Date.now());
  writer.uint32(header.requestHandle);
  writer.uint32(0);
  writer.string(undefined);
  writer.uint32(header.timeoutHint ?? 10_000);
  writeExtensionObject(writer, undefined);
}

export interface ResponseHeader {
  readonly requestHandle: number;
  readonly serviceResult: number;
}

export function readResponseHeader(reader: Reader): ResponseHeader {
  reader.dateTime();
  const requestHandle = reader.uint32();
  const serviceResult = reader.uint32();
  skipDiagnosticInfo(reader);
  reader.array(() => reader.string());
  readExtensionObject(reader);
  return { requestHandle, serviceResult };
}

/** Write a response header, for test servers. */
export function writeResponseHeader(writer: Writer, requestHandle: number, serviceResult = 0) {
  writer.dateTime(Date.now()).uint32(requestHandle).uint32(serviceResult);
  writer.byte(0);
  writer.int32(-1);
  writeExtensionObject(writer, undefined);
}

export function writeApplicationDescription(
  writer: Writer,
  description: { uri: string; name: string; type: number },
) {
  writer.string(description.uri);
  writer.string(undefined);
  writer.byte(0x02).string(description.name);
  writer.int32(description.type);
  writer.string(undefined);
  writer.string(undefined);
  writer.int32(-1);
}

export function skipApplicationDescription(reader: Reader) {
  reader.string();
  reader.string();
  readBuiltIn(reader, 21);
  reader.int32();
  reader.string();
  reader.string();
  reader.array(() => reader.string());
}

export interface UserTokenPolicy {
  readonly policyId?: string;
  /** 0 Anonymous, 1 UserName, 2 Certificate, 3 IssuedToken. */
  readonly tokenType: number;
}
export interface EndpointDescription {
  readonly endpointUrl?: string;
  readonly securityMode: number;
  readonly securityPolicyUri?: string;
  readonly userIdentityTokens: readonly UserTokenPolicy[];
}

export function readEndpointDescription(reader: Reader): EndpointDescription {
  const endpointUrl = reader.string();
  skipApplicationDescription(reader);
  reader.byteString();
  const securityMode = reader.int32();
  const securityPolicyUri = reader.string();
  const userIdentityTokens = reader.array(() => {
    const policyId = reader.string();
    const tokenType = reader.int32();
    reader.string();
    reader.string();
    reader.string();
    return { ...(policyId !== undefined ? { policyId } : {}), tokenType };
  });
  reader.string();
  reader.byte();
  return {
    ...(endpointUrl !== undefined ? { endpointUrl } : {}),
    securityMode,
    ...(securityPolicyUri !== undefined ? { securityPolicyUri } : {}),
    userIdentityTokens,
  };
}

export function writeEndpointDescription(writer: Writer, endpoint: EndpointDescription) {
  writer.string(endpoint.endpointUrl);
  writeApplicationDescription(writer, { uri: 'urn:test:server', name: 'Test server', type: 0 });
  writer.byteString(undefined);
  writer.int32(endpoint.securityMode);
  writer.string(endpoint.securityPolicyUri);
  writer.int32(endpoint.userIdentityTokens.length);
  for (const token of endpoint.userIdentityTokens) {
    writer.string(token.policyId).int32(token.tokenType);
    writer.string(undefined).string(undefined).string(undefined);
  }
  writer.string('http://opcfoundation.org/UA-Profile/Transport/uatcp-uasc-uabinary');
  writer.byte(0);
}
