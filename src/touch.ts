// Touch controls for phones and tablets: a D-pad, a FIRE button, and a strip
// of keys that changes with the screen (an on-screen keyboard for hi-score
// initials and chaos seeds).
//
// Nothing here knows the game's rules. Every control "presses" the key a
// keyboard player would — ENTER, ESC, C, H, arrows, X — through the same
// press/release handlers main.ts gives real keydown/keyup. So the on-canvas
// prompts keep naming keys, and the buttons wear those names, like the
// virtual keyboard strip of a Spectrum emulator on a phone.
//
// Shown when the primary pointer is coarse, or the moment a finger touches
// the page; a real keypress hides it again (the last input device wins).
// The layout (portrait: game on top, controls below; landscape: controls in
// the side gutters) lives in index.html's stylesheet.

import type { Game } from './defs';

export interface TouchHooks {
  press(key: string): void;
  release(key: string): void;
  wake(): void;                                  // audio unlock, inside a gesture
  unlocks(): { hard: boolean; crt: boolean };
  titlePhase(time: number): number;              // 2 = the hall of signals
}

// A key on the strip: what it presses, what it says, and how it's tinted
// (matching the colour the canvas prompt for it is drawn in).
interface Cap {
  key: string;
  cap: string;
  label: string;
  tint?: 'yellow' | 'magenta' | 'red' | 'cyan' | 'void';
  ghost?: boolean;   // keeps its slot but can't be seen or pressed
}

type View = 'pad' | 'menu' | 'alpha' | 'digits';

// After the screen changes, strip and keyboard presses are ignored briefly:
// a thumb still hammering FIRE as the game ends mustn't land on "rest on your
// laurels", and the tap that started a game mustn't also arm its quit.
const GUARD_MS = 450;

// Spectrum-ish rows. DEL is Backspace; ESC sits where CAPS SHIFT would, and
// ENTER gets a double-width key bottom right.
const ALPHA_ROWS: (string | [string, string, number])[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ['Backspace', 'DEL', 1]],
  [['Escape', 'ESC', 1], 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ['Enter', 'ENTER', 2]],
];
const DIGIT_ROWS: (string | [string, string, number])[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  [['Escape', 'ESC', 3], ['Backspace', 'DEL', 3], ['Enter', 'ENTER', 4]],
];

const DIRS = ['up', 'down', 'left', 'right'] as const;
type Dir = typeof DIRS[number];
const DIR_KEY: Record<Dir, string> = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
};

let active = false;
let hooks: TouchHooks;
let root: HTMLDivElement;
let dpad: HTMLDivElement;
let fireBtn: HTMLButtonElement;
let strip: HTMLDivElement;
let readout: HTMLDivElement;
let alphaRows: HTMLDivElement;
let digitRows: HTMLDivElement;
const arms = {} as Record<Dir, HTMLElement>;

const held: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
let dpadId: number | null = null;
const firePointers = new Set<number>();

let stripSig = '';
let screen = '';
let guardUntil = 0;
let shownReadout = '';

