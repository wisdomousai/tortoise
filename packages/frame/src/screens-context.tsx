import { createContext, useContext } from 'react';
import type { ApplicationScreens } from '@agent-native/frame/screens';

const ScreensContext = createContext<ApplicationScreens | undefined>(undefined);

/** Provides the hosted application's screens to frame components. */
export const ScreensProvider = ScreensContext.Provider;

/** The hosted application's screens; fails outside the frame. */
export function useScreens(): ApplicationScreens {
  const screens = useContext(ScreensContext);
  if (!screens) throw new Error('useScreens must be used inside the frame');
  return screens;
}
