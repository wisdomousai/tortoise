/**
 * Ports between the station bridge and the outside world. The bridge never talks to station
 * software any other way: a `ScreenTransport` sees and touches the screen, `Extractor`s turn a
 * frame into readings, and a `ComputerUseDriver` may help find targets. None of them write
 * application state; observations and outcomes return through catalog commands.
 */
import type { Extractor as ObservationExtractor } from '@tortoise/observation';

/** Screen rectangle in transport pixels (CSS pixels for browser transports). */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * One node of the screen's accessibility tree, when the transport can read it (browser ARIA,
 * Windows UI Automation, AT-SPI). `text` is the node's own text content or value.
 */
export interface AccessibilityNode {
  readonly role: string;
  readonly name?: string;
  readonly text?: string;
  readonly box?: Region;
  readonly children?: readonly AccessibilityNode[];
}

/** One capture of the station screen. `digest` identifies identical pixels and tree. */
export interface Frame {
  readonly capturedAt: number;
  readonly width: number;
  readonly height: number;
  readonly digest: string;
  /** PNG bytes; absent for transports that only expose an accessibility tree. */
  readonly image?: Uint8Array;
  readonly accessibility?: readonly AccessibilityNode[];
}

export type ScreenAction =
  | { readonly kind: 'click'; readonly point: Point }
  | { readonly kind: 'type'; readonly text: string }
  | { readonly kind: 'key'; readonly key: string };

/**
 * Sees and touches one station screen: a browser page, a VNC or RDP session, a KVM-over-IP
 * device, or a local UI Automation session. Implementations hold their connection details; the
 * bridge passes only actions that passed the controller gate.
 */
export interface ScreenTransport {
  readonly id: string;
  capture(signal: AbortSignal): Promise<Frame>;
  act(action: ScreenAction, signal: AbortSignal): Promise<void>;
  /**
   * Whether a person used the station's own keyboard, mouse or touch since `since` (transport
   * clock). Transports that cannot tell omit it; the control holder is then the only guard.
   */
  localInputSince?(since: number, signal: AbortSignal): Promise<boolean>;
}

export type { FieldValue, ModelIdentity, RawReading } from '@tortoise/observation';

export interface ExtractionField {
  readonly id: string;
  readonly type: 'number' | 'text' | 'enum' | 'boolean';
  readonly region?: Region;
  readonly locator?: { readonly role: string; readonly name: string };
  readonly unit?: string;
  readonly decimals?: number;
  readonly options?: readonly string[];
  readonly hint?: string;
}

/**
 * Turns a frame into readings for the requested fields: accessibility lookup, OCR, a vision
 * model, a classifier or an audio model. The observation package's extractor, over screen
 * captures and screen fields.
 */
export type Extractor = ObservationExtractor<
  Frame,
  ExtractionField,
  'accessibility' | 'ocr' | 'vision' | 'classifier' | 'audio' | 'fixture'
>;

/** A target a procedure step names: an accessibility locator, a fixed region or a description. */
export type StepTarget =
  | { readonly locator: { readonly role: string; readonly name: string } }
  | { readonly region: Region }
  | { readonly describe: string };

/**
 * Finds where a step's target is on the current frame. It only suggests coordinates: the
 * controller checks them against forbidden regions and the expected screen before acting, so a
 * driver (scripted, cloud or local computer-use model) can never act on its own.
 */
export interface ComputerUseDriver {
  readonly id: string;
  resolveTarget(frame: Frame, target: StepTarget, signal: AbortSignal): Promise<Point | undefined>;
}
