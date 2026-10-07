import screens from 'virtual:agent-native/screens';
import { Frame } from '@/frame';

/**
 * The starter's web root: the framework frame around the configured application's screens.
 * Extend it here, or shadow any frame file by adding one at the same `src/` path.
 */
export function App() {
  return <Frame screens={screens} />;
}
