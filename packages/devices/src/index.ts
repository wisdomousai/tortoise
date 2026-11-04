/**
 * Operator input device logic: scanner profiles, sources, decoding, calibration and routing. Pure
 * and browser-safe. User interface for configuring devices ships separately in the operator-ui
 * shadcn registry; host-side vendor SDKs connect through `HostScannerBridge`.
 */
export * from './scanner/calibrate';
export * from './scanner/camera';
export * from './scanner/decode';
export * from './scanner/gs1';
export * from './scanner/hid-pos';
export * from './scanner/host-plugin';
export * from './scanner/layouts';
export * from './scanner/profile';
export * from './scanner/router';
export * from './scanner/serial';
export * from './scanner/source';
export * from './scanner/symbology';
export * from './scanner/wedge';
