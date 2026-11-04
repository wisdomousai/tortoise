import { definePluginManifest } from '@tortoise/kernel/plugin-manifest';
import { peerLinkModule } from './contracts';

/**
 * Calls between two agent-native applications. The called application enrolls the caller with a
 * one-use code; every request that presents the peer credential acts as the peer's service
 * principal or, with a signed subject assertion, as the person the subject maps to. It runs on a
 * serving Bun host that a site policy opens to the network.
 */
export const peerLinkPluginManifest = definePluginManifest({
  id: 'peer-link',
  title: 'Peer link',
  namespace: 'peer',
  modules: [peerLinkModule],
  settings: [
    {
      key: 'peer-link-agents',
      env: 'AGENT_NATIVE_PEER_LINK_AGENTS',
      kind: 'string',
      description:
        'refuse or allow calls on behalf of a person that a delegated run made on the caller; absent: the application default, refuse unless it says otherwise',
    },
  ],
});

export default peerLinkPluginManifest;
