import { describe, expect, test } from 'bun:test';
import {
  CALIBRATION_CODE,
  GROUP_SEPARATOR,
  HidReportAssembler,
  LineAssembler,
  RepeatFilter,
  ScanDetector,
  calibrate,
  createFakeHostBridge,
  createHostPluginSource,
  createScanRouter,
  createWedgeSource,
  decodeScan,
  defaultWedgeProfile,
  gs1CheckDigitValid,
  parseAim,
  parseGs1,
  remapText,
  scannerProfileSchema,
  simulateWedge,
  type ScanEvent,
} from '../src/index';

const GS = GROUP_SEPARATOR;

describe('keyboard layouts', () => {
  test('a US-configured scanner on a QWERTZ host is repaired from text or key codes', () => {
    // US scanner types "Y-123/Z" on a Swiss host: y/z swap and punctuation moves.
    const keys = simulateWedge('Y-123/Z', 'us', 'de-ch', { terminator: '' });
    const hostText = keys.map((key) => key.key).join('');
    expect(hostText).toBe("Z'123-Y");
    expect(remapText(hostText, { scanner: 'us', host: 'de-ch' }).text).toBe('Y-123/Z');
    const detector = new ScanDetector({ scannerLayout: 'us', maxGapMs: 30 });
    for (const key of keys) detector.push(key, key.at);
    expect(detector.push('Enter', 100)).toEqual({ kind: 'scan', code: 'Y-123/Z' });
  });

  test('dead keys on the host are recovered from physical key codes', () => {
    // "^" and "`" are dead keys on German layouts; text-level repair cannot see them.
    const keys = simulateWedge('A`B~C', 'us', 'de', { terminator: '' });
    expect(keys.filter((key) => key.key === 'Dead').length).toBeGreaterThan(0);
    const detector = new ScanDetector({ scannerLayout: 'us' });
    for (const key of keys) detector.push(key, key.at);
    expect(detector.push('Enter', 100)).toEqual({ kind: 'scan', code: 'A`B~C' });
  });

  test('the original string API still distinguishes scanning from typing', () => {
    const detector = new ScanDetector({ maxGapMs: 30 });
    let t = 0;
    for (const key of '4000001') detector.push(key, (t += 8));
    expect(detector.push('Enter', (t += 8))).toEqual({ kind: 'scan', code: '4000001' });
    for (const key of '220.02') detector.push(key, (t += 180));
    expect(detector.push('Enter', (t += 150))).toEqual({ kind: 'typing' });
    expect(detector.push('Enter', (t += 5))).toBeUndefined();
  });
});

describe('GS1 and AIM', () => {
  test('check digits', () => {
    expect(gs1CheckDigitValid('09506000134352')).toBe(true);
    expect(gs1CheckDigitValid('09506000134353')).toBe(false);
    expect(gs1CheckDigitValid('106141411234567897')).toBe(true);
  });

  test('fixed and variable fields, measures and dates', () => {
    const parsed = parseGs1(`0109506000134352172512311012AB${GS}3103001250${''}21SN-9`);
    expect(parsed.valid).toBe(true);
    expect(parsed.values).toEqual({
      '01': '09506000134352',
      '17': '251231',
      '10': '12AB',
      '3103': '001250',
      '21': 'SN-9',
    });
    expect(parsed.elements.find((item) => item.ai === '3103')).toMatchObject({
      decimals: 3,
      numeric: 1.25,
      title: 'NET WEIGHT (kg)',
    });
  });

  test('human-readable form and failures', () => {
    expect(parseGs1('(00)106141411234567897(37)24').values).toEqual({
      '00': '106141411234567897',
      '37': '24',
    });
    expect(parseGs1('0109506000134353').valid).toBe(false);
    expect(parseGs1('011234').error).toContain('needs 14');
    expect(parseGs1('2712').error).toContain('Unknown application identifier');
  });

  test('AIM identifiers', () => {
    expect(parseAim(']C1010950600013435210ABC')).toMatchObject({
      aim: { id: ']C1', symbology: 'gs1-128', gs1: true },
      data: '010950600013435210ABC',
    });
    expect(parseAim(']Q1hello').aim?.gs1).toBe(false);
    expect(parseAim('WO1234567').aim).toBeUndefined();
  });

  test('decodeScan strips framing, restores substituted separators and parses GS1', () => {
    const profile = {
      ...defaultWedgeProfile(),
      prefix: '<',
      suffix: '>',
      aimIds: true,
      groupSeparator: '~',
    };
    const event = decodeScan('<]C1010950600013435210LOT7~21S1>', profile, { at: 5 });
    expect(event.data).toBe(`010950600013435210LOT7${GS}21S1`);
    expect(event.symbology).toBe('gs1-128');
    expect(event.gs1?.values).toEqual({ '01': '09506000134352', '10': 'LOT7', '21': 'S1' });
    // Without an AIM identifier, plain digits are not mistaken for GS1.
    const plain = decodeScan('4000001', defaultWedgeProfile(), { at: 1 });
    expect(plain.gs1).toBeUndefined();
  });
});

