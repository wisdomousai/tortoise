/**
 * Deterministic simulator of proprietary station software: a winder HMI with a fixed 1024×768
 * layout, a STOPPED/RUNNING/ALARM state machine, counters, a recipe dialog and a vendor popup.
 * The browser page (server.ts) and the in-memory transport (memory.ts) render the same state
 * and layout, so unit tests and end-to-end tests exercise one behavior. It has no API for the
 * application: the bridge sees it only through its screen.
 */
export type Machine = 'STOPPED' | 'RUNNING' | 'ALARM';
export type Screen = 'main' | 'recipe' | 'popup';
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const WIDTH = 1024;
export const HEIGHT = 768;
/** Element positions shared by the page and the in-memory transport. */
export const LAYOUT = {
  title: { x: 24, y: 16, width: 600, height: 40 },
  machine: { x: 24, y: 80, width: 300, height: 48 },
  recipe: { x: 24, y: 144, width: 300, height: 40 },
  alarm: { x: 24, y: 200, width: 560, height: 40 },
  counters: { x: 24, y: 280, width: 560, height: 200 },
  load: { x: 800, y: 80, width: 200, height: 56 },
  start: { x: 800, y: 160, width: 200, height: 56 },
  stop: { x: 800, y: 240, width: 200, height: 56 },
  jog: { x: 800, y: 560, width: 200, height: 56 },
  estop: { x: 800, y: 680, width: 200, height: 56 },
  dialog: { x: 262, y: 220, width: 500, height: 300 },
  input: { x: 292, y: 300, width: 440, height: 48 },
  confirm: { x: 292, y: 420, width: 200, height: 56 },
  cancel: { x: 532, y: 420, width: 200, height: 56 },
  popup: { x: 312, y: 260, width: 400, height: 220 },
  popupOk: { x: 452, y: 400, width: 120, height: 56 },
} as const satisfies Record<string, Box>;
export type Control =
  'load' | 'start' | 'stop' | 'jog' | 'estop' | 'input' | 'confirm' | 'cancel' | 'popupOk';

export interface HmiState {
  machine: Machine;
  alarm: string;
  recipe: string;
  good: number;
  scrap: number;
  screen: Screen;
  draft: string;
  focus?: 'input';
  /** Last time someone used the station's own keyboard or mouse (simulated). */
  localInputAt?: number;
  /** Show the vendor popup after this many more bridge actions (test fault). */
  popupAfter?: number;
  estopResets: number;
  jogs: number;
}

const contains = (box: Box, x: number, y: number) =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

export class HmiSimulator {
  readonly state: HmiState = {
    machine: 'RUNNING',
    alarm: '',
    recipe: 'R-250',
    good: 4210,
    scrap: 37,
    screen: 'main',
    draft: '',
    estopResets: 0,
    jogs: 0,
  };
  private lastTick: number;
  private produced = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.lastTick = now();
  }

  /**
   * Advance production at demo speed, faster than a real winder: two good coils per second while
   * running, one scrap per 40.
   */
  tick(): HmiState {
    const at = this.now();
    if (this.state.machine === 'RUNNING') {
      const parts = Math.floor(((at - this.lastTick) / 1_000) * 2);
      if (parts > 0) {
        for (let index = 0; index < parts; index++) {
          this.produced++;
          if (this.produced % 40 === 0) this.state.scrap++;
          else this.state.good++;
        }
        this.lastTick += (parts / 2) * 1_000;
      }
    } else this.lastTick = at;
    return this.state;
  }

  /** Which control a screen point hits on the current screen; modal screens block the rest. */
  hit(x: number, y: number): Control | undefined {
    const candidates: Control[] =
      this.state.screen === 'popup'
        ? ['popupOk']
        : this.state.screen === 'recipe'
          ? ['input', 'confirm', 'cancel']
          : ['load', 'start', 'stop', 'jog', 'estop'];
    return candidates.find((control) => contains(LAYOUT[control], x, y));
  }

  /** Whether a control is enabled; disabled controls ignore presses, like the real software. */
  enabled(control: Control): boolean {
    const { machine } = this.state;
    if (control === 'load') return machine === 'STOPPED';
    if (control === 'start') return machine === 'STOPPED';
    if (control === 'stop') return machine === 'RUNNING';
    if (control === 'jog') return machine !== 'RUNNING';
    return true;
  }

  press(control: Control): void {
    this.tick();
    if (!this.enabled(control)) return;
    const state = this.state;
    switch (control) {
      case 'load':
        state.screen = 'recipe';
        state.draft = '';
        state.focus = undefined;
        break;
      case 'start':
        state.machine = 'RUNNING';
        state.alarm = '';
        break;
      case 'stop':
        state.machine = 'STOPPED';
        break;
      case 'jog':
        state.jogs++;
        break;
      case 'estop':
        state.estopResets++;
        if (state.machine === 'ALARM') {
          state.machine = 'STOPPED';
          state.alarm = '';
        }
        break;
      case 'input':
        state.focus = 'input';
        break;
      case 'confirm':
        if (/^R-\d{3}$/.test(state.draft.trim())) state.recipe = state.draft.trim();
        state.screen = 'main';
        state.focus = undefined;
        break;
      case 'cancel':
        state.screen = 'main';
        state.focus = undefined;
        break;
      case 'popupOk':
        state.screen = 'main';
        break;
    }
  }

  /** Text typed into the focused field. */
  type(text: string): void {
    if (this.state.screen === 'recipe' && this.state.focus === 'input') this.state.draft += text;
  }
  setDraft(text: string): void {
    if (this.state.screen === 'recipe') this.state.draft = text.slice(0, 32);
  }
  key(key: string): void {
    if (this.state.screen === 'recipe' && this.state.focus === 'input') {
      if (key === 'Backspace') this.state.draft = this.state.draft.slice(0, -1);
      if (key === 'Enter') this.press('confirm');
    }
    if (key === 'Escape' && this.state.screen !== 'main') this.state.screen = 'main';
  }

  /** Called after each bridge action; drives the scheduled popup fault. */
  afterAction(): void {
    if (this.state.popupAfter !== undefined && --this.state.popupAfter <= 0) {
      this.state.popupAfter = undefined;
      this.state.screen = 'popup';
    }
  }

  // Simulated events at the station, used by tests and the demo.
  raiseAlarm(text: string): void {
    this.tick();
    this.state.machine = 'ALARM';
    this.state.alarm = text.slice(0, 120);
  }
  stopMachine(): void {
    this.tick();
    this.state.machine = 'STOPPED';
  }
  startMachine(): void {
    this.tick();
    this.state.machine = 'RUNNING';
    this.state.alarm = '';
  }
  showPopup(afterActions = 0): void {
    if (afterActions > 0) this.state.popupAfter = afterActions;
    else this.state.screen = 'popup';
  }
  localInput(): void {
    this.state.localInputAt = this.now();
  }
}
