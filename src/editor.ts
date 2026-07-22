// UPGRADE map tile editor.
// Edit the fixed map, preview any screen at any tier (T0-T5) via the real game
// renderers, and stage the result for the game via localStorage ("Apply").

import {
  Game, World, Tl, TILE, SCR_TW, SCR_TH, SCR_W, SCR_H, WORLD_TW, WORLD_TH,
  WORLD_SW, WORLD_SH, START_TIER,
} from './defs';
import { genWorld, worldFromTiles, poisReachable } from './map';
import { renderPlay } from './render';

const LS_KEY = 'upgrade-map';

const TILE_NAMES: [number, string, string][] = [
  [Tl.GRASS, 'grass', '#1c4a1c'], [Tl.PATH, 'path', '#b09a50'], [Tl.TREE, 'tree', '#2e8a2e'],
  [Tl.WATER, 'water', '#2a4ac0'], [Tl.REED, 'reed', '#6aa84f'], [Tl.WALL, 'wall', '#909090'],
  [Tl.ROCK, 'rock', '#6a6a72'], [Tl.STONE, 'stone', '#e8e8f0'], [Tl.ALTAR, 'altar', '#40e0e8'],
  [Tl.SHRINE, 'shrine', '#e8d040'], [Tl.WELL, 'well', '#b8b8c8'], [Tl.HUT, 'hut', '#c05838'],
  [Tl.BERRY, 'berry', '#d04058'],
];

let tiles: Uint8Array;
try {
  const o = localStorage.getItem(LS_KEY);
  tiles = o ? Uint8Array.from(JSON.parse(o) as number[]) : genWorld().tiles.slice();
} catch {
  tiles = genWorld().tiles.slice();
}

let world: World = worldFromTiles(tiles);
let selTile: number = Tl.TREE;
let selTier = START_TIER;
let sel = { x: 0, y: 3 };
let dirtyArena = true;

const bar = document.getElementById('bar')!;
const status = document.getElementById('status')!;
const arena = document.getElementById('arena') as HTMLCanvasElement;
const screenC = document.getElementById('screen') as HTMLCanvasElement;
const aCtx = arena.getContext('2d')!;
const sCtx = screenC.getContext('2d')!;

function say(s: string): void { status.textContent = s; }

function rebuild(): void {
  world = worldFromTiles(tiles);
  fake.world = world;
  fake.berryCd = world.berrySpots.map(() => 0);
  fake.shards = world.shrines.map(s => ({ x: s.x * TILE + 4, y: s.y * TILE + 4 }));
  dirtyArena = true;
}

// A minimal Game the real renderers accept: no entities on screen, shards
// shown on every shrine for context.
function offEnt(): Game['player'] {
  return {
    x: -1000, y: -1000, facing: 0, hp: 3, tier: selTier, shards: 0,
    cool: 0, channel: 0, inv: 0, regen: 0, stun: 0, wand: 'fire', onStation: false,
    animDist: 0, stepAcc: 0, homeX: -1000, homeY: -1000, rival: false,
  };
}
const fake: Game = {
  mode: 'play', loadT: 0, time: 0, world,
  player: offEnt(), rival: { ...offEnt(), rival: true },
  bolts: [], shards: [], fx: [], berryCd: [],
  respawn: 99, msg: '', msgUntil: 0, ripple: -1, rippleFrom: 1,
  ai: {
    state: '', path: [], pathI: 0, repath: 0, lastX: 0, lastY: 0, stuck: 0,
    targetKey: '', interceptT: 0, coolUntil: 0, pauseUntil: 0,
  },
  camX: 0, camY: 0, hinted3: true, endTime: 0,
  loseWhy: 'race', winWhy: 'transcend', winTier: 5,
};
rebuild();

// --- toolbar
function button(label: string, onClick: () => void, group?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (group) b.dataset.group = group;
  b.addEventListener('click', () => onClick());
  bar.appendChild(b);
  return b;
}

function markSel(group: string, btn: HTMLButtonElement): void {
  bar.querySelectorAll(`button[data-group="${group}"]`).forEach(x => x.classList.remove('sel'));
  btn.classList.add('sel');
}

