import { defineHostPlugin } from '@agent-native/kernel/plugin';
import { notificationsHandlers, notificationsPolicy, type NotificationsServices } from './handlers';
import { openNotifications, type NotificationsOptions } from './open';
import { notificationsPluginManifest } from './plugin-manifest';
import { createNotificationsState, type NotificationsState } from './state';

/**
 * The notifications plugin. It shows the outbox effects of targets a queueing notify action
 * carries as local notifications, through the OS plugin, which it requires, and runs the
 * continuation a reply stands for once, as the person notified. Its slice holds reply nonces by
 * digest only.
 */
export function createNotificationsPlugin(options: NotificationsOptions = {}) {
  return defineHostPlugin<NotificationsState, NotificationsServices>({
    manifest: notificationsPluginManifest,
    requires: ['os'],
    state: { create: createNotificationsState },
    handlers: notificationsHandlers,
    authorization: { resourceTypes: ['notification'], port: notificationsPolicy },
    open: openNotifications(options),
  });
}

export const notificationsPlugin = createNotificationsPlugin();
export default notificationsPlugin;
