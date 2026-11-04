---
'@tortoise/contracts': minor
'@tortoise/runtime': minor
'@tortoise/frame': minor
'@tortoise/scaffold': minor
---

Collection commands and trees: `collectionCreate`, `collectionUpdate`, `collectionMove`, `collectionRetire` and `collectionTree` generate a collection's commands and tree read, and `collectionCommandHandlers` and `collectionTreeHandler` serve them with `defaults`, `normalize` and `validate` hooks. `defineCollection` takes an optional `parent` and `retiredField`. The runtime exports the tree helpers `subtree` and `ancestors`.

The frame registry adds `collection-tree`, and `RecordScreen` takes `move` and `retire`. `scaffold add collection` generates the commands instead of writing them by hand, and `--tree` adds a parent, move, retire, a tree read and a tree screen.
