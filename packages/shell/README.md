# @agent-native/shell

OS handlers and OS actions at runtime. It checks the syntax of a raw OS request, matches it to the first declared handler that accepts it, fills the handler's target templates, and builds the instruction a shell adapter runs for a declared action. It also generates the platform registrations (Expo, electron-builder, the web manifest) from the same declarations, and holds the desktop shell adapter without its Electron calls. The [OS plugin](../../plugins/os/README.md) composes these functions into the shell port; the [desktop starter](../../apps/desktop/README.md) supplies the Electron calls to the adapter.

Layer: framework (`packages/*`). Pure functions with no Node, Bun or browser API, so the host, the mobile host and a browser adapter can share them.

## Primitives

- [OS handler](../../docs/primitives.md#os-handler): `parseRawOsRequest`, `OsRequestError`, `matchOsRequest`, `MatchOptions`, `OsMatch`, `OsRequestValues`, `resolveTarget`, `fillTemplate`.
- [OS action](../../docs/primitives.md#os-action): `buildInstruction`, `openUrl`, `openActionFor`, `OsActionError`.
- [Shell port](../../docs/primitives.md#shell-port): `createDesktopShell`, `DesktopShell`, `DesktopShellClient`, `DesktopShellDependencies`, `desktopArguments`, `receivedArguments`, `pathName`, `DesktopArguments`.
- [Generator](../../docs/primitives.md#generator): `nativeOsConfig`, `desktopOsConfig`, `webManifestOs`, `webScheme`, `OsIdentity`, `OsRegistrationOptions`, `ExpoIntentFilter`.

## Entrypoints

| Import                              | Runs in  | Contents                                                                                                    |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `@agent-native/shell`               | any host | Everything listed under Primitives.                                                                         |
| `@agent-native/shell/*`             | any host | One source file: `parse`, `match`, `targets`, `actions`, `registrations`, `desktop` or `desktop-arguments`. |
| `@agent-native/shell/registrations` | any host | The generators alone, for `mobile:prepare`, desktop packaging and the frame's Vite plugin.                  |

## Trust boundary

A raw request comes from an unauthenticated sender on the device. `parseRawOsRequest` refuses unknown kinds and fields, text over 1 MiB, URLs over 2048 characters, a file name that is not one path segment, and labels with control or bidirectional override characters. `matchOsRequest` accepts only URLs with this application's scheme (or its `web+` form) and `https` links on a configured verified host for a handler that declares `verified`; it refuses credentials, fragments, dot segments and encoded slashes, and validates parameters and extras with the handler's own schema. A template can name only the request's own fields, so a sender cannot pick a different resource kind, screen or command. A prefilled value must fit its input property's type, `maxLength` and `enum`; the command validates the whole input again when a person submits.

`buildInstruction` takes the scheme, host, directory root, intent action and package from the declaration. Open-action values are encoded with `encodeURIComponent`, so a value stays inside its path segment, and the parsed result must keep the template's scheme and host. File paths are relative, without empty, `.` or `..` segments, and are joined below a configured root; the adapter still resolves links before it opens anything. A `notify` action is refused here because the plugin that issues its reply nonces builds it.

The generators produce verified link registrations only for hosts the deployment configures, never from content.

The desktop adapter reads a command line only after `--` when one is present, so a link that breaks out of its quotes cannot add an argument that is read; without `--` it ignores every switch. It accepts links in the application's scheme and absolute local paths, and refuses UNC paths, which would make Windows authenticate to a remote server. Data a second instance hands over is parsed again. It reads only files whose extension a declared text file handler lists, within that handler's `maxBytes`, so other files the OS passes are never read. A relayed open is checked against the declarations again before it runs. `openActionFor` matches a URL a page asked to open to a declared open action: same origin and path shape, no credentials, fragment or repeated parameter, and every value within the JSON form of the action's schema (text with `const`, `enum`, `pattern` and `maxLength`). It needs only that JSON form, so it works on declarations read over HTTP; a value it cannot check fails.

## Dependencies

Framework: `@agent-native/contracts`. No external packages.

## Tests

```sh
bun test packages/shell
```

`test/desktop.test.ts` covers command lines with and without `--`, injected switches, relative and UNC paths, second-instance data, URLs that differ from a declared open action, input buffered until connect, undeclared files left unread, relayed actions checked again, and page opens with and without the shell port. `test/shell.test.ts` covers scheme, `web+` and verified links; links that are not the application's own or are malformed; a text file that prepares a form, size and field limits, and unsafe file names; open URLs that keep their host whatever the parameters hold; file paths kept below their root; and native, desktop and web registrations from one set of handlers.
