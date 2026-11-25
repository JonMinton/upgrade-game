// UPGRADE — entry point: input, loop, mode transitions.

import { Game, Input, CANVAS_W, CANVAS_H, PUSH_CFG, DMG_CFG } from './defs';
import { newGame, update, msg, finalScore } from './game';
import { render, titlePhase } from './render';
import { initTouch, syncTouch } from './touch';
import { initAudio, setTitleMode, setMusicTier } from './audio';
import { qualifies, addScore, cycleMapFilter } from './hiscores';
import { sxEnd, sxKey, sxOpening } from './secrets';
import { bumpVisit, visitCount, EVO_RATES, saveDamage, resetWorldState } from './evolve';

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const input: Input = { up: false, down: false, left: false, right: false, fire: false };
let enterPressed = false;
let hardPressed = false;
let spacePressed = false;
let chaosPressed = false;
let escPressed = false;
let seedOpenPressed = false;
let seedStart: number | null = null;
let difficulty: 'easy' | 'hard' = 'easy';
let chaosSeed: number | null = null;
let cheatBuf = '';   // rolling tail of letters typed on the title (cheat detection)

function unlocked(): boolean {
  try { return localStorage.getItem('upgrade-hard-unlocked') === '1'; } catch { return false; }
}

function crtUnlocked(): boolean {
  try { return localStorage.getItem('upgrade-crt-unlocked') === '1'; } catch { return false; }
}

function setCrt(on: boolean): void {
  document.body.classList.toggle('crt', on);
  try { localStorage.setItem('upgrade-crt-on', on ? '1' : '0'); } catch { /* private mode */ }
}

// Restore the CRT preference across reloads (only meaningful once unlocked).
try {
  if (crtUnlocked() && localStorage.getItem('upgrade-crt-on') === '1') {
    document.body.classList.add('crt');
  }
} catch { /* private mode */ }

const KEYMAP: Record<string, keyof Input> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  ' ': 'fire', x: 'fire', X: 'fire',
};

// Every key press goes through here — from the real keyboard, or from the
// on-screen touch controls, which press keys by name exactly as a keyboard
// would. Returns true when the key was the game's, so the browser default
// (scrolling on arrows/space, say) should be suppressed.
function keyDown(key: string): boolean {
  sxKey(g, key);
  // Hi-score initials entry captures the keyboard entirely.
  if (g.entryActive) {
    if (/^[a-zA-Z0-9]$/.test(key) && g.entryName.length < 3) {
      g.entryName += key.toUpperCase();
    } else if (key === 'Backspace') {
      g.entryName = g.entryName.slice(0, -1);
    } else if (key === 'Escape') {
      g.entryActive = false;   // decline the hall
    } else if (key === 'Enter' && g.entryName.length > 0) {
      addScore({
        name: g.entryName.padEnd(3, '.'),
        score: g.score,
        mode: g.difficulty === 'hard' ? 'H' : 'E',
        map: g.mapName,
      });
      g.entryActive = false;
    }
    return true;
  }
  // Title-screen seed entry (seeded chaos) captures digits.
  if (g.mode === 'title' && g.seedEntry !== null) {
    if (/^[0-9]$/.test(key) && g.seedEntry.length < 6) g.seedEntry += key;
    else if (key === 'Backspace') g.seedEntry = g.seedEntry.slice(0, -1);
    else if (key === 'Escape') g.seedEntry = null;
    else if (key === 'Enter' && g.seedEntry.length > 0) {
      seedStart = Math.max(1, parseInt(g.seedEntry, 10) || 1);
      g.seedEntry = null;
      initAudio();
    }
    return true;
  }
  // Title-screen cheat: type FABLETON then Enter to unlock everything.
  // (No letter of it collides with the C/H/S/M/D hotkeys.)
  if (g.mode === 'title') {
    if (/^[a-z]$/i.test(key)) cheatBuf = (cheatBuf + key.toLowerCase()).slice(-8);
    if (key === 'Enter' && cheatBuf === 'fableton') {
      cheatBuf = '';
      try {
        localStorage.setItem('upgrade-hard-unlocked', '1');
        localStorage.setItem('upgrade-crt-unlocked', '1');
      } catch { /* private mode */ }
      g.cheatMsgUntil = performance.now() / 1000 + 4;
      return true;
    }
  }
  if (key === 'Enter') { enterPressed = true; initAudio(); return true; }
  if (key === 'Escape') escPressed = true;
  if (key === 'h' || key === 'H') hardPressed = true;
  if (key === 'c' || key === 'C') chaosPressed = true;
  if ((key === 's' || key === 'S') && g.mode === 'title') seedOpenPressed = true;
  // D toggles the CRT overlay — outside play only, where D is WASD-right.
  if ((key === 'd' || key === 'D') && g.mode !== 'play' && crtUnlocked()) {
    setCrt(!document.body.classList.contains('crt'));
  }
  if (key === ' ') spacePressed = true;
  if ((key === 'm' || key === 'M') && g.mode === 'title') cycleMapFilter();
  const k = KEYMAP[key];
  if (k) { input[k] = true; initAudio(); return true; }
  return false;
}

