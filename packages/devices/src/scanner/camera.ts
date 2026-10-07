import { decodeScan } from './decode';
import type { ScannerProfile } from './profile';
import { ScannerUnsupported, type ScannerSource } from './source';
import { symbologyFromFormat } from './symbology';

/** One barcode found in a frame, in the W3C BarcodeDetector shape. */
export interface DetectedBarcode {
  readonly rawValue: string;
  readonly format: string;
}
/** Decode barcodes in a video frame. Defaults to the platform BarcodeDetector where it exists. */
export type FrameDecoder = (frame: HTMLVideoElement) => Promise<readonly DetectedBarcode[]>;

/** Suppresses the same code while it stays in view; a camera sees it on every frame. */
export class RepeatFilter {
  private last = new Map<string, number>();
  constructor(private readonly windowMs: number) {}
  accept(code: string, at: number): boolean {
    const previous = this.last.get(code);
    this.last.set(code, at);
    for (const [key, seen] of this.last) if (at - seen > this.windowMs) this.last.delete(key);
    return previous === undefined || at - previous > this.windowMs;
  }
}

function platformDecoder(): FrameDecoder | undefined {
  const Detector = (
    globalThis as {
      BarcodeDetector?: new () => { detect(source: unknown): Promise<DetectedBarcode[]> };
    }
  ).BarcodeDetector;
  if (!Detector) return undefined;
  const detector = new Detector();
  return (frame) => detector.detect(frame);
}

/**
 * Camera source for tablets and phones without a hardware scanner. It renders into the supplied
 * video element so the station can show a viewfinder. Supply `decoder` where the platform has no
 * BarcodeDetector (for example a WebAssembly decoder); none is bundled.
 */
export function createCameraSource(
  profile: ScannerProfile,
  options: {
    readonly video?: HTMLVideoElement;
    readonly decoder?: FrameDecoder;
    readonly intervalMs?: number;
  } = {},
): ScannerSource {
  const decoder = options.decoder ?? platformDecoder();
  return {
    transport: 'camera',
    profile,
    isSupported: () =>
      decoder !== undefined &&
      options.video !== undefined &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia !== undefined,
    async start({ onScan, onError }) {
      const video = options.video;
      if (!decoder || !video)
        throw new ScannerUnsupported('camera', 'no barcode decoder or video element');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const filter = new RepeatFilter(profile.repeatSuppressMs ?? 1500);
      let busy = false;
      const timer = setInterval(() => {
        if (busy || video.readyState < 2) return;
        busy = true;
        decoder(video)
          .then((codes) => {
            const at = performance.now();
            for (const code of codes)
              if (filter.accept(code.rawValue, at))
                onScan(
                  decodeScan(code.rawValue, profile, {
                    at,
                    symbology: symbologyFromFormat(code.format),
                  }),
                );
          })
          .catch((error) => onError?.(error instanceof Error ? error : new Error(String(error))))
          .finally(() => {
            busy = false;
          });
      }, options.intervalMs ?? 150);
      return () => {
        clearInterval(timer);
        for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
      };
    },
  };
}
