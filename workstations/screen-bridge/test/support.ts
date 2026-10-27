import type { Effect } from '@agent-native/runtime';
import type {
  AccessibilityNode,
  Extractor,
  Frame,
  Point,
  Region,
  ScreenAction,
  ScreenTransport,
} from '../src/ports';
import { contains, parseProfile, type StationProfile } from '../src/profile';

/**
 * In-memory station software for unit tests: a main screen with machine state and loaded recipe,
 * a recipe dialog, an optional vendor popup, a forbidden e-stop reset and local input.
 */
export function createHmi() {
  const state = {
    machine: 'STOPPED' as 'STOPPED' | 'RUNNING' | 'ALARM',
    recipe: 'R-10',
    count: 1200,
    screen: 'main' as 'main' | 'recipe' | 'popup',
    draft: '',
    focus: undefined as string | undefined,
    /** Show the popup after this many more actions. */
    popupAfter: undefined as number | undefined,
    /** Pretend someone used the station keyboard after this many more actions. */
    localInputAfter: undefined as number | undefined,
    localInputAt: undefined as number | undefined,
    /** The dialog accepts a confirm without loading the recipe. */
    swallowConfirm: false,
    estopResets: 0,
    clock: 1_000,
    actions: [] as ScreenAction[],
  };
  const boxes = {
    load: { x: 800, y: 80, width: 160, height: 48 },
    estop: { x: 800, y: 680, width: 160, height: 48 },
    input: { x: 300, y: 300, width: 400, height: 40 },
    confirm: { x: 300, y: 400, width: 160, height: 48 },
    popupOk: { x: 450, y: 450, width: 120, height: 48 },
  } satisfies Record<string, Region>;
  const node = (
    role: string,
    name: string,
    extra: Partial<AccessibilityNode> = {},
  ): AccessibilityNode => ({
    role,
    name,
    ...extra,
  });

  function tree(): AccessibilityNode[] {
    if (state.screen === 'popup')
      return [
        node('dialog', 'Maintenance due', {
          children: [node('button', 'OK', { box: boxes.popupOk })],
        }),
      ];
    if (state.screen === 'recipe')
      return [
        node('dialog', 'Load recipe', {
          children: [
            node('textbox', 'Recipe', { text: state.draft, box: boxes.input }),
            node('button', 'Confirm', { box: boxes.confirm }),
          ],
        }),
      ];
    return [
      node('heading', 'Line 1 overview'),
      node('status', 'Machine state', { text: state.machine }),
      node('status', 'Loaded recipe', { text: state.recipe }),
      node('button', 'Load recipe', { box: boxes.load }),
      node('button', 'Reset e-stop', { box: boxes.estop }),
    ];
  }

  const at = (box: Region, point: Point) => contains(box, point);
  function apply(action: ScreenAction) {
    state.actions.push(action);
    if (action.kind === 'click') {
      const { point } = action;
      if (state.screen === 'popup') {
        if (at(boxes.popupOk, point)) state.screen = 'main';
        return;
      }
      if (state.screen === 'main') {
        if (at(boxes.load, point) && state.machine === 'STOPPED') {
          state.screen = 'recipe';
          state.draft = '';
        }
        if (at(boxes.estop, point)) state.estopResets++;
        return;
      }
      if (at(boxes.input, point)) state.focus = 'input';
      if (at(boxes.confirm, point)) {
        if (!state.swallowConfirm) state.recipe = state.draft;
        state.screen = 'main';
      }
      return;
    }
    if (action.kind === 'type' && state.screen === 'recipe' && state.focus === 'input')
      state.draft += action.text;
  }

  let digest = 0;
  const transport: ScreenTransport = {
    id: 'memory',
    async capture(): Promise<Frame> {
      state.clock += 10;
      const accessibility = tree();
      return {
        capturedAt: state.clock,
        width: 1024,
        height: 768,
        digest: `${JSON.stringify(accessibility)}#${state.count}`.padEnd(32, '.') + ++digest,
        accessibility,
      };
    },
    async act(action) {
      state.clock += 10;
      apply(action);
      if (state.popupAfter !== undefined && --state.popupAfter <= 0) {
        state.popupAfter = undefined;
        state.screen = 'popup';
      }
      if (state.localInputAfter !== undefined && --state.localInputAfter <= 0) {
        state.localInputAfter = undefined;
        state.localInputAt = state.clock;
      }
    },
    async localInputSince(since) {
      return state.localInputAt !== undefined && state.localInputAt >= since;
    },
  };
  return { state, boxes, transport };
}

