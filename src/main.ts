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
let difficulty: 'easy' | 'hard' = 'easy';

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
  if (e.key === 'Enter') { enterPressed = true; initAudio(); e.preventDefault(); return; }
  if (e.key === 'h' || e.key === 'H') hardPressed = true;
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
    msg(g, g.difficulty === 'hard'
      ? 'HARD MODE - THE TRUE KERNAGH AWAKENS'
      : 'FIND THE SHARDS. KERNAGH SEEKS THEM TOO', 4);
  };

  if (hardPressed) {
    hardPressed = false;
    if (g.mode === 'title') {
      difficulty = 'hard';
      g.difficulty = 'hard';
      startPlay();
    }
  }
  if (spacePressed) {
    spacePressed = false;
    if (g.mode === 'win' && g.difficulty === 'easy') {
      // Rest on your laurels: back to the title.
      difficulty = 'easy';
      g = newGame(difficulty);
      g.mode = 'title';
    }
  }
  if (enterPressed) {
    enterPressed = false;
    if (g.mode === 'loading') {
      g.mode = 'title';
    } else if (g.mode === 'title') {
      startPlay();
    } else if (g.mode === 'win' && g.difficulty === 'easy') {
      // The loop: victory in easy mode leads to the true Kernagh.
      difficulty = 'hard';
      g = newGame(difficulty);
      startPlay();
    } else if (g.mode === 'win' || g.mode === 'lose') {
      g = newGame(difficulty);
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
