import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';
import { deviceLinkModule } from './contracts';

/**
 * The hub side of device pairing: devices exchange a one-use enrollment code for their own
 * credential, and every request that presents it acts as that device. It runs on a serving Bun
 * host; devices reach it through the host's listener, which a site policy opens to the network
 * (`ingress.listen: 'tls'`) or which `adb reverse` forwards to an emulator.
 */
export const deviceLinkPluginManifest = definePluginManifest({
  id: 'device-link',
  title: 'Device link',
  // Operation ids are a wire protocol older than the namespace rule.
  namespace: 'link',
  modules: [deviceLinkModule],
  settings: [
    {
      key: 'device-link-sync-operations',
      env: 'TORTOISE_DEVICE_LINK_SYNC_OPERATIONS',
      kind: 'string',
      description:
        'comma-separated operations a field device may call, such as its ingest command and feed query; absent: none',
    },
  ],
});

export default deviceLinkPluginManifest;
