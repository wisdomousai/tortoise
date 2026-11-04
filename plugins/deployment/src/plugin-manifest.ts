import { defineHostComponent } from '@tortoise/contracts';
import { definePluginManifest } from '@tortoise/host/plugin-manifest';

/**
 * The workforce identity provider's destination, bound only when the deployment policy signs people in
 * with `identity: external`. Discovery, signing keys and the code exchange go through it.
 */
export const workforceIdentityComponent = defineHostComponent({
  id: 'deployment-identity',
  description:
    'Deployment plugin: signs people in with the workforce identity provider (OpenID Connect).',
  requirements: {
    network: [
      {
        id: 'workforce-idp',
        purpose: 'Sign people in with the workforce identity provider (OpenID Connect).',
        direction: 'egress',
        scope: 'internet',
        protocol: 'https',
        dataClasses: ['identity'],
        availability: 'optional',
        offline: 'unavailable',
      },
    ],
  },
});

/**
 * The browser-safe part of the deployment plugin: the `deployment-policy` launcher setting and the workforce
 * identity provider's destination. It adds no module; the policy only binds what is declared.
 */
export const deploymentPluginManifest = definePluginManifest({
  id: 'deployment',
  title: 'Deployment policy',
  components: [workforceIdentityComponent],
  settings: [
    {
      key: 'deployment-policy',
      env: 'TORTOISE_DEPLOYMENT_POLICY',
      kind: 'path',
      description: 'bind declared destinations; absent: isolated',
    },
  ],
});
