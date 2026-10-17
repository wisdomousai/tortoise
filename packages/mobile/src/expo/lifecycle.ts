import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState, type AppStateStatus } from 'react-native';
import type { MobileAuthority } from '../authority';

/**
 * Run the authority's integration loops only while the app is in the foreground. Returns the
 * unsubscribe function.
 */
export function followAppState(authority: MobileAuthority) {
  const apply = (state: AppStateStatus | string | null | undefined) => {
    if (state === 'active') authority.foreground();
    else void authority.background();
  };
  apply(AppState.currentState);
  const subscription = AppState.addEventListener('change', apply);
  return () => subscription.remove();
}

/**
 * Define the background delivery task. Call it at module scope in the app entry: the OS may start
 * the JavaScript runtime only to run the task, before any screen mounts. `authority` returns the
 * open authority, opening one if the app started for the task; ownership forbids a second one.
 * The OS decides when the task runs (on iOS rarely), so delivery is mostly a foreground job.
 * Returns a function that registers the task with the OS.
 */
export function defineBackgroundDelivery(
  name: string,
  authority: () => Promise<MobileAuthority>,
  options: { readonly minimumIntervalMinutes?: number } = {},
) {
  TaskManager.defineTask(name, async () => {
    try {
      await (await authority()).backgroundPass();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
  return () =>
    BackgroundTask.registerTaskAsync(name, {
      minimumInterval: options.minimumIntervalMinutes ?? 15,
    });
}
