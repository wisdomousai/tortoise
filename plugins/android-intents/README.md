# @agent-native/android-intents

Connects an app to Android intents both ways: it receives an intent with the app's own action, and it starts an explicit intent in another app. Compose `openAndroidIntents` beside the OS plugin. An intent arrives from any app on the device, so the plugin treats it as an unsolicited OS request: it only opens or prefills a form, and the person confirms there.

Primitives:

- [OS handler](../../docs/primitives.md#os-handler)
- [OS action](../../docs/primitives.md#os-action)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)
- `bun test plugins/android-intents`
