import { createContext, useContext, useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  NavigationContainer,
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Transport } from '@agent-native/client';
import { nativeScreenForCapability, type NativeApplicationScreens } from './screens';
import { SessionProvider } from './session';

/** Width from which tabs move to a rail on the left: a tablet, or a large phone in landscape. */
export const RAIL_WIDTH = 768;
const TABS = '(tabs)';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const ScreensContext = createContext<NativeApplicationScreens | undefined>(undefined);

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
 */
export function NativeFrame({
  screens,
  transport,
}: {
  screens: NativeApplicationScreens;
  transport: Transport;
}) {
  const tabs = useMemo(() => new Set(screens.navigation.map((item) => item.to)), [screens]);
  const Status = screens.status;
  return (
    <SafeAreaProvider>
      <SessionProvider transport={transport}>
        <ScreensContext.Provider value={screens}>
          <SafeAreaView edges={['top']} style={{ flex: 1 }}>
            {Status ? <Status /> : null}
            <View style={{ flex: 1 }}>
              <NavigationContainer>
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
    const tabs = new Set(screens.navigation.map((item) => item.to));
    const open = (to: string, params?: Record<string, unknown>) => {
      if (tabs.has(to)) navigation.navigate(TABS, { screen: to, params });
      else navigation.navigate(to, params);
    };
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
