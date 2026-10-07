import { decodeScan } from './decode';
import type { ScannerProfile } from './profile';
import { ScannerUnsupported, type ScannerSource } from './source';

/** HID usage page for point-of-sale barcode scanners (HID POS Usage Tables). */
export const HID_POS_USAGE_PAGE = 0x8c;

/**
 * Extracts scanned data from HID POS input reports. Devices differ in report layout, so the
 * profile names the byte holding the data length and the offset where data starts. The usual
 * layout is `[length, symbology identifier ×3, data…]` per report; verify against the device.
 * Data longer than one report arrives in several reports; a report shorter than the device's
 * maximum ends the scan.
 */
export class HidReportAssembler {
  private pending: number[] = [];
  constructor(
    private readonly layout: { readonly lengthByte: number; readonly dataOffset: number },
  ) {}
  push(report: Uint8Array): string | undefined {
    const length = report[this.layout.lengthByte] ?? 0;
    const end = Math.min(report.length, this.layout.dataOffset + length);
    for (let index = this.layout.dataOffset; index < end; index++)
      this.pending.push(report[index]!);
    // A full report means the device may continue in the next one.
    if (this.layout.dataOffset + length >= report.length) return undefined;
    const text = new TextDecoder().decode(new Uint8Array(this.pending));
    this.pending = [];
    return text || undefined;
  }
}

interface HidDeviceLike {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: Event) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: Event) => void): void;
}
interface HidLike {
  requestDevice(options: {
    filters: { vendorId?: number; productId?: number; usagePage?: number }[];
  }): Promise<HidDeviceLike[]>;
}

/** WebHID source for HID POS scanners. Call `start` from a user gesture; it prompts for a device. */
export function createHidPosSource(
  profile: ScannerProfile,
  hid: HidLike | undefined = (globalThis.navigator as { hid?: HidLike } | undefined)?.hid,
): ScannerSource {
  return {
    transport: 'hid-pos',
    profile,
    isSupported: () => hid !== undefined,
    async start({ onScan }) {
      if (!hid) throw new ScannerUnsupported('hid-pos', 'WebHID is not available');
      const settings = profile.hid ?? { lengthByte: 0, dataOffset: 4 };
      const [device] = await hid.requestDevice({
        filters: [
          {
            usagePage: HID_POS_USAGE_PAGE,
            ...(settings.vendorId === undefined ? {} : { vendorId: settings.vendorId }),
            ...(settings.productId === undefined ? {} : { productId: settings.productId }),
          },
        ],
      });
      if (!device) throw new ScannerUnsupported('hid-pos', 'no device selected');
      if (!device.opened) await device.open();
      const assembler = new HidReportAssembler(settings);
      const deviceId = `hid:${device.vendorId.toString(16)}:${device.productId.toString(16)}`;
      const listener = (event: Event) => {
        const report = event as Event & { reportId: number; data: DataView };
        if (settings.reportId !== undefined && report.reportId !== settings.reportId) return;
        const text = assembler.push(
          new Uint8Array(report.data.buffer, report.data.byteOffset, report.data.byteLength),
        );
        if (text) onScan(decodeScan(text, profile, { at: event.timeStamp, deviceId }));
      };
      device.addEventListener('inputreport', listener);
      return () => {
        device.removeEventListener('inputreport', listener);
        void device.close().catch(() => undefined);
      };
    },
  };
}
