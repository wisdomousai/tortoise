# @agent-native/bundle

The bundle package creates and checks the [site bundle](../../docs/glossary.md#site-bundle): one signed, versioned artifact per application and platform, checked before a [site](../../docs/glossary.md#site) installs it. A bundle is a directory with three parts:

- `files/` holds the payload: the compiled binary, the web build, the generated security manifest and contract, and an SBOM written from the lockfile when the bundle is created.
- `bundle.json` lists every file with its SHA-256 and size. It also names the application, version, platform, storage schema, catalog digest and declared requirements, and the [best-before date](../../docs/glossary.md#best-before-date) when the application has a shelf life.
- `bundle.sig` is an Ed25519 signature over the canonical manifest.

## Context

Server only. It trusts only the keys a site lists and the approvals a site keeps.

## Primitives

- [Site bundle](../../docs/primitives.md#site-bundle) and its install:
  - creation: `createBundle`, `BundleDescription`;
  - verification: `verifyBundle`, `BundleRefused`;
  - the manifest: `BundleManifest`, `BundleFile`, `BundleRequirements`, `parseBundleManifest`, `safeBundlePath`;
  - signing: `generateSigningKey`, `signManifest`, `verifyManifestSignature`, `SigningKey`, `TrustedKey`, `BundleSignature`;
  - admission: `admissionRefusals`, `requirementChanges`, `RequirementChange`, `requirementsDigest`, `SiteApproval`, `SiteTarget`.

The root script `bun run bundle` (`scripts/bundle.ts`) works on the configured application with the verbs `keygen`, `create`, `verify` and `admit`. The script builds the security manifest, contract and SBOM from the catalog and lockfile at that moment. `create` stamps the binary and the bundle with one build time, so both have the same best-before date, and `verify` prints the date. This package therefore never imports the compliance plugin.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/bundle` | server only | Everything below except `files`. |
| `@agent-native/bundle/*` | server only | One source file: `manifest`, `signing`, `create`, `verify`, `admission` or the internal `files`. |

## Trust boundary

### Verification

Nothing in a bundle is used before `verifyBundle` passes. The signature must come from a key the site lists. A key's ID is recomputed from its bytes, so a listing cannot pair a trusted ID with another key. The manifest is checked as signed. Then `files/` must hold exactly the listed files with the listed digests, and no extra file, link or special file.

Paths are relative with no `..` segment. A best-before date is a signed `YYYY-MM-DD`; admission ignores it, so a bundle past its date installs like any other.

### Admission

`admissionRefusals` decides whether a verified bundle may replace the installed one on this site. It requires:

- the same platform;
- a storage schema this site reads;
- the same application;
- no added or widened requirement, unless the site approved this exact requirements digest.

A first install lists every requirement as added, so it always needs an approval. An approval is plain data the site keeps, with no signature of its own. It must therefore live where only the site's administrator can write.

### Signing key

The signing key is passed explicitly and never discovered. `keygen` writes it with mode 0600 and refuses to overwrite. Keys do not belong in the repository. The signature gives the bundle integrity and provenance. The package does no OS code signing or notarization.

## Dependencies

Framework: `@agent-native/contracts` for `canonicalJson`. Platform: WebCrypto Ed25519 and Node file APIs.

## Tests

```sh
bun test packages/bundle
```

`test/bundle.test.ts` verifies a bundle against its key. It refuses:

- another key, and a key listed under a foreign ID;
- an added file, a replaced file and a changed manifest;
- a link in the payload and a path that escapes;
- another platform, an unreadable storage schema and another application;
- a changed or malformed best-before date.

The admission tests also check that a first install or widened requirements need approval for the exact requirements.

## Task guides

- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md): deployment policy, signed bundles and install.
- [decommission-an-application](../../plugins/site/skills/decommission-an-application/SKILL.md): the best-before date a bundle includes, and removal.
