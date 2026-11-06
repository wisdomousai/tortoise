# @tortoise/android-intents

`@tortoise/android-intents` connects declared OS handlers to Android intent delivery. `openAndroidIntents` is composed with the OS plugin. Outgoing actions start an explicit intent in the receiving application.

An intent can originate from other software on the device. The plugin handles it as an unsolicited request to open a screen or prepare a form. The person submits any resulting command through their session.

## References

[add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)

`bun test plugins/android-intents`
