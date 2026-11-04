import { defineHostComponent } from '@tortoise/contracts';
import { definePluginManifest } from '@tortoise/host/plugin-manifest';

/**
 * The workforce identity provider's destination, bound only when the site policy signs people in
 * with `identity: external`. Discovery, signing keys and the code exchange go through it.
 */
export const workforceIdentityComponent = defineHostComponent({
  id: 'site-identity',
  description:
    'Site plugin: signs people in with the workforce identity provider (OpenID Connect).',
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
 * The browser-safe part of the site plugin: the `site-policy` launcher setting and the workforce
 * identity provider's destination. It adds no module; the policy only binds what is declared.
 */
export const sitePluginManifest = definePluginManifest({
  id: 'site',
  title: 'Site policy',
  components: [workforceIdentityComponent],
  settings: [
    {
      key: 'site-policy',
      env: 'TORTOISE_SITE_POLICY',
      kind: 'path',
      description: 'bind declared destinations; absent: isolated',
    },
  ],
});
