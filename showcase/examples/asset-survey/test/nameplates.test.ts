import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { nameplateTextExtractor, type Photo } from '../connectors/extractor';
import { nameplateText, withNameplateText } from '../connectors/nameplate-photo';
import { plateTruth, samplePhoto, samplePlates } from '../fixtures/nameplates';

const asPhoto = (data: Uint8Array): Photo => ({
  ref: {
    digest: `sha256:${createHash('sha256').update(data).digest('hex')}`,
    size: data.length,
    mediaType: 'image/jpeg',
  },
  data,
});

describe('sample nameplate photos', () => {
  test('the demo extractor reads each photo as its ground truth, doubting what is hard to read', async () => {
    for (const plate of samplePlates) {
      const photo = asPhoto(await samplePhoto(plate));
      const fields = await nameplateTextExtractor.extract(
        [photo],
        'nameplate',
        new AbortController().signal,
      );
      const expected = Object.entries(plateTruth[plate]).map(([name, value]) => ({
        name,
        value: value.replace(/ \?$/, ''),
        confidence: value.endsWith(' ?') ? 0.55 : 0.96,
        // A real photo's text has no known position.
        source: { digest: photo.ref.digest },
      }));
      expect({ plate, fields }).toEqual({ plate, fields: expected });
    }
  });

  test('the text rides in a JPEG comment and leaves the image data alone', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x03, 0x07, 0xff, 0xda, 0x01]);
    const marked = withNameplateText(jpeg, { serial: 'X-1 ?' });
    expect(nameplateText(marked)).toBe('serial: X-1 ?');
    expect([...marked.subarray(marked.length - 8)]).toEqual([...jpeg.subarray(2)]);
    expect(nameplateText(jpeg)).toBeUndefined();
    expect(() => withNameplateText(new Uint8Array([0x89, 0x50]), {})).toThrow('Not a JPEG');
  });
});
