import { z } from 'zod';
import { keyboardLayouts } from './layouts';

/**
 * How one scanner at one station reaches the application and how its output is normalized.
 * Cheap scanners are keyboard-wedge (USB HID keyboard) devices; mid-range ones add a virtual COM
 * port; expensive ones speak HID POS or have a vendor SDK; a tablet camera is the fallback.
 * Every field is plain JSON so profiles can be stored through the device configuration module.
 */
export const scannerTransports = ['wedge', 'serial', 'hid-pos', 'camera', 'host-plugin'] as const;
export type ScannerTransport = (typeof scannerTransports)[number];

const shortText = z.string().max(16);
export const scannerProfileSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1).max(100),
  transport: z.enum(scannerTransports),
  /** Characters the scanner adds before and after the data; removed before decoding. */
  prefix: shortText.optional(),
  suffix: shortText.optional(),
  /** Key or line ending that completes a scan. `none` relies on the gap timeout. */
  terminator: z.enum(['Enter', 'Tab', 'none']),
  /** Longest gap between keys inside one wedge burst. People type far slower. */
  maxGapMs: z.number().int().min(5).max(500),
  minLength: z.number().int().min(1).max(64),
  /** The scanner prefixes AIM symbology identifiers such as `]C1`. */
  aimIds: z.boolean(),
  /** Character the scanner sends in place of ASCII 29 (GS1 group separator), if configured. */
  groupSeparator: z.string().min(1).max(4).optional(),
  /** Layout the scanner is configured for; wedge decoding maps key codes through it. */
  scannerLayout: z.enum(keyboardLayouts),
  /** Serial line settings (Web Serial / USB CDC). */
  serial: z
    .strictObject({
      baudRate: z.number().int().min(1200).max(921_600),
      usbVendorId: z.number().int().min(0).max(0xffff).optional(),
      usbProductId: z.number().int().min(0).max(0xffff).optional(),
    })
    .optional(),
  /** HID POS device filter and report layout; verify against the device's manual. */
  hid: z
    .strictObject({
      vendorId: z.number().int().min(0).max(0xffff).optional(),
      productId: z.number().int().min(0).max(0xffff).optional(),
      reportId: z.number().int().min(0).max(255).optional(),
      lengthByte: z.number().int().min(0).max(63),
      dataOffset: z.number().int().min(0).max(63),
    })
    .optional(),
  /** Ignore an identical camera read within this window. */
  repeatSuppressMs: z.number().int().min(0).max(10_000).optional(),
});
export type ScannerProfile = z.infer<typeof scannerProfileSchema>;

/** Conservative defaults for an unconfigured keyboard-wedge scanner. */
export function defaultWedgeProfile(
  id = 'wedge',
  label = 'Keyboard-wedge scanner',
): ScannerProfile {
  return {
    id,
    label,
    transport: 'wedge',
    terminator: 'Enter',
    maxGapMs: 35,
    minLength: 3,
    aimIds: false,
    scannerLayout: 'us',
  };
}
