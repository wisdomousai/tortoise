/**
 * Keyboard layouts as seen by a keyboard-wedge scanner. A wedge scanner does not send characters:
 * it sends USB HID key positions chosen from *its* configured layout, and the host turns them back
 * into characters with *its own* layout. When the two differ (a US-configured scanner on a Swiss or
 * German PC is the common case) `y`/`z` swap and most symbols arrive wrong; some land on dead keys
 * and combine with the next character.
 *
 * Browsers report the physical key as `KeyboardEvent.code` regardless of host layout, so the wedge
 * source decodes `(code, shift)` through the scanner's layout and recovers the exact characters,
 * dead keys included. `remapText` repairs text that was already decoded with the host layout, for
 * input that arrives without key codes; characters that hit dead keys cannot be repaired that way.
 */
export const keyboardLayouts = ['us', 'de', 'de-ch'] as const;
export type KeyboardLayout = (typeof keyboardLayouts)[number];

/** Physical keys in row order; each layout lists one character per key, unshifted then shifted. */
const keys = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'],
  ['Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['BracketLeft', 'BracketRight'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'],
  ['Semicolon', 'Quote', 'Backslash'],
  ['IntlBackslash', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'],
  ['Comma', 'Period', 'Slash', 'Space'],
].flat();

/** One string per layout and shift state, aligned with `keys`. */
const tables: Record<KeyboardLayout, { plain: string; shift: string }> = {
  us: {
    plain: "`1234567890-=qwertyuiop[]asdfghjkl;'\\\\zxcvbnm,./ ",
    shift: '~!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:"||ZXCVBNM<>? ',
  },
  de: {
    plain: '^1234567890ß´qwertzuiopü+asdfghjklöä#<yxcvbnm,.- ',
    shift: '°!"§$%&/()=?`QWERTZUIOPÜ*ASDFGHJKLÖÄ\'>YXCVBNM;:_ ',
  },
  'de-ch': {
    plain: "§1234567890'^qwertzuiopü¨asdfghjklöä$<yxcvbnm,.- ",
    shift: '°+"*ç%&/()=?`QWERTZUIOPè!ASDFGHJKLéà£>YXCVBNM;:_ ',
  },
};
/** Keys that start a dead-key sequence on the host instead of producing a character. */
const deadKeys: Record<KeyboardLayout, readonly string[]> = {
  us: [],
  de: ['^', '´', '`'],
  'de-ch': ['^', '¨', '`'],
};

for (const [layout, table] of Object.entries(tables))
  if ([...table.plain].length !== keys.length || [...table.shift].length !== keys.length)
    throw new Error(`Keyboard layout table is misaligned: ${layout}`);

/** The character a key produces in `layout`, or undefined for keys outside the table. */
export function characterFor(
  layout: KeyboardLayout,
  code: string,
  shift: boolean,
): string | undefined {
  const index = keys.indexOf(code);
  if (index < 0) return undefined;
  return [...(shift ? tables[layout].shift : tables[layout].plain)][index];
}

/** The key and shift state that type `character` in `layout`. */
export function keyFor(
  layout: KeyboardLayout,
  character: string,
): { code: string; shift: boolean } | undefined {
  const plain = [...tables[layout].plain].indexOf(character);
  if (plain >= 0) return { code: keys[plain]!, shift: false };
  const shifted = [...tables[layout].shift].indexOf(character);
  return shifted >= 0 ? { code: keys[shifted]!, shift: true } : undefined;
}

export function isDeadKey(layout: KeyboardLayout, character: string): boolean {
  return deadKeys[layout].includes(character);
}

/**
 * Repair text a scanner configured for `scanner` produced on a host using `host`. Characters
 * without a key position in the host table pass through unchanged and are reported.
 */
export function remapText(
  text: string,
  layouts: { readonly scanner: KeyboardLayout; readonly host: KeyboardLayout },
): { text: string; unmapped: string[] } {
  if (layouts.scanner === layouts.host) return { text, unmapped: [] };
  const unmapped: string[] = [];
  let result = '';
  for (const character of text) {
    const key = keyFor(layouts.host, character);
    const original = key && characterFor(layouts.scanner, key.code, key.shift);
    if (original === undefined) unmapped.push(character);
    result += original ?? character;
  }
  return { text: result, unmapped };
}
