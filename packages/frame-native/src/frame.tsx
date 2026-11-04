import { createContext, useContext, useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNavigationContainerRef,
  NavigationContainer,
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Transport } from '@tortoise/client';
import { OsActionsProvider, type PerformOsAction } from './os-actions';
import { OsDeliveries, type OsDeliverySource } from './os-deliveries';
import { ShownProvenance } from './os-provenance';
import { nativeScreenForCapability, type NativeApplicationScreens } from './screens';
import { SessionProvider, type PluginServices } from './session';

/** Width from which tabs move to a rail on the left: a tablet, or a large phone in landscape. */
export const RAIL_WIDTH = 768;
const TABS = '(tabs)';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const ScreensContext = createContext<NativeApplicationScreens | undefined>(undefined);

/** Open a screen by path, whether it is a tab or a pushed screen. */
function openScreen(
  navigation: Pick<NavigationProp<ParamListBase>, 'navigate'>,
  screens: NativeApplicationScreens,
  to: string,
  params?: Record<string, unknown>,
) {
  if (screens.navigation.some((item) => item.to === to))
    navigation.navigate(TABS, { screen: to, params });
  else navigation.navigate(to, params);
}

function Tabs({ screens }: { screens: NativeApplicationScreens }) {
  const { width } = useWindowDimensions();
  const byPath = new Map(screens.routes.map((route) => [route.path, route]));
  return (
    <Tab.Navigator
      initialRouteName={screens.home}
      screenOptions={{ tabBarPosition: width >= RAIL_WIDTH ? 'left' : 'bottom' }}
    >
      {screens.navigation.map((item) => {
        const route = byPath.get(item.to)!;
        return (
          <Tab.Screen
            key={item.to}
            name={item.to}
            component={route.component}
            options={{
              title: route.title ?? item.label,
              tabBarLabel: item.label,
              headerShown: route.title !== undefined,
              tabBarIcon: ({ color, size }) => <item.icon color={color} size={size} />,
            }}
          />
        );
      })}
    </Tab.Navigator>
  );
}

/**
 * The native frame for one application. Tabs carry the navigation items, at the bottom on phones
 * and as a rail on tablets; every other screen is pushed on a stack above them. The status slot
 * renders above every screen. The session (query cache and live invalidation) follows `transport`.
 * With `os`, what OS requests asked for opens once navigation is ready, under a notice that says
 * where it came from. With `osActions`, screens ask for OS actions through `useOsAction`.
 */
export function NativeFrame({
  screens,
  transport,
  services,
  os,
  osActions,
}: {
  screens: NativeApplicationScreens;
  transport: Transport;
  /** The instance's plugin services, for plugin screens that drive their own plugin. */
  services?: PluginServices;
  /** Deliveries from the mobile host's OS connection. */
  os?: OsDeliverySource;
  /** The same connection's `perform`, for `useOsAction`. */
  osActions?: PerformOsAction;
}) {
  const tabs = useMemo(() => new Set(screens.navigation.map((item) => item.to)), [screens]);
  const navigation = useMemo(() => createNavigationContainerRef<ParamListBase>(), []);
  const [ready, setReady] = useState(false);
  const open = useMemo(
    () => (to: string, params?: Record<string, unknown>) =>
      openScreen(navigation, screens, to, params),
    [navigation, screens],
  );
  const Status = screens.status;
  return (
    <SafeAreaProvider>
      <SessionProvider transport={transport} {...(services ? { services } : {})}>
        <OsActionsProvider {...(osActions ? { perform: osActions } : {})}>
          <ScreensContext.Provider value={screens}>
            <SafeAreaView edges={['top']} style={{ flex: 1 }}>
              {Status ? <Status /> : null}
              {os ? <ShownProvenance /> : null}
              {os && ready ? <OsDeliveries source={os} screens={screens} open={open} /> : null}
              <View style={{ flex: 1 }}>
                <NavigationContainer ref={navigation} onReady={() => setReady(true)}>
                  <Stack.Navigator>
                    <Stack.Screen name={TABS} options={{ headerShown: false }}>
                      {() => <Tabs screens={screens} />}
                    </Stack.Screen>
                    {screens.routes
                      .filter((route) => !tabs.has(route.path))
                      .map((route) => (
                        <Stack.Screen
                          key={route.path}
                          name={route.path}
                          component={route.component}
                          options={{ title: route.title, headerShown: route.title !== undefined }}
                        />
                      ))}
                  </Stack.Navigator>
                </NavigationContainer>
              </View>
            </SafeAreaView>
          </ScreensContext.Provider>
        </OsActionsProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/** The screens the surrounding `NativeFrame` renders. */
export function useNativeScreens(): NativeApplicationScreens {
  const screens = useContext(ScreensContext);
  if (!screens) throw new Error('useNativeScreens needs a NativeFrame');
  return screens;
}

/**
 * Open screens by path, so a screen need not know whether its target is a tab or a pushed screen.
 * `openCapability` opens the screen bound to a capability id and returns false when none is.
 */
export function useFrameNavigation() {
  const screens = useNativeScreens();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  return useMemo(() => {
    const open = (to: string, params?: Record<string, unknown>) =>
      openScreen(navigation, screens, to, params);
    return {
      open,
      openCapability(id: string, params?: Record<string, unknown>) {
        const to = nativeScreenForCapability(screens, id);
        if (to) open(to, params);
        return to !== undefined;
      },
    };
  }, [screens, navigation]);
}
