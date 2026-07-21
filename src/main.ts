// UPGRADE — entry point: input, loop, mode transitions.

import { Game, Input, CANVAS_W, CANVAS_H } from './defs';
import { newGame, update, msg } from './game';
import { render } from './render';
import { initAudio, setTitleMode, setMusicTier } from './audio';

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const input: Input = { up: false, down: false, left: false, right: false, fire: false };
let enterPressed = false;

const KEYMAP: Record<string, keyof Input> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  ' ': 'fire', x: 'fire', X: 'fire',
};

window.addEventListener('keydown', e => {
  if (e.key === 'Enter') { enterPressed = true; initAudio(); e.preventDefault(); return; }
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

// Debug/testing handle (harmless in production).
(window as unknown as { __game: () => Game }).__game = () => g;

function frame(now: number): void {
  lastFrameAt = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (enterPressed) {
    enterPressed = false;
    if (g.mode === 'title') {
      g.mode = 'play';
      setTitleMode(false);
      setMusicTier(g.player.tier);
      msg(g, 'FIND THE SHARDS. KERNAGH SEEKS THEM TOO', 4);
    } else if (g.mode === 'win' || g.mode === 'lose') {
      g = newGame();
      g.mode = 'play';
      setTitleMode(false);
      setMusicTier(g.player.tier);
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
