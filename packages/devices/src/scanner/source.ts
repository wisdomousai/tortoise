import type { ScanEvent } from './decode';
import type { ScannerProfile, ScannerTransport } from './profile';

/**
 * A scanner input channel. Sources are registered explicitly by the application; nothing is
 * discovered. `start` resolves to a stop function and reports each completed scan once.
 * Hardware and permission prompts happen in `start`, which must be called from a user gesture
 * for Web Serial, WebHID and camera access.
 */
export interface ScannerSource {
  readonly transport: ScannerTransport;
  readonly profile: ScannerProfile;
  isSupported(): boolean;
  start(handlers: {
    readonly onScan: (event: ScanEvent) => void;
    readonly onError?: (error: Error) => void;
  }): Promise<() => void>;
}

/** Thrown when a transport is unavailable in this browser or host. */
export class ScannerUnsupported extends Error {
  constructor(transport: ScannerTransport, reason: string) {
    super(`${transport} scanner unsupported: ${reason}`);
    this.name = 'ScannerUnsupported';
  }
}
