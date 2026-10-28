# @agent-native/shell

[OS handlers](../../docs/glossary.md#os-handler) and [OS actions](../../docs/glossary.md#os-action) at runtime, with the platform registrations generated from the same declarations. The package checks the syntax of a raw OS request, matches it to the first declared handler that accepts it and fills the handler's target templates. It builds the instruction a shell adapter runs for a declared action, and it holds the desktop and mobile shell adapters without their Electron or Expo calls.

## Context

Pure functions with no Node, Bun or browser API, so the host, the mobile host and a browser adapter can share them. The [OS plugin](../../plugins/os/README.md) composes these functions into the [shell port](../../docs/glossary.md#shell-port). The [desktop starter](../../apps/desktop/README.md) supplies the Electron calls to the adapter. The package trusts the declarations in the [catalog](../../docs/glossary.md#catalog) and treats every raw request as untrusted.

## Primitives

- [OS handler](../../docs/primitives.md#os-handler):
  - parsing and matching: `parseRawOsRequest`, `OsRequestError`, `matchOsRequest`, `MatchOptions`, `OsMatch`, `OsRequestValues`, `resolveTarget`, `fillTemplate`;
  - shares: `shareHandlerFor`, `shareFileRequest`, `maxSharedItems`, `MobileShare`, `webShareTargetPath`, and `claimCode` for the codes a plugin issues for held input;
  - shortcuts: `shortcutLink` for the link a launcher entry opens, `shortcutIdOf` for the shortcut a link stands for, and `launcherShortcuts` (`LauncherShortcut`) for the entries a platform registers;
  - provenance: `describeProvenance`, the one sentence the web and native frames show a person above a delivery.
- [OS action](../../docs/primitives.md#os-action):
  - instructions: `buildInstruction`, `openUrl`, `openActionFor`, `OsActionError`;
  - notifications: `ShellNotification` and `shellNotification` for what an adapter shows, and `replyRequest` for the reply a chosen button submits.
- [OS handler](../../docs/primitives.md#os-handler) and [OS action](../../docs/primitives.md#os-action), Android intents: `AndroidIntent`, `AndroidIntentRecord`, `AndroidExtra` and `IntentListening`, with:
  - `intentListening` for the actions and typed extras a device passes on;
  - `intentRequest` for the request a received intent stands for;
  - `intentToStart` for the explicit intent an instruction starts.
- [Shell port](../../docs/primitives.md#shell-port):
  - desktop: `createDesktopShell`, `DesktopShell`, `DesktopShellClient`, `DesktopShellDependencies`, `desktopArguments`, `receivedArguments`, `pathName`, `DesktopArguments`;
  - the browser adapter in the frame and the desktop alike: `launchRequest`, `fileHandlerFor`, `fileRequest`, `BlobUpload` and `strictText`;
  - Android and iOS: `createMobileShell`, `MobileShell`, `MobileShellDependencies`, `MobileFileInfo` and `mobileInput`.
- [Generator](../../docs/primitives.md#generator): `nativeOsConfig`, `desktopOsConfig`, `webManifestOs`, `webScheme`, `OsIdentity`, `OsRegistrationOptions`, `ExpoIntentFilter`; `associationFiles` and `AssociationIdentity` for the files a verified link's domain serves.

## Entrypoints

| Import                              | Runs in  | Contents                                                                         |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `@agent-native/shell`               | any host | Everything listed under Primitives.                                              |
| `@agent-native/shell/*`             | any host | One source file from `src/`.                                       |
| `@agent-native/shell/registrations` | any host | The generators alone, for `mobile:prepare`, desktop packaging and the frame's Vite plugin. |

## Trust boundary

### Raw requests and matching

A raw request comes from an unauthenticated sender on the device. `parseRawOsRequest` refuses:

- unknown kinds and fields;
- text over 1 MiB and URLs over 2048 characters;
- a file name that is not one path segment;
- labels with control or bidirectional override characters.

`matchOsRequest` accepts only two kinds of URL: this application's scheme or its `web+` form, and `https` links on a configured verified host for a handler that declares `verified`. It refuses credentials, fragments, dot segments and encoded slashes. It validates parameters and extras with the handler's own schema.

A template can name only the request's own fields, so a sender cannot pick a different resource kind, [screen](../../docs/glossary.md#screen) or [command](../../docs/glossary.md#command). A prefilled value must fit its input property's type, `maxLength` and `enum`. The command validates the whole input again when a person submits.

### Actions

`buildInstruction` takes the scheme, host, directory root, intent action and package from the declaration. Open-action values are encoded with `encodeURIComponent`, so a value stays inside its path segment. The parsed result must keep the template's scheme and host. File paths are relative, without empty, `.` or `..` segments, and are joined below a configured root. The adapter still resolves links before it opens anything. A `notify` action is refused here, because the plugin that issues its reply nonces builds it.

`openActionFor` matches a URL a screen asked to open to a declared open action. It requires:

- the same origin and path shape;
- no credentials, fragment or repeated parameter;
- every value within the JSON form of the action's schema: text with `const`, `enum`, `pattern` and `maxLength`.

`openActionFor` needs only that JSON form, so it works on declarations read over HTTP. A value the matcher cannot check fails.

### Generators

The generators produce verified link registrations only for hosts the deployment configures, never from content. Share handlers produce one share target per platform that accepts what they accept together. The matcher still decides which handler a share reaches.

`associationFiles` lists only handlers that declare `verified`, with their parameters as wildcards. It refuses:

- a team ID that is not ten upper-case letters or digits;
- a certificate fingerprint that is not 32 colon-separated hex bytes;
- an application with no verified link.

Serving the files on the domain is the deployment's job.

### Mobile adapter

The mobile adapter takes a URI the OS opened the application with, at most 2048 characters. It accepts a link in the application's scheme or `https`, or a `content:` or `file:` file. It drops anything else before matching.

The adapter inspects a file first. It reads the file only when a declared file handler lists its extension or its reported media type, within that handler's `maxBytes`. On Android a `content:` name is often an opaque ID. Such a file matches by the media type its provider reports, and the blob is stored as that type.

A URI the bindings report as a share is not matched as a link; on Expo it is `<scheme>://expo-sharing`. Its items are submitted as share requests, at most `maxSharedItems`. A shared file is read only when a share handler accepts its media type, within that handler's `maxBytes`.

For actions on mobile:

- A relayed open is checked against the declarations again.
- A share shows the system share sheet only when the bindings supply one.
- Reveal and open-file are refused.
- A notification is shown only when the bindings supply `notify`.

A notification's buttons, nonces included, go into the notification's data, because a reply may come after the application was stopped. `replied` therefore treats the buttons it gets back as unknown input. It submits a reply only for a button among them.

`intent` takes an activity intent the device received, as unknown input. It submits the intent only when its action is a declared intent handler's. The device is asked to pass on only those actions and the extras their handlers declare (`intentListening`).

An intent action starts only when the bindings supply `startIntent`. Its action ID, intent action and package are first checked against the declaration again, and its extras must be flat values. Intent handlers are registered through the framework's `@agent-native/mobile/intent-filters` config plugin. Expo's `android.intentFilters` is not used, because it would prefix the declared names.

### Desktop adapter

The desktop adapter reads a command line only after `--` when one is present. A link that breaks out of its quotes therefore cannot add an argument that is read. Without `--`, the adapter ignores every switch. It accepts links in the application's scheme and absolute local paths. It refuses UNC paths, which would make Windows authenticate to a remote server. Data a second instance hands over is parsed again.

The adapter reads only files a declared file handler lists by extension, within that handler's `maxBytes`. It does not read other files the OS passes. `fileRequest` sends a text payload inline only when it is strict UTF-8. It uploads a blob payload as the reported media type only when the handler declares that type. Otherwise it uploads the blob as the type the handler declares for the extension.

The upload is staged under the shell's own session. The [blob](../../docs/glossary.md#blob) store lets only that [principal](../../docs/glossary.md#principal) attach it:

- only within the grace period;
- only through a command whose blob limits accept it.

The store sweeps the blob when nothing attaches it. The matcher refuses a blob whose media type the handler does not declare, or that differs from the type the request reports. A file therefore cannot match as one type and be stored as another.

A relayed open is checked against the declarations again before it runs. The adapter hands the declarations to `launchers` once it has read them. A launcher that fails to register is reported, and the adapter keeps running. The adapter runs a share action only when its caller supplies a share menu, which the desktop starter does on macOS. It runs a notify action only when its caller supplies `notify`. The buttons stay in memory, and a chosen one submits its reply. The [instance](../../docs/glossary.md#instance) checks the nonce; the adapter does not.

### Launch page and shortcuts

`launchRequest` accepts a launch URL only with exactly one of these parameters:

- `os`: a link of at most 2048 characters;
- `os-shortcut`;
- `os-share`: a claim code of 22 to 64 base64url characters.

A claim names input a plugin holds. The shell port resolves it through that plugin before matching.

A launcher entry opens `<scheme>:///?os-shortcut=<id>`, with no host, an empty path and only that parameter. `matchOsRequest` reads such a link as its shortcut before it matches links. A link handler on `/` therefore never receives it, and an undeclared ID matches nothing.

## Dependencies

Framework: `@agent-native/contracts`. No external packages.

## Tests

```sh
bun test packages/shell
```

- `test/desktop.test.ts`:
  - command lines with and without `--`, injected switches, relative and UNC paths, and second-instance data;
  - URLs that differ from a declared open action, and input buffered until connect;
  - undeclared files left unread, a blob file uploaded before it is submitted, and an oversized one not read whole;
  - relayed actions checked again, and screen opens with and without the shell port;
  - a relayed notification whose chosen button submits its reply, while an unknown button submits nothing.
- `test/files.test.ts`:
  - handler lookup by extension and media type, and text and blob request building;
  - the upload media type, size limits and refused uploads;
  - the matcher's blob size and media type checks.
- `test/shell.test.ts`:
  - scheme, `web+` and verified links, and links that are not the application's own or are malformed;
  - a text file that prepares a form, size and field limits, and unsafe file names;
  - open URLs that keep their host whatever the parameters hold, and file paths kept below their root;
  - native, desktop and web registrations from one set of handlers.
- `test/associations.test.ts`: the association files and their refusals.
- `test/shares.test.ts`:
  - the web manifest's share target and the `expo-sharing` config plugin from the share handlers;
  - the share handler lookup and file request limits;
  - claim codes and their launch URL, and a mobile shell without share bindings.
- `test/shortcuts.test.ts`:
  - the shortcut link form and the links that are not one;
  - the shell port reading a shortcut link before a root link handler;
  - the native, web and desktop launcher entries from one set of handlers;
  - a failing launcher registration leaving the desktop shell adapter connected.
- `test/intents.test.ts`:
  - intent matching by action, categories, data scheme and MIME type, with the extras schema;
  - the listening map and received records;
  - the intent instruction and its recheck before it starts, and the intent filter config plugin entry.

The mobile adapter runs end to end in the OS plugin's `test/mobile.test.ts`. Its notifications run in the notifications plugin's tests, and its intents in the Android intents plugin's tests.

## Task guides

- [add-os-integration](skills/add-os-integration/SKILL.md): declaring OS handlers and actions and regenerating the platform registrations from them.
