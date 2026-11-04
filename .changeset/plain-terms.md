---
'@tortoise/kernel': minor
'@tortoise/host': minor
'@tortoise/mobile': minor
'@tortoise/site': minor
'@tortoise/testing': minor
'@tortoise/scaffold': minor
'@tortoise/operator-ui': minor
'@tortoise/screen-bridge': minor
'@tortoise/notifications': minor
'@tortoise/workflows': minor
'@tortoise/hub-link': minor
'@tortoise/devices': minor
---

Plain terms replace five overfit ones. Point of work is gone from the docs, and the launch key exchange is now launch link sign-in in prose only. Nothing in the wire format changes: `launchUrl` and `#launch=` stay.

Breaking changes:

- Local user: the principal `owner` is `local-user`. `LOCAL_OWNER` is `LOCAL_USER`, `PluginIdentity.localOwnerSessions` is `localUserSessions`, and the `ProviderAccessOptions` field `ownerPrincipalId` is `localUserPrincipalId`. The deployment policy `identity: 'local-owner'` is `identity: 'local-user'`. The `ownerId` argument of `createState`, `upgradeState`, feature `state.create` and `state.upgrade`, and migration steps is `localUserId`. A workspace written before this change keeps `owner` as a principal, member and creator, so its local user finds no membership and no stored record they created. Start with a new data directory.
- Application state fields named for the principal are `localUserId`: the notifications slice `owner`, the field-service `workspaceOwnerId` and the asset-survey-field `ownerId`. The workflows and hub-link slices list local users in `localUsers`, not `owners`.
- Control: `ControlHolder` is `ControlledBy`, `BridgeControl.holder` is `BridgeControl.controlledBy`, and the `TakeoverButton` prop `holder` is `controlledBy`. The winding-line station field `controlHolder` is `controlledBy`, `line.control.request` and `line.control.get` take and return `controlledBy` in place of `holder`, and `controlHolderSchema` is `controlledBySchema`. The values `operator`, `agent` and `idle` are unchanged.
- Action checks: the docs, glossary and primitives call the interlock the action checks. No identifier changes. `interlock override` stays where it names a control on the equipment.
- Operator input: `docs/point-of-work-input.md` is `docs/operator-input.md`, and the docs site page is `operator-input`. The glossary entry Point of work is gone.
