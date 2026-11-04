import { Activity, Layers, ListChecks, MonitorSmartphone, Package, Radio } from 'lucide-react';
import { defineScreens } from '@tortoise/frame/screens';
import { deviceLinkScreens } from '@tortoise/device-link/plugin-screens';
import manifest from './manifest';
import { auditRoutes } from './ui/audit';
import { HealthScreen } from './ui/health';
import { relayRoutes } from './ui/relay';
import { releaseRoutes } from './ui/releases';
import { instanceRoutes } from './ui/instances';

/** The Fleet screens: health, instances, releases and channels, audit events and remote access. */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/health',
  routes: [
    { path: 'health', component: HealthScreen },
    ...instanceRoutes,
    ...releaseRoutes,
    ...auditRoutes,
    ...relayRoutes,
  ],
  navigation: [
    { to: '/health', label: 'Health', icon: Activity },
    { to: '/instances', label: 'Instances', icon: MonitorSmartphone },
    { to: '/releases', label: 'Releases', icon: Package },
    { to: '/channels', label: 'Channels', icon: Layers },
    { to: '/audit', label: 'Audit events', icon: ListChecks },
    { to: '/relay', label: 'Remote access', icon: Radio },
  ],
  capabilityScreens: [
    { prefix: 'instance.', to: '/instances' },
    { prefix: 'fleet.health', to: '/health' },
    { prefix: 'release.', to: '/releases' },
    { prefix: 'channel.', to: '/channels' },
    { prefix: 'audit-event.', to: '/audit' },
    { prefix: 'relay.', to: '/relay' },
  ],
  plugins: [deviceLinkScreens],
});
