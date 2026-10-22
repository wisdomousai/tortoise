---
'@agent-native/contracts': minor
'@agent-native/runtime': minor
'@agent-native/kernel': minor
'@agent-native/frame': minor
'@agent-native/devices': minor
'@agent-native/scaffold': minor
---

Features: reusable domain parts an application mounts once with `defineManifest({ features })` and `defineApplication({ features: [mountFeature(feature, { access, hooks, adopt })] })`. Host plugins are composed through the same units.

Breaking changes:

- Approval requests, reconciliation and device configuration are features (`approvalFeature`, `reconciliationFeature`, `deviceFeature`). An application that composed their modules into its own state mounts the feature and adopts the stored data in a migration step.
- `devicePolicy`, `deviceAuthorizationRoute` and `DeviceAuthorizationView` are removed from `@agent-native/devices/server`.
- `defineScreens` and `defineNativeScreens` need `manifest` when feature or plugin screens are listed, and refuse screens out of the manifest's order or outside the unit's operation namespace.
- A feature's or plugin's operations and resource types are decided by its own policy only; the application's `caller` gate no longer applies to them.
- `scaffold add agent` mounts the approval feature instead of generating approval handlers, state and rules. Applications generated before this release lack the new `// scaffold:` markers, and `add` refuses them where a marker is missing.
