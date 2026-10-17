/**
 * Protocol Buffers wire format: just enough to read and write Sparkplug B payloads without a
 * schema compiler. Varints are read as BigInt so 64-bit values keep every bit.
 */
export interface Field {
  readonly number: number;
  readonly wire: 0 | 1 | 2 | 5;
  /** Varint as bigint, fixed64 and fixed32 as raw bytes, length-delimited as bytes. */
  readonly value: bigint | Uint8Array;
}

export function readFields(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  let offset = 0;
  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (offset >= bytes.length) throw new Error('Truncated protobuf varint');
      const byte = bytes[offset++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
      if (shift > 63n) throw new Error('Protobuf varint too long');
    }
  };
  const take = (length: number) => {
    if (offset + length > bytes.length) throw new Error('Truncated protobuf field');
    const slice = bytes.subarray(offset, offset + length);
    offset += length;
    return slice;
  };
  while (offset < bytes.length) {
    const key = varint();
    const number = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) fields.push({ number, wire, value: varint() });
    else if (wire === 1) fields.push({ number, wire, value: take(8) });
    else if (wire === 2) fields.push({ number, wire, value: take(Number(varint())) });
    else if (wire === 5) fields.push({ number, wire, value: take(4) });
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
  return fields;
}

export class FieldWriter {
  private readonly bytes: number[] = [];
  private varint(value: bigint) {
    let rest = BigInt.asUintN(64, value);
    do {
      let byte = Number(rest & 0x7fn);
      rest >>= 7n;
      if (rest) byte |= 0x80;
      this.bytes.push(byte);
    } while (rest);
  }
  private key(number: number, wire: number) {
    this.varint(BigInt((number << 3) | wire));
  }
  uint(number: number, value: number | bigint) {
    this.key(number, 0);
    this.varint(BigInt(value));
    return this;
  }
  bool(number: number, value: boolean) {
    return this.uint(number, value ? 1 : 0);
  }
  bytesField(number: number, value: Uint8Array) {
    this.key(number, 2);
    this.varint(BigInt(value.length));
    this.bytes.push(...value);
    return this;
  }
  string(number: number, value: string) {
    return this.bytesField(number, new TextEncoder().encode(value));
  }
  float(number: number, value: number) {
    this.key(number, 5);
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    this.bytes.push(...new Uint8Array(view.buffer));
    return this;
  }
  double(number: number, value: number) {
    this.key(number, 1);
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    this.bytes.push(...new Uint8Array(view.buffer));
    return this;
  }
  finish() {
    return Uint8Array.from(this.bytes);
  }
}

export const asView = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
