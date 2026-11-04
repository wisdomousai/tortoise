import { createCli } from '@tortoise/host/cli';
import { networkPlugin } from '@tortoise/network/plugin';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { siteApplication } from './fixtures';

/**
 * The site application's CLI, which a test release's `bin/plant` script runs, with the real
 * network plugin so `app install` can export its rules. `FIXTURE_STATE` picks the version.
 */
const version = process.env.FIXTURE_STATE === '2' ? 2 : 1;
const network = { manifest: networkPluginManifest, plugin: networkPlugin };
process.exitCode = await createCli(siteApplication(network, version), { program: 'plant' })(
  process.argv.slice(2),
);
