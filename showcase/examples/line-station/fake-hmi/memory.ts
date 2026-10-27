import { createHash } from 'node:crypto';
import type {
  AccessibilityNode,
  Extractor,
  Frame,
  ScreenTransport,
} from '@agent-native/screen-bridge';
import { HEIGHT, LAYOUT, WIDTH, type HmiSimulator } from './simulator';

/**
 * The accessibility tree the simulator page exposes, built from the same state and layout.
 * Counters are canvas-only on the page, so they are absent here, as they are for the browser.
 */
export function accessibilityOf(sim: HmiSimulator): AccessibilityNode[] {
  const state = sim.tick();
  const button = (name: string, box: (typeof LAYOUT)[keyof typeof LAYOUT]): AccessibilityNode => ({
    role: 'button',
    name,
    box,
  });
  if (state.screen === 'popup')
    return [
      {
        role: 'dialog',
        name: 'Maintenance due',
        box: LAYOUT.popup,
        children: [button('OK', LAYOUT.popupOk)],
      },
    ];
  if (state.screen === 'recipe')
    return [
      {
        role: 'dialog',
        name: 'Load recipe',
        box: LAYOUT.dialog,
        children: [
          { role: 'textbox', name: 'Recipe', text: state.draft, box: LAYOUT.input },
          button('Confirm', LAYOUT.confirm),
          button('Cancel', LAYOUT.cancel),
        ],
      },
    ];
  return [
    { role: 'heading', name: 'Filler 1 overview', box: LAYOUT.title },
    { role: 'status', name: 'Machine state', text: state.machine, box: LAYOUT.machine },
    { role: 'status', name: 'Loaded recipe', text: state.recipe, box: LAYOUT.recipe },
    { role: 'status', name: 'Alarm', text: state.alarm, box: LAYOUT.alarm },
    button('Load recipe', LAYOUT.load),
    button('Start', LAYOUT.start),
    button('Stop', LAYOUT.stop),
    button('Jog', LAYOUT.jog),
    button('Reset e-stop', LAYOUT.estop),
  ];
}

/** Screen transport straight onto the simulator, for deterministic tests without a browser. */
export function createSimulatorTransport(
  sim: HmiSimulator,
  now: () => number = Date.now,
): ScreenTransport {
  return {
    id: 'simulator',
    async capture(): Promise<Frame> {
      const accessibility = accessibilityOf(sim);
      const { good, scrap } = sim.state;
      return {
        capturedAt: now(),
        width: WIDTH,
        height: HEIGHT,
        // Pixels change with the counters even when the tree does not.
        digest: createHash('sha256')
          .update(JSON.stringify({ accessibility, good, scrap }))
          .digest('hex'),
        accessibility,
      };
    },
    async act(action) {
      if (action.kind === 'click') {
        const control = sim.hit(action.point.x, action.point.y);
        if (control) sim.press(control);
      } else if (action.kind === 'type') sim.type(action.text);
      else sim.key(action.key);
      sim.afterAction();
    },
    async localInputSince(since) {
      return sim.state.localInputAt !== undefined && sim.state.localInputAt >= since;
    },
  };
}

/**
 * Stand-in for an OCR model reading the canvas-only counters, for tests and the demo: it reads
 * the simulator's ground truth and reports the confidence the test sets. Real deployments use
 * the worker or vision extractors and calibrate them with golden frames.
 */
export function createSimulatorOcr(
  read: () => Promise<{ good: number; scrap: number }> | { good: number; scrap: number },
  control: { confidence: number; misread?: number } = { confidence: 0.98 },
): Extractor {
  return {
    id: 'counter-ocr',
    modality: 'ocr',
    model: { id: 'simulator-ocr', version: '1' },
    async extract(_frame, fields) {
      const counters = await read();
      return fields.flatMap((field) =>
        field.id === 'good' || field.id === 'scrap'
          ? [
              {
                field: field.id,
                value:
                  field.id === 'good' && control.misread !== undefined
                    ? control.misread
                    : counters[field.id],
                confidence: control.confidence,
              },
            ]
          : [],
      );
    },
  };
}
