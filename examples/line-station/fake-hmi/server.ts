import { HEIGHT, HmiSimulator, LAYOUT, WIDTH, type Control } from './simulator';

/**
 * The simulated station software as a separate process with a browser screen, for the demo and
 * end-to-end tests. The bridge reaches it only as a screen (Playwright transport). The page
 * exposes state fields through accessibility labels and draws counters on a canvas only, so the
 * pixel path (OCR, vision) is needed for them, as with real vendor software.
 *
 * `/__sim/*` endpoints simulate events at the machine (alarm, popup, local input) and expose
 * ground truth for the simulator OCR stand-in. They exist only with `simulationEndpoints` and are
 * never an application API.
 */
export interface FakeHmiOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly simulationEndpoints?: boolean;
  readonly now?: () => number;
}

const controls = new Set<Control>([
  'load',
  'start',
  'stop',
  'jog',
  'estop',
  'input',
  'confirm',
  'cancel',
  'popupOk',
]);

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const body = async (request: Request) =>
  (await request.json().catch(() => ({}))) as Record<string, unknown>;

/** The station page and the calls its own controls make; undefined for any other path. */
async function screenRoute(sim: HmiSimulator, request: Request, url: URL) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/')
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (request.method === 'GET' && path === '/state') {
    const state = sim.tick();
    return json({
      ...state,
      enabled: Object.fromEntries([...controls].map((control) => [control, sim.enabled(control)])),
    });
  }
  // The page's own controls. A bridge action is received here as a click on the page.
  if (request.method === 'POST' && path === '/press') {
    const { control } = await body(request);
    if (typeof control !== 'string' || !controls.has(control as Control))
      return json({ error: 'unknown control' }, 400);
    sim.press(control as Control);
    sim.afterAction();
    return json({ ok: true });
  }
  if (request.method === 'POST' && path === '/draft') {
    const { value } = await body(request);
    sim.setDraft(String(value ?? ''));
    return json({ ok: true });
  }
  if (request.method === 'POST' && path === '/key') {
    const { key } = await body(request);
    sim.key(String(key ?? ''));
    sim.afterAction();
    return json({ ok: true });
  }
  // Stand-in for an input hook on the station PC (keyboard/mouse use by a person there).
  if (request.method === 'GET' && path === '/local-input') {
    const since = Number(url.searchParams.get('since') ?? 0);
    return json({
      used: sim.state.localInputAt !== undefined && sim.state.localInputAt >= since,
    });
  }
  return undefined;
}

/** Events at the machine and ground truth, for tests and the OCR stand-in only. */
function simulationRoute(sim: HmiSimulator, path: string, input: Record<string, unknown>) {
  switch (path) {
    case '/__sim/counters':
      sim.tick();
      return json({ good: sim.state.good, scrap: sim.state.scrap });
    case '/__sim/alarm':
      sim.raiseAlarm(String(input.text ?? 'E-100 Machine alarm'));
      return json({ ok: true });
    case '/__sim/stop':
      sim.stopMachine();
      return json({ ok: true });
    case '/__sim/start':
      sim.startMachine();
      return json({ ok: true });
    case '/__sim/popup':
      sim.showPopup(Number(input.afterActions ?? 0));
      return json({ ok: true });
    case '/__sim/local-input':
      sim.localInput();
      return json({ ok: true });
    case '/__sim/state':
      return json(sim.tick());
  }
  return undefined;
}

export function startFakeHmi(options: FakeHmiOptions = {}) {
  const now = options.now ?? Date.now;
  const sim = new HmiSimulator(now);
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      const screen = await screenRoute(sim, request, url);
      if (screen) return screen;
      if (options.simulationEndpoints && url.pathname.startsWith('/__sim/')) {
        const input = request.method === 'POST' ? await body(request) : {};
        const simulated = simulationRoute(sim, url.pathname, input);
        if (simulated) return simulated;
      }
      return json({ error: 'not found' }, 404);
    },
  });
  return {
    url: `http://${server.hostname}:${server.port}`,
    sim,
    stop: () => server.stop(true),
  };
}