function keyUp(key: string): void {
  const k = KEYMAP[key];
  if (k) input[k] = false;
}

window.addEventListener('keydown', e => {
  if (keyDown(e.key)) e.preventDefault();
});
window.addEventListener('keyup', e => keyUp(e.key));

let g: Game = newGame();
let last = performance.now();
let lastFrameAt = performance.now();

initTouch({
  press: keyDown,
  release: keyUp,
  wake: initAudio,
  unlocks: () => ({ hard: unlocked(), crt: crtUnlocked() }),
  titlePhase,
});

// Debug/testing handles (harmless in production).
(window as unknown as { __game: () => Game }).__game = () => g;
(window as unknown as { __ff: (s: number) => void }).__ff = (seconds: number) => {
  const idle: Input = { up: false, down: false, left: false, right: false, fire: false };
  for (let t = 0; t < seconds && g.mode === 'play'; t += 0.05) update(g, idle, 0.05);
};
// Pushstone tuning knobs, live-editable while playtesting.
(window as unknown as { __push: typeof PUSH_CFG }).__push = PUSH_CFG;
// Combat-scarring knobs (ignite/crack chances, between-game weathering).
(window as unknown as { __dmg: typeof DMG_CFG }).__dmg = DMG_CFG;
// Valley-evolution handles: read/set a map's visit count, tweak CA rates.
(window as unknown as { __evo: object }).__evo = {
  visits: (m = 'GLEN') => visitCount(m),
  set: (n: number, m = 'GLEN') => {
    try { localStorage.setItem('upgrade-evo-' + m, String(n)); } catch { /* private mode */ }
  },
  rates: EVO_RATES,
};
// Average ms of CPU draw time per frame at a given env tier (render only, no update).
(window as unknown as { __bench: (tier: number, frames?: number) => number }).__bench =
  (tier: number, frames = 120) => {
    const keep = g.player.tier;
    g.player.tier = tier;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) render(ctx, g, t0 / 1000 + i / 60);
    const ms = (performance.now() - t0) / frames;
    g.player.tier = keep;
    return ms;
  };