describe('calibration', () => {
  test('a well-configured scanner round-trips', () => {
    const result = calibrate(simulateWedge(`]C0${CALIBRATION_CODE}`, 'us', 'us'));
    expect(result.ok).toBe(true);
    expect(result.suggested).toMatchObject({
      terminator: 'Enter',
      aimIds: true,
      scannerLayout: 'us',
    });
    expect(result.suggested.groupSeparator).toBeUndefined();
  });

  test('a US scanner on a Swiss host is identified by key codes and needs no changes', () => {
    const result = calibrate(simulateWedge(CALIBRATION_CODE, 'us', 'de-ch'));
    expect(result.suggested.scannerLayout).toBe('us');
    expect(result.issues.filter((issue) => issue.includes('arrives as'))).toEqual([]);
  });

  test('a lost group separator, a substitute, prefix, suffix and Tab are inferred', () => {
    const lost = calibrate(
      simulateWedge(CALIBRATION_CODE.replace(GS, ''), 'us', 'us', { terminator: 'Tab' }),
    );
    expect(lost.ok).toBe(false);
    expect(lost.suggested.terminator).toBe('Tab');
    expect(lost.issues.join(' ')).toContain('group separator');
    const substituted = calibrate(
      simulateWedge(`#${CALIBRATION_CODE.replace(GS, '|')}*`, 'us', 'us'),
    );
    expect(substituted.suggested).toMatchObject({ prefix: '#', suffix: '*', groupSeparator: '|' });
  });

  test('a profile assembled from calibration validates', () => {
    const result = calibrate(simulateWedge(CALIBRATION_CODE.replace(GS, '|'), 'us', 'de'));
    expect(() =>
      scannerProfileSchema.parse({ ...defaultWedgeProfile('line-1'), ...result.suggested }),
    ).not.toThrow();
  });
});

describe('sources and routing', () => {
  const event = (data: string, gs1 = false): ScanEvent =>
    decodeScan(gs1 ? `]C1${data}` : data, { ...defaultWedgeProfile(), aimIds: gs1 }, { at: 0 });

  test('routes match GS1 AIs and patterns in order', () => {
    const router = createScanRouter([
      { intent: 'pallet', gs1Ai: '00' },
      { intent: 'order', pattern: '^WO(\\d{7})$' },
      { intent: 'material', gs1Ai: '01' },
    ]);
    expect(router.route(event('WO1234567'))).toMatchObject({ intent: 'order', value: '1234567' });
    expect(router.route(event('00106141411234567897', true))).toMatchObject({
      intent: 'pallet',
      value: '106141411234567897',
    });
    expect(router.route(event('XYZ'))).toBeUndefined();
    expect(() => createScanRouter([{ intent: 'bad' }])).toThrow('needs gs1Ai or pattern');
    expect(() => createScanRouter([{ intent: 'bad', pattern: '(' }])).toThrow();
  });

  test('serial lines split across chunks, CR LF pairs and UTF-8 boundaries', () => {
    const assembler = new LineAssembler();
    const bytes = new TextEncoder().encode('WO1234567\r\nÄBC\rX');
    const lines: string[] = [];
    for (const [start, end] of [
      [0, 10],
      [10, 12],
      [12, 13],
      [13, bytes.length],
    ] as const)
      lines.push(...assembler.push(bytes.slice(start, end)));
    expect(lines).toEqual(['WO1234567', 'ÄBC']);
    expect(assembler.push(new TextEncoder().encode('\n'))).toEqual(['X']);
  });

  test('HID POS reports assemble across a full report', () => {
    const assembler = new HidReportAssembler({ lengthByte: 0, dataOffset: 4 });
    const report = (text: string, size = 8) => {
      const bytes = new Uint8Array(size);
      bytes[0] = text.length;
      bytes.set(new TextEncoder().encode(text), 4);
      return bytes;
    };
    expect(assembler.push(report('ABCD'))).toBeUndefined();
    expect(assembler.push(report('EF'))).toBe('ABCDEF');
  });

  test('camera repeats are suppressed while the code stays in view', () => {
    const filter = new RepeatFilter(1000);
    expect(filter.accept('A', 0)).toBe(true);
    expect(filter.accept('A', 500)).toBe(false);
    expect(filter.accept('B', 600)).toBe(true);
    expect(filter.accept('A', 1600)).toBe(true);
  });

  test('wedge source intercepts a burst outside fields and decodes it', async () => {
    const target = new EventTarget();
    const source = createWedgeSource({ ...defaultWedgeProfile(), scannerLayout: 'us' }, target);
    const scans: ScanEvent[] = [];
    const stop = await source.start({ onScan: (scan) => scans.push(scan) });
    let t = 0;
    for (const key of simulateWedge('WO1234567', 'us', 'de-ch')) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key: key.key,
        code: key.code,
        shiftKey: key.shift ?? false,
      });
      Object.defineProperty(event, 'timeStamp', { value: (t += 4) });
      target.dispatchEvent(event);
    }
    stop();
    expect(scans.map((scan) => scan.data)).toEqual(['WO1234567']);
  });

  test('host plugin bridge delivers decoded scans until unsubscribed', async () => {
    const fake = createFakeHostBridge();
    const scans: string[] = [];
    const stop = await createHostPluginSource(
      { ...defaultWedgeProfile('vendor'), transport: 'host-plugin' },
      fake.bridge,
    ).start({ onScan: (scan) => scans.push(scan.data) });
    fake.emit('vendor', 'A1');
    stop();
    fake.emit('vendor', 'A2');
    expect(scans).toEqual(['A1']);
  });
});

test('a pause before a burst does not turn the burst into typing', () => {
  const detector = new ScanDetector({ maxGapMs: 35 });
  // A hotkey digit, then seconds later a scan.
  expect(detector.push('3', 0)).toBeUndefined();
  [...'ORD-1'].forEach((key, index) => detector.push(key, 3000 + index * 5));
  expect(detector.push('Enter', 3030)).toEqual({ kind: 'scan', code: 'ORD-1' });
  // Slow typing ends as typing.
  [...'220'].forEach((key, index) => detector.push(key, 5000 + index * 200));
  expect(detector.push('Enter', 5600)).toEqual({ kind: 'typing' });
});
