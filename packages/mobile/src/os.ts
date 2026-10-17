import { ApplicationError, type OsDelivery } from '@agent-native/contracts';
import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
import {
  createMobileShell,
  type MobileFileInfo,
  type MobileShare,
} from '@agent-native/shell/mobile';
import type { MobileAuthority } from './authority';

/** The device's link and file calls; the Expo bindings are `expoOsBindings`. */
export interface MobileOsBindings {
  readonly platform: 'android' | 'ios';
  /** The application's URL scheme, from its identity. */
  readonly scheme: string;
  /** The URI the app was launched with, if any. */
  initialUri(): Promise<string | null>;
  /** Each URI the OS hands the running app, until the returned function is called. */
  subscribe(listener: (uri: string) => void): () => void;
  inspect(uri: string): Promise<MobileFileInfo | undefined>;
  read(uri: string, maxBytes: number): Promise<Uint8Array | undefined>;
  open(url: string): Promise<void>;
  /** The items a URI announces another app shared; absent, the app receives no shares. */
  shared?(uri: string): Promise<readonly MobileShare[] | undefined>;
  /** Show the system share sheet; absent, share actions are refused. */
  share?(content: { text?: string; url?: string; title?: string }): Promise<void>;
  report?(message: string): void;
}

/** Deliveries waiting for the frame; beyond this the oldest is dropped. */
const bufferLimit = 16;

/**
 * An opened resource must be readable now, as on the Bun host: its kind names a selectable
 * resource and the device's owner may run that kind's read query for it.
 */
async function assertReadable(
  opened: MobileAuthority,
  definition: AnyApplicationDefinition,
  delivery: OsDelivery,
) {
  if (delivery.type !== 'openResource') return;
  const [kind = '', ...rest] = delivery.resource.split(':');
  const selectable = definition.selectableResources ?? {};
  const operation = Object.hasOwn(selectable, kind) ? selectable[kind] : undefined;
  if (!operation || !rest.length)
    throw new ApplicationError('INVALID_INPUT', 'Unknown selected resource type');
  await opened.authority.application.queryRaw(
    { operation, input: { id: rest.join(':') } },
    opened.context,
  );
}

/**
 * Connect the device's OS integration to the authority: links and files the OS opens the app
 * with are submitted to the shell port as the device's owner, what the port delivers waits for
 * the frame's subscription once an opened resource is checked readable, and the port's actions
 * run through this device. The OS runs in this process, so the adapter attaches directly
 * instead of over HTTP.
 *
 * Without a plugin that provides the shell port, nothing is attached or submitted: the returned
 * connection delivers nothing. An unsolicited request still only opens or prefills; a person
 * commits through the screen it opens.
 */
export function connectMobileShell(
  opened: MobileAuthority,
  definition: AnyApplicationDefinition,
  bindings: MobileOsBindings,
) {
  const { authority, context } = opened;
  const port = authority.ports.shell;
  let waiting: OsDelivery[] = [];
  const listeners = new Set<(delivery: OsDelivery) => void>();
  const show = (delivery: OsDelivery) => {
    if (listeners.size) for (const listener of listeners) listener(delivery);
    else waiting = [...waiting, delivery].slice(-bufferLimit);
  };
  const deliver = (delivery: OsDelivery) =>
    void assertReadable(opened, definition, delivery).then(
      () => show(delivery),
      () => bindings.report?.('The opened resource is not readable'),
    );
  const shell = createMobileShell({
    platform: bindings.platform,
    scheme: bindings.scheme,
    declarations: () => authority.application.catalog.os ?? { handlers: [], actions: [] },
    inspect: (uri) => bindings.inspect(uri),
    read: (uri, maxBytes) => bindings.read(uri, maxBytes),
    upload: (bytes, mediaType) => authority.application.putBlob(bytes, mediaType, context),
    submit: (request) => port.receive(context, request, bindings.platform),
    deliver,
    open: (url) => bindings.open(url),
    ...(bindings.shared ? { shared: (uri: string) => bindings.shared!(uri) } : {}),
    ...(bindings.share
      ? {
          share: (content: Parameters<NonNullable<MobileOsBindings['share']>>[0]) =>
            bindings.share!(content),
        }
      : {}),
    ...(bindings.report ? { report: (message: string) => bindings.report!(message) } : {}),
  });
  let detach: (() => void) | undefined;
  try {
    detach = port.attach(context, shell);
  } catch {
    // No shell port: the application composes no OS plugin.
    return { deliveries: { subscribe: () => () => undefined }, close: () => undefined };
  }
  const unsubscribe = bindings.subscribe((uri) => void shell.receive(uri));
  void bindings
    .initialUri()
    .then((uri) => (uri ? shell.receive(uri) : undefined))
    .catch(() => undefined);
  return {
    /** What the frame shows; deliveries that arrived before the first subscriber are replayed. */
    deliveries: {
      subscribe(listener: (delivery: OsDelivery) => void) {
        listeners.add(listener);
        const pending = waiting;
        waiting = [];
        for (const delivery of pending) listener(delivery);
        return () => void listeners.delete(listener);
      },
    },
    close() {
      unsubscribe();
      detach?.();
      listeners.clear();
    },
  };
}
export type MobileOsConnection = ReturnType<typeof connectMobileShell>;
