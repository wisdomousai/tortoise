---
'@tortoise/contracts': minor
'@tortoise/deployment': minor
'@tortoise/bundle': minor
'@tortoise/network': minor
'@tortoise/audit': minor
'@tortoise/process': minor
'@tortoise/compliance': minor
'@tortoise/fleet-agent': minor
'@tortoise/hub-link': minor
'@tortoise/scaffold': minor
---

A location is not a thing that acts, so no name or sentence treats a site as one.

Breaking changes:

- Package: `@tortoise/site` is `@tortoise/deployment` (`plugins/deployment`). `sitePlugin`, `sitePluginManifest`, `openSite`, `siteServiceOf` and `SiteService` are `deploymentPlugin`, `deploymentPluginManifest`, `openDeployment`, `deploymentServiceOf` and `DeploymentService`. The plugin ID `site` is `deployment`, so a plugin that requires it lists `deployment`, and its service is `services.deployment`.
- Deployment policy: the setting `site-policy` is `deployment-policy`, `--site-policy` is `--deployment-policy` and `TORTOISE_SITE_POLICY` is `TORTOISE_DEPLOYMENT_POLICY`. `SitePolicy` and `loadSitePolicy` are `DeploymentPolicy` and `loadDeploymentPolicy`.
- CLI: `site check --site <file>` is `policy check --policy <file>`. `network export --site` and `compliance report --site` take `--policy`.
- Hardening profile `site-hub` is `hub`. Destination scope `site` is `local`; `NetworkScope` is `'loopback' | 'local' | 'internet'`, the compliance manifest groups them under `local`, and the warning `PUBLIC_SITE_ADDRESS` is `PUBLIC_LOCAL_ADDRESS`.
- Bundles: `SiteApproval` and `SiteTarget` are `InstallApproval` and `InstallTarget`. The installer's message `without site approval` is `without install approval`.
- Fleet: an enrolled site is an instance. `fleetSiteModule`, `fleetSiteOperations`, `SiteReport` and `siteReportSchema` are `fleetInstanceModule`, `fleetInstanceOperations`, `InstanceReport` and `instanceReportSchema`. The capabilities `fleet.site.*` and `site.*` are `fleet.instance.*` and `instance.*`, the resource type `Site` is `Instance`, the module ID `fleet-site` is `fleet-instance`, the data class `site-health` is `instance-health`, and the Sites screen is Instances. A fleet and the instances that report to it upgrade together.
- Skills: `deploy-to-site` is `deploy-an-application` and `connect-a-site-to-a-fleet` is `connect-an-instance-to-a-fleet`. The site pattern is `showcase/patterns/fleet-agent`.
- Stored data is not migrated. An existing workspace keeps the old resource type `Site` and the `sites` state key, and an existing audit log keeps the old capability IDs in its events. Start with a new data directory.
