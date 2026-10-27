---
'@agent-native/assignments': minor
'@agent-native/contracts': minor
'@agent-native/runtime': minor
'@agent-native/frame': minor
'@agent-native/frame-native': minor
'@agent-native/scaffold': minor
---

Assignments: work handed to a person, an agent, a paired device, a peer application or a target, with a brief, and the reports the assignee sends back for a person to accept or discard. The new `@agent-native/assignments` package declares kinds with `defineAssignmentKind` and `defineAssignments`, and its `./server` entrypoint mounts them as the `assignment` feature with `assignmentFeature`, an `AssignmentAccess` view and hooks per kind from `byKind`. `assignmentTargetPort` runs a function, such as a model call, as a target. The worklist kit (`defineWorklist`, `worklistHandlers`, `worklistRules`, `connectWorklist`) keeps the assignee's side in another instance, over hub-link or peer-link. `worklistHandlers` takes an `onReceived` hook, called in the feed's transaction for each assignment received for the first time.

`AgentDefinition` takes an optional `creates`, the resource types a resource-scoped run may create. `agentGrant` records the definition on `DelegationGrant.agent`; grant files refuse the field.

The frame registry adds `assignment-board`, `assignment-reports`, `my-assignments` and `worklist`, and the native registry adds `worklist-list` and `worklist-sync`, whose `action` adds a control next to each report's state. Slots per kind replace the scope editor, the board's summary, the brief view, the report form, the body view, the subject's name, the linking input and the accept form. `scaffold add assignment-kind <id> --collection <type>` writes a kind for person assignees with its hooks, screens and a test, and the first kind mounts the feature.

`CapabilityForm` prefixes its field IDs per form, so two forms for the same command on one page keep their labels apart.
