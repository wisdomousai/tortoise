import { defineHostComponent } from '@tortoise/contracts';
import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';
import { hubLinkModule } from './contracts';

/**
 * The one destination a paired device reaches: the hub it was paired with. It serves the outbox
 * target `hub`, so an application's effects for the hub use that target name.
 */
export const hubDestinationComponent = defineHostComponent({
  id: 'hub-connection',
  description: 'Delivers records to the paired hub and reads its feed.',
  requirements: {
    network: [
      {
        id: 'hub',
        purpose: 'Deliver field records and their photos to the hub, and read assignments.',
        direction: 'outbound',
        scope: 'site',
        protocol: 'https',
        authenticated: true,
        dataClasses: ['field-record', 'photo'],
        availability: 'optional',
        offline: 'queue',
        targets: ['hub'],
      },
    ],
  },
});

/**
 * The device side of pairing. It provides the network port on the device: the only destination
 * is `hub`, at the origin the device was paired with, and every call carries the device
 * credential from the keystore. `hub-url` and `enrollment-code` let device management pair the
 * device without anyone typing; otherwise the plugin screen does.
 */
export const hubLinkPluginManifest = definePluginManifest({
  id: 'hub-link',
  title: 'Hub link',
  // Operation ids are a wire protocol older than the namespace rule.
  namespace: 'hub',
  platforms: ['android', 'ios', 'bun'],
  modules: [hubLinkModule],
  components: [hubDestinationComponent],
  settings: [
    {
      key: 'hub-url',
      env: 'TORTOISE_HUB_URL',
      kind: 'string',
      description: 'origin of the hub to pair with, such as https://hub.site.example:8443',
    },
    {
      key: 'enrollment-code',
      env: 'TORTOISE_ENROLLMENT_CODE',
      kind: 'string',
      description: 'one-use enrollment code from the hub; pairs at startup when not yet paired',
    },
  ],
});

export default hubLinkPluginManifest;
