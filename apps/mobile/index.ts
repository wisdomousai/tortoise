// First: installs the Web globals Hermes lacks before any kernel or runtime module runs.
import '@agent-native/mobile/expo';
import './global.css';
import { registerRootComponent } from 'expo';
import { defineBackgroundDelivery } from '@agent-native/mobile/expo';
import { App, authority } from './src/app';

// Module scope: the OS may start the runtime only to run this task.
const registerDelivery = defineBackgroundDelivery('agent-native.delivery', authority);
void registerDelivery().catch(() => {
  // Background tasks are unavailable in Expo Go and on some devices; delivery stays foreground.
});

registerRootComponent(App);