/** True while the on-screen controls are showing (render.ts words its hints by it). */
export function touchActive(): boolean {
  return active;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls: string, parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

function setActive(on: boolean): void {
  if (on === active) return;
  active = on;
  document.body.classList.toggle('touch', on);
  if (!on) releaseAll();
}

// ---------- D-pad ----------

function setDirs(want: Record<Dir, boolean>): void {
  for (const d of DIRS) {
    if (want[d] === held[d]) continue;
    held[d] = want[d];
    if (want[d]) hooks.press(DIR_KEY[d]); else hooks.release(DIR_KEY[d]);
    arms[d].classList.toggle('on', want[d]);
  }
}

// 8-way from the thumb's offset to the pad's centre. An axis engages once it
// carries 42% of the offset: cardinal sectors come out ~50° wide, diagonals
// ~40°, so a straight push (which stone-hauling needs) is easy to hold.
function steer(cx: number, cy: number): void {
  const r = dpad.getBoundingClientRect();
  const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
  const m = Math.hypot(dx, dy);
  const k = m * 0.42;
  const live = m > r.width * 0.1;
  setDirs({
    up: live && dy < -k, down: live && dy > k,
    left: live && dx < -k, right: live && dx > k,
  });
}

function dpadEnd(e: PointerEvent): void {
  if (e.pointerId !== dpadId) return;
  dpadId = null;
  setDirs({ up: false, down: false, left: false, right: false });
}

// ---------- FIRE ----------

// X rather than Space: both fire, but Space also answers end-screen prompts.
function fireDown(e: PointerEvent): void {
  e.preventDefault();
  if (firePointers.size === 0) {
    hooks.press('x');
    fireBtn.classList.add('on');
  }
  firePointers.add(e.pointerId);
}

function fireEnd(e: PointerEvent): void {
  if (!firePointers.delete(e.pointerId) || firePointers.size) return;
  hooks.release('x');
  fireBtn.classList.remove('on');
}

function releaseAll(): void {
  if (dpadId !== null) {
    dpadId = null;
    setDirs({ up: false, down: false, left: false, right: false });
  }
  if (firePointers.size) {
    firePointers.clear();
    hooks.release('x');
    fireBtn.classList.remove('on');
  }
}

// ---------- keys ----------

// Strip and keyboard keys are taps: the press and release go out together on
// touch-down (instant, and nothing is left held if the key vanishes under the
// finger because the screen changed). The lit state is only cosmetic.
function makeKey(parent: HTMLElement, key: string, cap: string, label = '', span = 1): HTMLButtonElement {
  const b = el('button', 'key', parent);
  b.type = 'button';
  b.tabIndex = -1;
  b.dataset.key = key;
  el('b', '', b).textContent = cap;
  if (label) el('small', '', b).textContent = label;
  b.setAttribute('aria-label', label ? `${cap} - ${label}` : cap);
  if (span > 1) b.style.gridColumn = `span ${span}`;
  return b;
}

function onKeyDown(e: PointerEvent): void {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.key');
  if (!b || !b.dataset.key || b.classList.contains('ghost')) return;
  e.preventDefault();
  if (performance.now() < guardUntil) return;
  b.classList.add('on');
  hooks.press(b.dataset.key);
  hooks.release(b.dataset.key);
}

function onKeyUp(e: PointerEvent): void {
  (e.target as HTMLElement).closest('.key')?.classList.remove('on');
}

function buildRows(parent: HTMLElement, rows: (string | [string, string, number])[][]): void {
  for (const row of rows) {
    const r = el('div', 'row', parent);
    for (const k of row) {
      if (typeof k === 'string') makeKey(r, k, k);
      else makeKey(r, k[0], k[1], '', k[2]);
    }
  }
}

// ---------- what to show ----------

function plan(g: Game, time: number): { view: View; caps: Cap[] } {
  const u = hooks.unlocks();
  const crt: Cap[] = u.crt ? [{ key: 'd', cap: 'D', label: 'CRT', tint: 'cyan' }] : [];
  const esc = (label: string): Cap => ({ key: 'Escape', cap: 'ESC', label });
  const enter = (label: string): Cap => ({ key: 'Enter', cap: 'ENTER', label, tint: 'yellow' });
  switch (g.mode) {
    case 'loading':
      return { view: 'menu', caps: [enter('SKIP')] };
    case 'title': {
      if (g.seedEntry !== null) return { view: 'digits', caps: [] };
      const hard: Cap[] = u.hard ? [
        { key: 'h', cap: 'H', label: g.difficulty === 'hard' ? 'EASY' : 'HARD', tint: 'red' },
        { key: 's', cap: 'S', label: 'SEED', tint: 'red' },
      ] : [];
      return {
        view: 'menu',
        caps: [
          enter('START'),
          { key: 'c', cap: 'C', label: 'CHAOS', tint: 'magenta' },
          ...hard,
          ...crt,
          // Only the hall of signals filters by map; the slot stays reserved
          // so the other keys don't shuffle as the title screens cycle.
          { key: 'm', cap: 'M', label: 'MAP', ghost: hooks.titlePhase(time) !== 2 },
        ],
      };
    }
    case 'play':
      return { view: 'pad', caps: [esc('QUIT')] };
    case 'win':
    case 'lose':
      if (g.entryActive) return { view: 'alpha', caps: [] };
      if (g.mode === 'win' && g.difficulty === 'easy') {
        return {
          view: 'menu',
          caps: [enter('FACE HIM'), { key: ' ', cap: 'SPACE', label: 'REST' }, esc('TITLE'), ...crt],
        };
      }
      return { view: 'menu', caps: [enter('AGAIN'), esc('TITLE'), ...crt] };
    case 'void':
      // The Void's way back is barely visible on the canvas; so is its key.
      return { view: 'menu', caps: [{ key: 'Escape', cap: 'ESC', label: '', tint: 'void' }] };
  }
}

/** Per frame: fit the controls to the screen the game is on. Cheap when nothing changed. */
export function syncTouch(g: Game, time: number): void {
  if (!active) return;
  const { view, caps } = plan(g, time);

  const scr = g.mode + '|' + view;
  if (scr !== screen) {
    if (screen) guardUntil = performance.now() + GUARD_MS;
    if (view !== 'pad') releaseAll();
    screen = scr;
    root.dataset.view = view;
  }

  const sig = caps.map(c => `${c.key}:${c.label}:${c.ghost ? 1 : 0}`).join(',');
  if (sig !== stripSig) {
    stripSig = sig;
    strip.replaceChildren();
    for (const c of caps) {
      const b = makeKey(strip, c.key, c.cap, c.label);
      if (c.tint) b.dataset.tint = c.tint;
      if (c.ghost) b.classList.add('ghost');
    }
  }

  if (view === 'pad') fireBtn.dataset.wand = g.player.wand;

  if (view === 'alpha' || view === 'digits') {
    const val = view === 'alpha' ? g.entryName : g.seedEntry ?? '';
    const max = view === 'alpha' ? 3 : 6;
    const txt = (view === 'alpha' ? 'NAME ' : 'SEED ') + val + (val.length < max ? '_' : '');
    if (txt !== shownReadout) {
      shownReadout = txt;
      readout.textContent = txt;
    }
  }
}

/** Build the controls (hidden until a touch device shows up) and start listening. */
export function initTouch(h: TouchHooks): void {
  hooks = h;
  root = el('div', '', document.body);
  root.id = 'touch';

  dpad = el('div', 'dpad', root);
  dpad.setAttribute('aria-label', 'D-pad');
  for (const d of DIRS) arms[d] = el('i', `arm ${d}`, dpad);
  el('i', 'hub', dpad);
  dpad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (dpadId !== null) return;
    dpadId = e.pointerId;
    dpad.setPointerCapture(e.pointerId);
    steer(e.clientX, e.clientY);
  });
  dpad.addEventListener('pointermove', e => {
    if (e.pointerId === dpadId) steer(e.clientX, e.clientY);
  });
  dpad.addEventListener('pointerup', dpadEnd);
  dpad.addEventListener('pointercancel', dpadEnd);
  dpad.addEventListener('lostpointercapture', dpadEnd);

  fireBtn = el('button', 'fire', root);
  fireBtn.type = 'button';
  fireBtn.tabIndex = -1;
  fireBtn.textContent = 'FIRE';
  fireBtn.addEventListener('pointerdown', fireDown);
  fireBtn.addEventListener('pointerup', fireEnd);
  fireBtn.addEventListener('pointercancel', fireEnd);
  fireBtn.addEventListener('lostpointercapture', fireEnd);

  strip = el('div', 'strip', root);
  const board = el('div', 'board', root);
  readout = el('div', 'readout', board);
  alphaRows = el('div', 'rows alpha', board);
  digitRows = el('div', 'rows digits', board);
  buildRows(alphaRows, ALPHA_ROWS);
  buildRows(digitRows, DIGIT_ROWS);
  for (const box of [strip, board]) {
    box.addEventListener('pointerdown', onKeyDown);
    box.addEventListener('pointerup', onKeyUp);
    box.addEventListener('pointercancel', onKeyUp);
    box.addEventListener('pointerout', onKeyUp);
  }

  // No scrolling, zooming, text selection or callouts while playing by touch.
  // (touch-action does most of it; iOS needs the rest said explicitly.)
  root.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', e => { if (active) e.preventDefault(); });
  document.addEventListener('dblclick', e => { if (active) e.preventDefault(); });
  root.addEventListener('contextmenu', e => e.preventDefault());

  // Which device is in charge. Touches and pens show the controls; a real
  // key (not a volume rocker or other media key) hands control back.
  window.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') setActive(true);
  }, true);
  window.addEventListener('keydown', e => {
    if (e.key.length === 1 || /^(Arrow|Enter|Escape|Backspace)/.test(e.key)) setActive(false);
  }, true);

  // A touch press lands on pointerdown, which browsers don't count as a user
  // gesture for audio; the lift that follows does.
  const wake = (e: Event): void => {
    if (!(e instanceof PointerEvent) || e.pointerType !== 'mouse') hooks.wake();
  };
  window.addEventListener('pointerup', wake, true);
  window.addEventListener('touchend', wake, true);

  // Lifting a finger in another app can't reach us: don't leave keys held.
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') releaseAll();
  });

  setActive(matchMedia('(pointer: coarse)').matches);
}