const box = (name: keyof typeof LAYOUT) => {
  const { x, y, width, height } = LAYOUT[name];
  return `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
};
const relative = (name: keyof typeof LAYOUT, parent: keyof typeof LAYOUT) => {
  const { x, y, width, height } = LAYOUT[name];
  return `left:${x - LAYOUT[parent].x}px;top:${y - LAYOUT[parent].y}px;width:${width}px;height:${height}px`;
};

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Filler HMI</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #c0c0c0; font: 16px Tahoma, Verdana, sans-serif; color: #000; }
  .abs { position: absolute; }
  h1 { margin: 0; font-size: 24px; line-height: 40px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .row > span { width: 64px; font-size: 14px; }
  .field { flex: 1; align-self: stretch; border: 2px inset #fff; background: #fff; padding: 0 8px; display: flex; align-items: center; font: bold 20px monospace; }
  .RUNNING { background: #3c3; } .STOPPED { background: #fc3; } .ALARM { background: #f33; color: #fff; }
  button { border: 2px outset #eee; background: #d4d0c8; font: 18px Tahoma, sans-serif; }
  button:disabled { color: #888; }
  #estop { background: #e00; color: #fff; font-weight: bold; }
  .modal { border: 2px outset #eee; background: #d4d0c8; box-shadow: 4px 4px 0 #555; }
  .modal h2 { margin: 0; padding: 6px 12px; background: #000080; color: #fff; font-size: 16px; }
  input { font: 20px monospace; border: 2px inset #fff; padding: 0 8px; }
  [hidden] { display: none !important; }
</style></head>
<body>
<main id="main">
  <h1 class="abs" style="${box('title')}">Filler 1 overview</h1>
  <div class="abs row" style="${box('machine')}"><span aria-hidden="true">State</span><div id="machine" class="field" role="status" aria-label="Machine state"></div></div>
  <div class="abs row" style="${box('recipe')}"><span aria-hidden="true">Recipe</span><div id="recipe" class="field" role="status" aria-label="Loaded recipe"></div></div>
  <div class="abs row" style="${box('alarm')}"><span aria-hidden="true">Alarm</span><div id="alarm" class="field" role="status" aria-label="Alarm"></div></div>
  <canvas id="counters" class="abs" aria-hidden="true" width="${LAYOUT.counters.width}" height="${LAYOUT.counters.height}" style="${box('counters')}"></canvas>
  <button id="load" class="abs" data-control="load" style="${box('load')}">Load recipe</button>
  <button id="start" class="abs" data-control="start" style="${box('start')}">Start</button>
  <button id="stop" class="abs" data-control="stop" style="${box('stop')}">Stop</button>
  <button id="jog" class="abs" data-control="jog" style="${box('jog')}">Jog</button>
  <button id="estop" class="abs" data-control="estop" style="${box('estop')}">Reset e-stop</button>
</main>
<div id="recipe-dialog" class="abs modal" role="dialog" aria-label="Load recipe" style="${box('dialog')}" hidden>
  <h2 aria-hidden="true">Load recipe</h2>
  <input id="draft" class="abs" aria-label="Recipe" autocomplete="off" style="${relative('input', 'dialog')}">
  <button class="abs" data-control="confirm" style="${relative('confirm', 'dialog')}">Confirm</button>
  <button class="abs" data-control="cancel" style="${relative('cancel', 'dialog')}">Cancel</button>
</div>
<div id="popup" class="abs modal" role="dialog" aria-label="Maintenance due" style="${box('popup')}" hidden>
  <h2 aria-hidden="true">Maintenance due</h2>
  <p style="padding: 0 16px">Lubrication interval reached. Acknowledge to continue.</p>
  <button class="abs" data-control="popupOk" style="${relative('popupOk', 'popup')}">OK</button>
</div>
<script>
  // Requests are serialized so typed text is always applied before the confirm that follows it.
  let queue = Promise.resolve();
  const post = (path, body) => (queue = queue.then(() => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).then(refresh, refresh));
  const main = document.getElementById('main');
  const dialog = document.getElementById('recipe-dialog');
  const popup = document.getElementById('popup');
  const draft = document.getElementById('draft');
  document.body.addEventListener('click', (event) => {
    const control = event.target.closest('[data-control]')?.dataset.control;
    if (control) post('/press', { control });
  });
  draft.addEventListener('focus', () => post('/press', { control: 'input' }));
  draft.addEventListener('input', () => post('/draft', { value: draft.value }));
  draft.addEventListener('keydown', (event) => { if (event.key === 'Enter') post('/key', { key: 'Enter' }); });
  const canvas = document.getElementById('counters').getContext('2d');
  function draw(good, scrap) {
    canvas.fillStyle = '#101010'; canvas.fillRect(0, 0, ${LAYOUT.counters.width}, ${LAYOUT.counters.height});
    canvas.font = '16px Tahoma'; canvas.fillStyle = '#7f7';
    canvas.fillText('GOOD', 16, 28); canvas.fillText('SCRAP', 296, 28);
    canvas.font = 'bold 64px monospace';
    canvas.fillText(String(good), 16, 120); canvas.fillStyle = '#f77'; canvas.fillText(String(scrap), 296, 120);
  }
  async function refresh() {
    const state = await (await fetch('/state', { cache: 'no-store' })).json();
    document.getElementById('machine').textContent = state.machine;
    document.getElementById('machine').className = 'field ' + state.machine;
    document.getElementById('recipe').textContent = state.recipe;
    document.getElementById('alarm').textContent = state.alarm;
    for (const button of main.querySelectorAll('button')) button.disabled = !state.enabled[button.dataset.control];
    draw(state.good, state.scrap);
    dialog.hidden = state.screen !== 'recipe';
    popup.hidden = state.screen !== 'popup';
    // A modal makes the overview inert, so it leaves the accessibility tree like a real modal.
    main.inert = state.screen !== 'main';
    main.setAttribute('aria-hidden', String(state.screen !== 'main'));
    if (document.activeElement !== draft || dialog.hidden) draft.value = state.draft;
  }
  refresh();
  setInterval(refresh, 100);
</script>
</body></html>`;

if (import.meta.main) {
  const argument = (name: string) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const hmi = startFakeHmi({
    port: Number(argument('--port') ?? 4610),
    simulationEndpoints: process.argv.includes('--simulation-endpoints'),
  });
  console.log(`Fake HMI listening on ${hmi.url}`);
}
