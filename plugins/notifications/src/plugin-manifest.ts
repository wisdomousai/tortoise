import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';
import { notificationsModule } from './contracts';

/**
 * The browser-safe part of the notifications plugin: its module of reply nonces. The notify
 * actions and reply handlers it serves are declared by the application's modules.
 */
export const notificationsPluginManifest = definePluginManifest({
  id: 'notifications',
  title: 'Notifications',
  // Operation ids predate the namespace rule.
  namespace: 'notification',
  modules: [notificationsModule],
  // The desktop adapter shows notifications over the host's shell relay, the mobile one in-process.
  platforms: ['bun', 'android', 'ios'],
});

export default notificationsPluginManifest;
