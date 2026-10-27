import { createHash } from 'node:crypto';
import type { AccessibilityNode, Frame, Region, ScreenAction, ScreenTransport } from '../ports';

/**
 * The subset of a Playwright `Page` this transport uses. Declared structurally so the station
 * package does not depend on Playwright; pass a real page from `playwright` or `@playwright/test`.
 */
export interface PlaywrightPageLike {
  viewportSize(): { width: number; height: number } | null;
  screenshot(options: {
    type: 'png';
    animations?: 'disabled';
    caret?: 'hide';
  }): Promise<Uint8Array>;
  ariaSnapshotJSON(options: { boxes: boolean }): Promise<unknown>;
  mouse: { click(x: number, y: number): Promise<void> };
  keyboard: { type(text: string): Promise<void>; press(key: string): Promise<void> };
}

export interface PlaywrightTransportOptions {
  readonly id?: string;
  readonly page: PlaywrightPageLike;
  /** Include PNG pixels in frames (needed by OCR and vision extractors). */
  readonly pixels?: boolean;
  /**
   * How the station reports local input, when it can (a simulator endpoint, an input hook on the
   * station PC). Without it the control holder is the only guard against a person at the station.
   */
  readonly localInputSince?: (since: number, signal: AbortSignal) => Promise<boolean>;
  readonly now?: () => number;
}

function toRegion(value: unknown): Region | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part))
    ? { x: x as number, y: y as number, width: width as number, height: height as number }
    : undefined;
}

/** Map Playwright's aria snapshot JSON (nodes, or bare strings for text) to accessibility nodes. */
export function toAccessibility(value: unknown): AccessibilityNode[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.flatMap((item): AccessibilityNode[] => {
    if (typeof item === 'string') return [{ role: 'text', text: item }];
    if (!item || typeof item !== 'object') return [];
    const node = item as Record<string, unknown>;
    if (typeof node.role !== 'string') return [];
    const children = toAccessibility(node.children);
    const box = toRegion(node.box);
    return [
      {
        role: node.role,
        ...(typeof node.name === 'string' && node.name ? { name: node.name } : {}),
        ...(typeof node.text === 'string' ? { text: node.text } : {}),
        ...(box ? { box } : {}),
        ...(children.length ? { children } : {}),
      },
    ];
  });
}

/**
 * Screen transport over a browser page: the fake HMI in tests, and a real adapter for station
 * software that is itself a web application. Coordinates are viewport CSS pixels. Other
 * transports (VNC, RDP, KVM-over-IP, Windows UI Automation) implement the same port.
 */
export function createPlaywrightTransport(options: PlaywrightTransportOptions): ScreenTransport {
  const { page } = options;
  const now = options.now ?? Date.now;
  return {
    id: options.id ?? 'playwright',
    async capture(): Promise<Frame> {
      const capturedAt = now();
      const viewport = page.viewportSize() ?? { width: 0, height: 0 };
      const accessibility = toAccessibility(await page.ariaSnapshotJSON({ boxes: true }));
      const image = options.pixels
        ? await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' })
        : undefined;
      // Identical pixels and tree give the same digest, which keys fixtures and golden frames.
      const hash = createHash('sha256').update(JSON.stringify(accessibility));
      if (image) hash.update(image);
      return {
        capturedAt,
        width: viewport.width,
        height: viewport.height,
        digest: hash.digest('hex'),
        accessibility,
        ...(image ? { image } : {}),
      };
    },
    async act(action: ScreenAction) {
      if (action.kind === 'click') await page.mouse.click(action.point.x, action.point.y);
      else if (action.kind === 'type') await page.keyboard.type(action.text);
      else await page.keyboard.press(action.key);
    },
    ...(options.localInputSince ? { localInputSince: options.localInputSince } : {}),
  };
}
