import { contextBridge } from 'electron';

/** No IPC transport, provider secrets, filesystem or arbitrary native calls cross
 * this bridge. Account connection is handled by the authenticated local service. */
contextBridge.exposeInMainWorld(
  'desktopHost',
  Object.freeze({
    platform: process.platform,
    desktop: true,
  }),
);
