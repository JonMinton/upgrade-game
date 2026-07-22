// UPGRADE — entry point: input, loop, mode transitions.

import { Game, Input, CANVAS_W, CANVAS_H } from './defs';
import { newGame, update, msg, finalScore } from './game';
import { render } from './render';
import { initAudio, setTitleMode, setMusicTier } from './audio';
import { qualifies, addScore, cycleMapFilter } from './hiscores';

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

function unlocked(): boolean {
  try { return localStorage.getItem('upgrade-hard-unlocked') === '1'; } catch { return false; }
}

const KEYMAP: Record<string, keyof Input> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  ' ': 'fire', x: 'fire', X: 'fire',
};

window.addEventListener('keydown', e => {
  // Hi-score initials entry captures the keyboard entirely.
  if (g.entryActive) {
    if (/^[a-zA-Z0-9]$/.test(e.key) && g.entryName.length < 3) {
      g.entryName += e.key.toUpperCase();
    } else if (e.key === 'Backspace') {
      g.entryName = g.entryName.slice(0, -1);
    } else if (e.key === 'Escape') {
      g.entryActive = false;   // decline the hall
    } else if (e.key === 'Enter' && g.entryName.length > 0) {
      addScore({
        name: g.entryName.padEnd(3, '.'),
        score: g.score,
        mode: g.difficulty === 'hard' ? 'H' : 'E',
        map: g.mapName,
      });
      g.entryActive = false;
    }
    e.preventDefault();
    return;
  }
  // Title-screen seed entry (seeded chaos) captures digits.
  if (g.mode === 'title' && g.seedEntry !== null) {
    if (/^[0-9]$/.test(e.key) && g.seedEntry.length < 6) g.seedEntry += e.key;
    else if (e.key === 'Backspace') g.seedEntry = g.seedEntry.slice(0, -1);
    else if (e.key === 'Escape') g.seedEntry = null;
    else if (e.key === 'Enter' && g.seedEntry.length > 0) {
      seedStart = Math.max(1, parseInt(g.seedEntry, 10) || 1);
      g.seedEntry = null;
      initAudio();
    }
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') { enterPressed = true; initAudio(); e.preventDefault(); return; }
  if (e.key === 'Escape') escPressed = true;
  if (e.key === 'h' || e.key === 'H') hardPressed = true;
  if (e.key === 'c' || e.key === 'C') chaosPressed = true;
  if ((e.key === 's' || e.key === 'S') && g.mode === 'title') seedOpenPressed = true;
  if (e.key === ' ') spacePressed = true;
  if ((e.key === 'm' || e.key === 'M') && g.mode === 'title') cycleMapFilter();
  const k = KEYMAP[e.key];
  if (k) { input[k] = true; initAudio(); e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  const k = KEYMAP[e.key];
  if (k) input[k] = false;
});

let g: Game = newGame();
let last = performance.now();
let lastFrameAt = performance.now();

// Debug/testing handles (harmless in production).
(window as unknown as { __game: () => Game }).__game = () => g;
(window as unknown as { __ff: (s: number) => void }).__ff = (seconds: number) => {
  const idle: Input = { up: false, down: false, left: false, right: false, fire: false };
  for (let t = 0; t < seconds && g.mode === 'play'; t += 0.05) update(g, idle, 0.05);
};

function frame(now: number): void {
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

  // Finalise the score once per game and open initials entry if it ranks.
  if ((g.mode === 'win' || g.mode === 'lose') && !g.scored) {
    g.scored = true;
    g.score = finalScore(g);
    if (qualifies(g.score)) {
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
      msg(g, g.difficulty === 'hard'
        ? 'HARD MODE - THE TRUE KERNAGH AWAKENS'
        : 'FIND THE SHARDS. KERNAGH SEEKS THEM TOO', 4);
    }
  };

  if (hardPressed) {
    hardPressed = false;
    if (g.mode === 'title' && unlocked()) {
      difficulty = 'hard';
      g.difficulty = 'hard';
      startPlay();
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
    if ((g.mode === 'win' || g.mode === 'lose') && !g.entryActive) {
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
  if (g.mode === 'win') setMusicTier(5);
  if (g.mode === 'lose') setMusicTier(0);
  render(ctx, g, now / 1000);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Watchdog: rAF stalls when the window is hidden/occluded; keep the world
// simulating (at a lower rate) so the game doesn't freeze in the background.
setInterval(() => {
  const now = performance.now();
  if (now - lastFrameAt > 150) frame(now);
}, 100);
