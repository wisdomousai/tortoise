/**
 * Nameplate photos that carry their own text, for demos and tests. `nameplatePhoto` draws a small
 * grey stand-in PNG whose `tEXt` chunk (keyword `nameplate`) carries the lines a camera would see,
 * such as `manufacturer: ABB`. A trailing ` ?` marks a line that is hard to read. The fake
 * extractor reads that text instead of the pixels, so the pipeline runs without a model and gives
 * the same answer every time. `withNameplateText` adds the same text to a real JPEG photo as a
 * comment segment, which is how the sample photos in `fixtures/nameplates` carry theirs.
 *
 * Pure JavaScript (stored deflate blocks, own CRC), so it runs in Bun and on a device alike.
 */
const WIDTH = 96;
const HEIGHT = 56;
const KEYWORD = 'nameplate';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];

function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** zlib stream of stored (uncompressed) blocks. */
function stored(raw: Uint8Array) {
  const out: number[] = [0x78, 0x01];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const block = raw.subarray(at, at + 65535);
    const last = at + 65535 >= raw.length ? 1 : 0;
    out.push(
      last,
      block.length & 255,
      block.length >>> 8,
      ~block.length & 255,
      (~block.length >>> 8) & 255,
      ...block,
    );
    if (last) break;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return new Uint8Array([...out, ...u32(((b << 16) | a) >>> 0)]);
}

/** A PNG of a plate (dark border, light face, a row of marks per line) carrying `lines` as text. */
export function nameplatePhoto(lines: Readonly<Record<string, string>>): Uint8Array {
  const text = Object.entries(lines)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
  const rows = Object.keys(lines).length;
  const raw = new Uint8Array(HEIGHT * (WIDTH + 1));
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (WIDTH + 1)] = 0; // filter: none
    for (let x = 0; x < WIDTH; x++) {
      const border = x < 3 || y < 3 || x >= WIDTH - 3 || y >= HEIGHT - 3;
      const line = Math.floor((y - 8) / 7);
      const mark =
        line >= 0 && line < rows && (y - 8) % 7 < 3 && x > 10 && x < 10 + ((line * 17) % 50) + 30;
      raw[y * (WIDTH + 1) + 1 + x] = border ? 60 : mark ? 90 : 205;
    }
  }
  const header = new Uint8Array([...u32(WIDTH), ...u32(HEIGHT), 8, 0, 0, 0, 0]); // 8-bit greyscale
  const textData = new Uint8Array([
    ...new TextEncoder().encode(KEYWORD),
    0,
    ...new TextEncoder().encode(text),
  ]);
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', header),
    ...chunk('tEXt', textData),
    ...chunk('IDAT', stored(raw)),
    ...chunk('IEND', new Uint8Array()),
  ]);
}

const lineText = (lines: Readonly<Record<string, string>>) =>
  Object.entries(lines)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');

const commentPrefix = new TextEncoder().encode(`${KEYWORD}\u0000`);
const startsWith = (data: Uint8Array, prefix: Uint8Array) =>
  data.length >= prefix.length && prefix.every((byte, index) => data[index] === byte);

/** A JPEG photo with `lines` added as a comment (COM) segment; the pixels are unchanged. */
export function withNameplateText(
  jpeg: Uint8Array,
  lines: Readonly<Record<string, string>>,
): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG');
  const text = new TextEncoder().encode(lineText(lines));
  const length = 2 + commentPrefix.length + text.length;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xfe,
    length >>> 8,
    length & 255,
    ...commentPrefix,
    ...text,
    ...jpeg.subarray(2),
  ]);
}

/** The `nameplate` text of a JPEG comment segment before the image data. */
function jpegText(jpeg: Uint8Array): string | undefined {
  for (let at = 2; at + 4 <= jpeg.length && jpeg[at] === 0xff;) {
    const marker = jpeg[at + 1]!;
    if (marker === 0xda) break; // start of scan: no header segments follow
    const length = (jpeg[at + 2]! << 8) | jpeg[at + 3]!;
    const data = jpeg.subarray(at + 4, at + 2 + length);
    if (marker === 0xfe && startsWith(data, commentPrefix))
      return new TextDecoder().decode(data.subarray(commentPrefix.length));
    at += 2 + length;
  }
  return undefined;
}

/**
 * The `nameplate` text of a PNG made by `nameplatePhoto` or a JPEG made by `withNameplateText`,
 * or undefined for any other image.
 */
export function nameplateText(photo: Uint8Array): string | undefined {
  if (photo.length >= 4 && photo[0] === 0xff && photo[1] === 0xd8) return jpegText(photo);
  return pngText(photo);
}

function pngText(png: Uint8Array): string | undefined {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.length < 8 || view.getUint32(0) !== 0x89504e47) return undefined;
  for (let at = 8; at + 8 <= png.length;) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'tEXt') {
      const separator = data.indexOf(0);
      if (new TextDecoder().decode(data.subarray(0, separator)) === KEYWORD)
        return new TextDecoder().decode(data.subarray(separator + 1));
    }
    at += 12 + length;
  }
  return undefined;
}
