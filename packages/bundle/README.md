# @agent-native/bundle

One signed, versioned artifact per application and platform, checked before a site installs it. A bundle is a directory: `files/` holds the payload (the compiled binary, the web build, the generated security manifest and contract, and an SBOM written from the lockfile when the bundle is created), `bundle.json` lists every file with its SHA-256 and size together with the application, version, platform, storage schema, catalog digest and declared requirements, and `bundle.sig` is an Ed25519 signature over the canonical manifest.

Layer: framework (`packages/*`). Server only.

## Primitives

- [Task package](../../docs/primitives.md#task-package): `createBundle`, `BundleDescription`, `verifyBundle`, `BundleRefused`, `BundleManifest`, `BundleFile`, `BundleRequirements`, `parseBundleManifest`, `safeBundlePath`, `generateSigningKey`, `signManifest`, `verifyManifestSignature`, `SigningKey`, `TrustedKey`, `BundleSignature`, `admissionRefusals`, `requirementChanges`, `RequirementChange`, `requirementsDigest`, `SiteApproval`, `SiteTarget`.

The root script `bun run bundle` (`scripts/bundle.ts`) builds one from the configured application with `keygen`, `create`, `verify` and `admit`. The script builds the security manifest, contract and SBOM from the catalog and lockfile at that moment, so this package never imports the compliance plugin.

## Entrypoints

| Import                   | Runs in     | Contents                                                                                       |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------------- |
| `@agent-native/bundle`   | server only | Everything below.                                                                              |
| `@agent-native/bundle/*` | server only | One source file: `manifest`, `signing`, `create`, `verify`, `admission` or `files` (internal). |

## Trust boundary

Nothing in a bundle is used before `verifyBundle` passes: the signature must come from a key the site lists, and a key's ID is recomputed from its bytes, so a listing cannot pair a trusted ID with another key. The manifest is checked as signed, then `files/` must hold exactly the listed files (no extra file, link or special file) with the listed digests. Paths are relative with no `..` segment.

`admissionRefusals` decides whether a verified bundle may replace the installed one here: same platform, a storage schema this site reads, the same application, and no added or widened requirement unless the site approved this exact requirements digest. A first install lists every requirement as added, so it always needs an approval. An approval is plain data the site keeps; it has no signature of its own, so it must live where only the site's administrator can write.

The signing key is passed explicitly and never discovered; `keygen` writes it with mode 0600 and refuses to overwrite. Keys do not belong in the repository. This is integrity and provenance for the bundle, not OS code signing or notarization.

## Dependencies

Framework: `@agent-native/contracts` (`canonicalJson`). Platform: WebCrypto Ed25519 and Node file APIs.

## Tests

```sh
bun test packages/bundle
```

`test/bundle.test.ts` verifies a bundle against its key and refuses another key, a key listed under a foreign ID, an added file, a replaced file, a changed manifest, a link in the payload and a path that escapes. It refuses another platform, an unreadable storage schema and another application, and requires an approval of the exact requirements for a first install or a widening.
