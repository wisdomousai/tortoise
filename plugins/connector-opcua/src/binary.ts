/**
 * OPC UA binary encoding (Part 6, section 5.2) of the built-in types a reading client needs.
 * Little-endian throughout. A reader that meets a type it cannot represent still skips it
 * exactly, so one unusual value never misaligns the rest of a response.
 */
export class Writer {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this;
  }
  private fixed(size: number, write: (view: DataView) => void) {
    const bytes = new Uint8Array(size);
    write(new DataView(bytes.buffer));
    return this.push(bytes);
  }
  byte = (value: number) => this.fixed(1, (v) => v.setUint8(0, value));
  boolean = (value: boolean) => this.byte(value ? 1 : 0);
  uint16 = (value: number) => this.fixed(2, (v) => v.setUint16(0, value, true));
  int32 = (value: number) => this.fixed(4, (v) => v.setInt32(0, value, true));
  uint32 = (value: number) => this.fixed(4, (v) => v.setUint32(0, value >>> 0, true));
  int64 = (value: bigint) => this.fixed(8, (v) => v.setBigInt64(0, value, true));
  double = (value: number) => this.fixed(8, (v) => v.setFloat64(0, value, true));
  raw = (bytes: Uint8Array) => this.push(bytes);
  string(value: string | undefined) {
    if (value === undefined) return this.int32(-1);
    const bytes = new TextEncoder().encode(value);
    return this.int32(bytes.length).push(bytes);
  }
  byteString(value: Uint8Array | undefined) {
    if (value === undefined) return this.int32(-1);
    return this.int32(value.length).push(value);
  }
  /** OPC UA DateTime: 100 ns ticks since 1601-01-01 UTC; 0 for none. */
  dateTime(ms: number | undefined) {
    return this.int64(ms === undefined ? 0n : BigInt(Math.round(ms)) * 10_000n + epochOffset);
  }
  get size() {
    return this.length;
  }
  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Ticks between 1601-01-01 and 1970-01-01. */
const epochOffset = 116_444_736_000_000_000n;

export class Reader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(size: number) {
    if (this.offset + size > this.bytes.length) throw new Error('Truncated OPC UA message');
    const at = this.offset;
    this.offset += size;
    return at;
  }
  byte = () => this.view.getUint8(this.need(1));
  sbyte = () => this.view.getInt8(this.need(1));
  boolean = () => this.byte() !== 0;
  int16 = () => this.view.getInt16(this.need(2), true);
  uint16 = () => this.view.getUint16(this.need(2), true);
  int32 = () => this.view.getInt32(this.need(4), true);
  uint32 = () => this.view.getUint32(this.need(4), true);
  int64 = () => this.view.getBigInt64(this.need(8), true);
  uint64 = () => this.view.getBigUint64(this.need(8), true);
  float = () => this.view.getFloat32(this.need(4), true);
  double = () => this.view.getFloat64(this.need(8), true);
  take(size: number) {
    const at = this.need(size);
    return this.bytes.subarray(at, at + size);
  }
  byteString(): Uint8Array | undefined {
    const length = this.int32();
    if (length < 0) return undefined;
    return this.take(length);
  }
  string(): string | undefined {
    const bytes = this.byteString();
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }
  /** Milliseconds since 1970, or undefined for the null and maximum dates. */
  dateTime(): number | undefined {
    const ticks = this.int64();
    if (ticks <= 0n || ticks === 0x7fffffffffffffffn) return undefined;
    return Number((ticks - epochOffset) / 10_000n);
  }
  /** An array of `item`, or [] for a null array. */
  array<T>(item: () => T): T[] {
    const count = this.int32();
    const items: T[] = [];
    for (let index = 0; index < count; index++) items.push(item());
    return items;
  }
  get remaining() {
    return this.bytes.length - this.offset;
  }
  rest() {
    return this.take(this.remaining);
  }
}
