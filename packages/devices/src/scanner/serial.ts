import { decodeScan } from './decode';
import type { ScannerProfile } from './profile';
import { ScannerUnsupported, type ScannerSource } from './source';

/**
 * Splits a serial byte stream into scans. Scanners in USB-COM (CDC-ACM) or RS-232 mode end each
 * read with CR, LF or CR LF; chunks may split anywhere, including inside that pair or inside a
 * multi-byte UTF-8 character.
 */
export class LineAssembler {
  private readonly decoder = new TextDecoder();
  private pending = '';
  // The previous chunk ended a line with CR; an LF opening this chunk completes that terminator.
  private afterCr = false;
  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    if (this.afterCr && this.pending.length) {
      if (this.pending[0] === '\n') this.pending = this.pending.slice(1);
      this.afterCr = false;
    }
    const lines: string[] = [];
    for (;;) {
      const index = this.pending.search(/[\r\n]/);
      if (index < 0) break;
      const line = this.pending.slice(0, index);
      // A scan ends at its first terminator, so CR-only scanners emit immediately.
      if (this.pending[index] === '\r' && index === this.pending.length - 1) this.afterCr = true;
      const skip = this.pending[index] === '\r' && this.pending[index + 1] === '\n' ? 2 : 1;
      this.pending = this.pending.slice(index + skip);
      if (line) lines.push(line);
    }
    return lines;
  }
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike {
  requestPort(options?: {
    filters?: { usbVendorId?: number; usbProductId?: number }[];
  }): Promise<SerialPortLike>;
}

/**
 * Web Serial source (Chromium, Electron with a serial permission handler). `start` prompts for a
 * port, so call it from a user gesture. The read loop ends when the stop function runs.
 */
export function createSerialSource(
  profile: ScannerProfile,
  serial: SerialLike | undefined = (globalThis.navigator as { serial?: SerialLike } | undefined)
    ?.serial,
): ScannerSource {
  return {
    transport: 'serial',
    profile,
    isSupported: () => serial !== undefined,
    async start({ onScan, onError }) {
      if (!serial) throw new ScannerUnsupported('serial', 'Web Serial is not available');
      const settings = profile.serial ?? { baudRate: 9600 };
      const filter = {
        ...(settings.usbVendorId === undefined ? {} : { usbVendorId: settings.usbVendorId }),
        ...(settings.usbProductId === undefined ? {} : { usbProductId: settings.usbProductId }),
      };
      const port = await serial.requestPort(
        Object.keys(filter).length ? { filters: [filter] } : {},
      );
      await port.open({ baudRate: settings.baudRate });
      const info = port.getInfo?.();
      const deviceId =
        info?.usbVendorId === undefined
          ? undefined
          : `usb:${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}`;
      const reader = port.readable?.getReader();
      if (!reader) throw new ScannerUnsupported('serial', 'port is not readable');
      const assembler = new LineAssembler();
      let stopped = false;
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || stopped) break;
            for (const line of assembler.push(value))
              onScan(
                decodeScan(line, profile, {
                  at: performance.now(),
                  ...(deviceId ? { deviceId } : {}),
                }),
              );
          }
        } catch (error) {
          if (!stopped) onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      })();
      return () => {
        stopped = true;
        void reader
          .cancel()
          .catch(() => undefined)
          .finally(() => {
            reader.releaseLock();
            void port.close().catch(() => undefined);
          });
      };
    },
  };
}
