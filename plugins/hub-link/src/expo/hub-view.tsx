import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '@tortoise/frame-native/components/status-pill';
import { useSession } from '@tortoise/frame-native/session';
import { hubPageAllows, type HubLaunch } from '../attached';
import { hubLinkOperations as ops } from '../contracts';
import type { HubLinkService } from '../pairing';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** A hub page asking for a new window gets none; the view stays on the page it is on. */
const refuseWindow = (): void => undefined;

function Notice({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <StatusPill signal={onRetry ? 'attention' : 'idle'} label={label} />
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          className="min-h-target items-center justify-center rounded-xl bg-primary px-4"
        >
          <Text className="text-operator font-semibold text-primary-foreground">Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The hub's own web screens on a tablet paired as `attached`. Each mount asks the hub for a fresh
 * launch key, so the page always matches the hub's version and the session ends with the view.
 *
 * The web view is locked to the hub: loads off its origin are refused rather than handed to the
 * system browser, new windows are not opened, there is no script bridge or injected script, file
 * access is off, mixed content is refused, cookies live in a private store that is not shared with
 * the app or other views, and camera access for a hub page is asked for each time.
 */
function HubView() {
  const { live, services } = useSession();
  const hub = services['hub-link'] as HubLinkService | undefined;
  const status = useQuery(live.liveQueryOptions(ops.pairingGet, {}));
  const pairing = status.data?.pairing;
  const attached = pairing?.kind === 'attached';
  const [page, setPage] = useState<HubLaunch | { error: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hub || !attached) return;
    let cancelled = false;
    setPage(undefined);
    hub.launch().then(
      (launch) => !cancelled && setPage(launch),
      (error: unknown) => !cancelled && setPage({ error: message(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [hub, attached, pairing?.deviceId, attempt]);

  const retry = () => setAttempt((count) => count + 1);
  if (!hub) return <Notice label="Pairing is not available in this app" />;
  if (!attached)
    return <Notice label="Pair this device with a hub as a tablet to open its screens" />;
  if (!page) return <ActivityIndicator size="large" accessibilityLabel="Opening the hub" />;
  if ('error' in page) return <Notice label={page.error} onRetry={retry} />;
  return (
    <WebView
      key={page.url}
      source={{ uri: page.url }}
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={(request): boolean => hubPageAllows(request.url, page.origin)}
      onOpenWindow={refuseWindow}
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      mediaCapturePermissionGrantType="prompt"
      renderError={() => <Notice label="The hub could not be reached" onRetry={retry} />}
    />
  );
}

export { HubView };