/** Pixel-only counter read by a "model" whose confidence the test controls. */
export function createCounterModel(hmi: ReturnType<typeof createHmi>) {
  const control = { confidence: 0.97, misread: undefined as number | undefined };
  const extractor: Extractor = {
    id: 'ocr',
    modality: 'ocr',
    model: { id: 'test-ocr', version: '1' },
    async extract(_frame, fields) {
      return fields
        .filter((field) => field.id === 'count')
        .map((field) => ({
          field: field.id,
          value: control.misread ?? hmi.state.count,
          confidence: control.confidence,
        }));
    },
  };
  return { control, extractor };
}

export const profileDocument = {
  schemaVersion: 1,
  id: 'line-hmi',
  version: '1.0.0',
  application: { name: 'Line HMI', versions: ['4.2'] },
  screens: [
    { id: 'main', anchors: [{ role: 'heading', name: 'Line 1 overview' }] },
    { id: 'recipe', anchors: [{ role: 'dialog', name: 'Load recipe' }] },
  ],
  fields: [
    {
      id: 'machine',
      screen: 'main',
      type: 'enum',
      options: ['STOPPED', 'RUNNING', 'ALARM'],
      locator: { role: 'status', name: 'Machine state' },
      extractor: 'accessibility',
      stableReads: 1,
    },
    {
      id: 'recipe',
      screen: 'main',
      type: 'text',
      locator: { role: 'status', name: 'Loaded recipe' },
      extractor: 'accessibility',
      stableReads: 1,
    },
    {
      id: 'count',
      screen: 'main',
      type: 'number',
      decimals: 0,
      region: { x: 40, y: 200, width: 200, height: 60 },
      extractor: 'ocr',
      minConfidence: 0.9,
      stableReads: 2,
    },
  ],
  forbidden: [
    {
      id: 'estop-reset',
      reason: 'Safety function',
      region: { x: 780, y: 660, width: 200, height: 88 },
    },
  ],
  procedures: [
    {
      id: 'recipe.load',
      title: 'Load recipe',
      risk: 'operator-present',
      rerunnable: false,
      timeoutMs: 10_000,
      maxSteps: 6,
      startScreen: 'main',
      preconditions: [{ field: 'machine', equals: 'STOPPED' }],
      steps: [
        { kind: 'click', target: { locator: { role: 'button', name: 'Load recipe' } } },
        { kind: 'wait-for', screen: 'recipe', timeoutMs: 1_000 },
        { kind: 'click', target: { locator: { role: 'textbox', name: 'Recipe' } } },
        { kind: 'type', text: '$input.recipe' },
        { kind: 'click', target: { locator: { role: 'button', name: 'Confirm' } } },
        { kind: 'wait-for', screen: 'main', timeoutMs: 1_000 },
      ],
      readback: [{ field: 'recipe', equals: '$input.recipe' }],
    },
  ],
};

export const profile: StationProfile = parseProfile(profileDocument);

export function effect(payload: unknown, overrides: Partial<Effect> = {}): Effect {
  return {
    id: 'e1',
    target: 'legacy-hmi',
    type: 'recipe.load',
    resource: 'station:1',
    payload,
    operation: 'line.order.start',
    principalId: 'operator',
    createdAt: 0,
    status: 'pending',
    attempts: 0,
    ...overrides,
  } as Effect;
}