for (const [id, name, color] of TILE_NAMES) {
  const b = button(name, () => { selTile = id; markSel('tile', b); }, 'tile');
  b.style.borderBottom = `3px solid ${color}`;
  if (id === selTile) b.classList.add('sel');
}
const spacer = document.createElement('span');
spacer.className = 'lbl';
spacer.textContent = 'tier:';
bar.appendChild(spacer);
for (let t = 0; t <= 5; t++) {
  const b = button(`T${t}`, () => { selTier = t; fake.player.tier = t; markSel('tier', b); }, 'tier');
  if (t === selTier) b.classList.add('sel');
}
button('check connectivity', () => {
  say(poisReachable(world)
    ? 'OK: every shrine, berry, the altar and both homes are reachable'
    : 'BROKEN: some points of interest are UNREACHABLE — the rival may stall');
});
button('apply to game', () => {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(tiles)));
  say('applied — reload the game tab (same browser) to play this map');
});
button('clear override', () => {
  localStorage.removeItem(LS_KEY);
  say('override cleared — the game will use the built-in map again');
});
button('reset to built-in', () => {
  tiles = genWorld().tiles.slice();
  rebuild();
  say('reset to the generated map (not yet applied)');
});
button('download json', () => {
  const blob = new Blob([JSON.stringify(Array.from(tiles))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'upgrade-map.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- arena view (4px per tile, schematic colours)
const TILE_COLOR: string[] = [];
for (const [id, , color] of TILE_NAMES) TILE_COLOR[id] = color;
TILE_COLOR[Tl.GRASS] = '#122412';

function renderArena(): void {
  for (let ty = 0; ty < WORLD_TH; ty++) {
    for (let tx = 0; tx < WORLD_TW; tx++) {
      aCtx.fillStyle = TILE_COLOR[tiles[ty * WORLD_TW + tx]] ?? '#f0f';
      aCtx.fillRect(tx * 4, ty * 4, 4, 4);
    }
  }
  aCtx.strokeStyle = 'rgba(255,255,255,0.25)';
  for (let sx = 1; sx < WORLD_SW; sx++) {
    aCtx.beginPath(); aCtx.moveTo(sx * SCR_TW * 4, 0); aCtx.lineTo(sx * SCR_TW * 4, WORLD_TH * 4); aCtx.stroke();
  }
  for (let sy = 1; sy < WORLD_SH; sy++) {
    aCtx.beginPath(); aCtx.moveTo(0, sy * SCR_TH * 4); aCtx.lineTo(WORLD_TW * 4, sy * SCR_TH * 4); aCtx.stroke();
  }
  aCtx.strokeStyle = '#ffffff';
  aCtx.lineWidth = 2;
  aCtx.strokeRect(sel.x * SCR_TW * 4 + 1, sel.y * SCR_TH * 4 + 1, SCR_TW * 4 - 2, SCR_TH * 4 - 2);
  aCtx.lineWidth = 1;
}

arena.addEventListener('mousedown', e => {
  const r = arena.getBoundingClientRect();
  sel = {
    x: Math.min(WORLD_SW - 1, Math.floor((e.clientX - r.left) / r.width * WORLD_SW)),
    y: Math.min(WORLD_SH - 1, Math.floor((e.clientY - r.top) / r.height * WORLD_SH)),
  };
  fake.camX = sel.x * SCR_W;
  fake.camY = sel.y * SCR_H;
  dirtyArena = true;
  say(`editing screen (${sel.x},${sel.y})`);
});

// --- screen painting
let painting = 0; // 0 none, 1 paint, 2 erase
function paintAt(e: MouseEvent): void {
  const r = screenC.getBoundingClientRect();
  const lx = Math.floor((e.clientX - r.left) / r.width * SCR_TW);
  const ly = Math.floor((e.clientY - r.top) / r.height * SCR_TH);
  if (lx < 0 || ly < 0 || lx >= SCR_TW || ly >= SCR_TH) return;
  const tx = sel.x * SCR_TW + lx, ty = sel.y * SCR_TH + ly;
  const t = painting === 2 ? Tl.GRASS : selTile;
  if (tiles[ty * WORLD_TW + tx] !== t) {
    tiles[ty * WORLD_TW + tx] = t;
    rebuild();
  }
}
screenC.addEventListener('contextmenu', e => e.preventDefault());
screenC.addEventListener('mousedown', e => { painting = e.button === 2 ? 2 : 1; paintAt(e); });
screenC.addEventListener('mousemove', e => { if (painting) paintAt(e); });
window.addEventListener('mouseup', () => { painting = 0; });

// --- loop
fake.camX = sel.x * SCR_W;
fake.camY = sel.y * SCR_H;
const t0 = performance.now();
let lastFrame = t0;

function frame(now: number): void {
  lastFrame = now;
  fake.time = (now - t0) / 1000;
  fake.player.tier = selTier;
  if (dirtyArena) { renderArena(); dirtyArena = false; }
  renderPlay(sCtx, fake, selTier);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => {
  const now = performance.now();
  if (now - lastFrame > 150) frame(now);
}, 100);
