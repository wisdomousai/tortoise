import { defineHostComponent } from '@agent-native/contracts';

/**
 * Devices the scanner kit can use, as data for the requirements manifest. Side-effect free and
 * browser-safe. Every source is optional: keyboard-wedge scanners need no declaration because
 * they are read as keyboard input. Hosts compose it into the catalog's requirements.
 */
export const scannerDevicesComponent = defineHostComponent({
  id: 'scanner-devices',
  description:
    'Barcode scanner sources beyond keyboard wedge: serial, HID POS, camera and vendor SDKs.',
  requirements: {
    devices: [
      {
        id: 'scanner-serial',
        kind: 'serial',
        purpose: 'USB-COM/CDC or RS-232 barcode scanners through Web Serial.',
        availability: 'optional',
      },
      {
        id: 'scanner-hid-pos',
        kind: 'hid',
        purpose: 'HID POS barcode scanners (usage page 0x8C) through WebHID.',
        availability: 'optional',
      },
      {
        id: 'scanner-camera',
        kind: 'camera',
        purpose: 'Camera barcode decoding at the station.',
        availability: 'optional',
      },
      {
        id: 'scanner-vendor-sdk',
        kind: 'vendor-sdk',
        purpose: 'Vendor scanner SDKs on the station PC through the host scanner bridge.',
        availability: 'optional',
      },
    ],
  },
});