// One update+render pass. Scheduling lives in frame()/schedule() so the
// watchdog can tick the simulation without ever forking the rAF loop.
function tick(now: number, draw = true): void {
  lastFrameAt = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (g.mode === 'loading') {
    g.loadT += dt;
    if (g.loadT >= 3) g.mode = 'title';
  }

  // Winning easy mode unlocks the hard-mode shortcut permanently.
  if (g.mode === 'win' && g.difficulty === 'easy') {
    try { localStorage.setItem('upgrade-hard-unlocked', '1'); } catch { /* private mode */ }
  }
  // Winning hard mode (seeded or not) unlocks the CRT overlay permanently.
  if (g.mode === 'win' && g.difficulty === 'hard') {
    try { localStorage.setItem('upgrade-crt-unlocked', '1'); } catch { /* private mode */ }
  }

  // Finalise the score once per game and open initials entry if it ranks.
  // Walking into the Void earns nothing and UNDOES everything: the valley's
  // whole history — ages and scars on every map — resets to genesis.
  if ((g.mode === 'win' || g.mode === 'lose' || g.mode === 'void') && !g.scored) {
    g.scored = true;
    if (g.mode === 'void') {
      resetWorldState();
    } else if (g.chaosSeed == null) {
      // A finished game ages its map by one generation (chaos maps don't
      // age), and its combat scars join the map's ledger, weathering once.
      bumpVisit(g.mapName);
      saveDamage(g.mapName, g.dmg);
    }
    sxEnd(g);
    g.score = finalScore(g);
    if (g.mode !== 'void' && qualifies(g.score)) {
      g.entryActive = true;
      g.entryName = '';
    }
  }

  const startPlay = (): void => {
    g.mode = 'play';
    setTitleMode(false);
    setMusicTier(g.player.tier);
    if (g.chaosSeed != null) {
      msg(g, `CHAOS MODE - SEED ${g.chaosSeed} - AN UNCHARTED VALLEY`, 4);
    } else {
      msg(g, sxOpening(g) ?? (g.difficulty === 'hard'
        ? 'HARD MODE - THE TRUE KERNAGH AWAKENS'
        : 'FIND THE SHARDS. KERNAGH SEEKS THEM TOO'), 4);
    }
  };

  // H arms/disarms hard mode rather than launching a game: the armed
  // difficulty then applies to ANY start from the title — Enter (current
  // map), C (chaos), or S (seeded chaos).
  if (hardPressed) {
    hardPressed = false;
    if (g.mode === 'title' && unlocked()) {
      difficulty = difficulty === 'hard' ? 'easy' : 'hard';
      g.difficulty = difficulty;
    }
  }
  if (chaosPressed) {
    chaosPressed = false;
    if (g.mode === 'title') {
      chaosSeed = 1 + Math.floor(Math.random() * 999999);
      g = newGame(difficulty, chaosSeed);
      startPlay();
    }
  }
  if (seedOpenPressed) {
    seedOpenPressed = false;
    if (g.mode === 'title' && unlocked()) g.seedEntry = '';
  }
  if (seedStart != null && g.mode === 'title') {
    chaosSeed = seedStart;
    seedStart = null;
    g = newGame(difficulty, chaosSeed);
    startPlay();
  }
  if (spacePressed) {
    spacePressed = false;
    if (g.mode === 'win' && g.difficulty === 'easy') {
      // Rest on your laurels: back to the title (and back to the default map).
      difficulty = 'easy';
      chaosSeed = null;
      g = newGame(difficulty);
      g.mode = 'title';
    }
  }
  // ESC from any end screen: back to the title (default map, easy).
  // ESC in play arms a confirm; a second ESC within the window quits.
  if (escPressed) {
    escPressed = false;
    if ((g.mode === 'win' || g.mode === 'lose' || g.mode === 'void') && !g.entryActive) {
      difficulty = 'easy';
      chaosSeed = null;
      g = newGame(difficulty);
      g.mode = 'title';
    } else if (g.mode === 'play') {
      if (g.time < g.escArmUntil) {
        difficulty = 'easy';
        chaosSeed = null;
        g = newGame(difficulty);
        g.mode = 'title';
      } else {
        g.escArmUntil = g.time + 2.5;
      }
    }
  }
  if (enterPressed) {
    enterPressed = false;
    if (g.mode === 'loading') {
      g.mode = 'title';
    } else if (g.mode === 'title') {
      startPlay();
    } else if (g.mode === 'win' && g.difficulty === 'easy') {
      // The loop: victory in easy mode leads to the true Kernagh — on the
      // same map, chaos or not.
      difficulty = 'hard';
      g = newGame(difficulty, chaosSeed);
      startPlay();
    } else if (g.mode === 'win' || g.mode === 'lose') {
      g = newGame(difficulty, chaosSeed);
      startPlay();
    }
  }

  update(g, input, dt);
  if (g.mode === 'title') setTitleMode(true);
  if (g.mode === 'win') setMusicTier(g.winWhy === 'transcend' ? 7 : g.winTier);
  if (g.mode === 'lose' || g.mode === 'void') setMusicTier(0);   // the Void is silent
  if (draw) {
    render(ctx, g, now / 1000);
    syncTouch(g, now / 1000);
  }
}

let rafId = 0;

function frame(now: number): void {
  rafId = 0;
  tick(now);
  schedule();
}

function schedule(): void {
  if (rafId) return;   // never more than one rAF in flight
  rafId = requestAnimationFrame(frame);
}

schedule();

// Watchdog: rAF stalls when the window is hidden/occluded; keep the world
// simulating (at a lower rate) so the game doesn't freeze in the background.
// Simulation only — no draw (nothing composites while hidden), and no rAF
// re-arm, so the main loop can never be forked or re-entered from here.
setInterval(() => {
  if (document.visibilityState === 'visible') return;
  const now = performance.now();
  if (now - lastFrameAt > 150) tick(now, false);
}, 100);
