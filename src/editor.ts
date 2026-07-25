// UPGRADE map tile editor.
// Edit the fixed map, preview any screen at any tier (T0-T5) via the real game
// renderers, and stage the result for the game via localStorage ("Apply").

import {
  Game, World, Tl, TILE, SCR_TW, SCR_TH, SCR_W, SCR_H, WORLD_TW, WORLD_TH,
  WORLD_SW, WORLD_SH, START_TIER,
} from './defs';
import { genWorld, worldFromTiles, poisReachable } from './map';
import { ruleGenTiles } from './rulegen';
import { renderPlay } from './render';

const LS_KEY = 'upgrade-map';

const TILE_NAMES: [number, string, string][] = [
  [Tl.GRASS, 'grass', '#1c4a1c'], [Tl.DIRT, 'dirt', '#57452e'], [Tl.PATH, 'path', '#b09a50'],
  [Tl.TREE, 'tree', '#2e8a2e'],
  [Tl.WATER, 'water', '#2a4ac0'], [Tl.REED, 'reed', '#6aa84f'], [Tl.WALL, 'wall', '#909090'],
  [Tl.ROCK, 'rock', '#6a6a72'], [Tl.STONE, 'stone', '#e8e8f0'], [Tl.ALTAR, 'altar', '#40e0e8'],
  [Tl.SHRINE, 'shrine', '#e8d040'], [Tl.WELL, 'well', '#b8b8c8'], [Tl.HUT, 'hut', '#c05838'],
  [Tl.BERRY, 'berry', '#d04058'],
  [Tl.PBASE, 'p-base', '#40e0e8'], [Tl.RBASE, 'r-base', '#f06078'],
  [Tl.RUIN, 'ruin', '#77766e'], [Tl.PUSH, 'push', '#3e9a94'],
];

// Point features never take a wide brush; area tiles do.
const SINGLE_PLACE = new Set<number>([Tl.SHRINE, Tl.BERRY, Tl.WELL, Tl.ALTAR, Tl.PBASE, Tl.RBASE]);

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
  mode: 'play', difficulty: 'hard', loadT: 0, time: 0, world,
  player: offEnt(), rival: { ...offEnt(), rival: true },
  bolts: [], shards: [], fx: [], berryCd: [],
  respawn: 99, msg: '', msgUntil: 0, push: null, drag: null, burns: [], dmg: {}, ripple: -1, rippleFrom: 1,
  ai: {
    state: '', path: [], pathI: 0, repath: 0, lastX: 0, lastY: 0, stuck: 0,
    targetKey: '', interceptT: 0, coolUntil: 0, pauseUntil: 0, nearT: 0,
  },
  camX: 0, camY: 0, hinted3: true, endTime: 0,
  loseWhy: 'race', winWhy: 'transcend', winTier: 5,
  maxTier: 5, kills: 0, score: 0, scored: false, entryActive: false, entryName: '',
  mapName: 'EDITOR', chaosSeed: null, seedEntry: null, escArmUntil: 0,
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
// Eraser: conceptually distinct from "paint grass", functionally the same.
const eraserBtn = button('eraser', () => { selTile = Tl.GRASS; markSel('tile', eraserBtn); }, 'tile');
eraserBtn.style.borderBottom = '3px solid #000';

// Brush width (area tiles only; point features always place singly).
let brush = 1;
const brushLbl = document.createElement('span');
brushLbl.className = 'lbl';
brushLbl.textContent = 'brush:';
bar.appendChild(brushLbl);
for (const b of [1, 2, 3, 5]) {
  const btn = button(`${b}`, () => { brush = b; markSel('brush', btn); }, 'brush');
  if (b === 1) btn.classList.add('sel');
}
const spacer = document.createElement('span');
spacer.className = 'lbl';
spacer.textContent = 'tier:';
bar.appendChild(spacer);
for (let t = 0; t <= 5; t++) {
  const b = button(`T${t}`, () => { selTier = t; fake.player.tier = t; markSel('tier', b); }, 'tier');
  if (t === selTier) b.classList.add('sel');
}
// Map name: tags hi-score entries so scores compare like with like.
const nameInput = document.createElement('input');
nameInput.value = (localStorage.getItem('upgrade-map-name') || 'CUSTOM').slice(0, 6);
nameInput.maxLength = 6;
nameInput.style.cssText = 'width:70px;background:#262636;color:#ddd;border:1px solid #444;font:12px monospace;padding:4px;text-transform:uppercase';
nameInput.title = 'map name (max 6 chars, tags hi-scores)';
bar.appendChild(nameInput);

button('check connectivity', () => {
  say(poisReachable(world)
    ? 'OK: every shrine, berry, the altar and both homes are reachable'
    : 'BROKEN: some points of interest are UNREACHABLE — the rival may stall');
});
button('apply to game', () => {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(tiles)));
  localStorage.setItem('upgrade-map-name', nameInput.value.toUpperCase().slice(0, 6) || 'CUSTOM');
  say('applied — reload the game tab (same browser) to play this map');
});
button('clear override', () => {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem('upgrade-map-name');
  say('override cleared — the game will use the built-in map again');
});
button('reset to built-in', () => {
  tiles = genWorld().tiles.slice();
  rebuild();
  say('reset to the generated map (not yet applied)');
});
button('clear screen', () => {
  for (let ly = 0; ly < SCR_TH; ly++) {
    for (let lx = 0; lx < SCR_TW; lx++) {
      const tx = sel.x * SCR_TW + lx, ty = sel.y * SCR_TH + ly;
      if (tx > 0 && ty > 0 && tx < WORLD_TW - 1 && ty < WORLD_TH - 1) tiles[ty * WORLD_TW + tx] = Tl.GRASS;
    }
  }
  rebuild();
  say(`cleared screen (${sel.x},${sel.y}) to grass`);
});
// Rule-based generator: rivers, forests, rock, berries-near-trees,
// repelled stone circle, spaced shrines, accessibility-driven bridges.
const seedInput = document.createElement('input');
seedInput.value = '1';
seedInput.style.cssText = 'width:52px;background:#262636;color:#ddd;border:1px solid #444;font:12px monospace;padding:4px';
seedInput.title = 'generator seed';
bar.appendChild(seedInput);
button('generate', () => {
  const seed = parseInt(seedInput.value, 10) || 1;
  tiles = ruleGenTiles(seed);
  nameInput.value = `GEN${seed}`.slice(0, 6);
  rebuild();
  say(`generated map from seed ${seed} — check connectivity, tweak, then apply/download`);
});
button('blank map', () => {
  tiles = new Uint8Array(WORLD_TW * WORLD_TH).fill(Tl.GRASS);
  for (let tx = 0; tx < WORLD_TW; tx++) { tiles[tx] = Tl.TREE; tiles[(WORLD_TH - 1) * WORLD_TW + tx] = Tl.TREE; }
  for (let ty = 0; ty < WORLD_TH; ty++) { tiles[ty * WORLD_TW] = Tl.TREE; tiles[ty * WORLD_TW + WORLD_TW - 1] = Tl.TREE; }
  rebuild();
  say('blank map: paint an ALTAR (2x2), SHRINEs and BERRYs, then check connectivity');
});
button('download json', () => {
  const name = nameInput.value.toUpperCase().slice(0, 6) || 'CUSTOM';
  const blob = new Blob([JSON.stringify({ name, tiles: Array.from(tiles) })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `upgrade-map-${name.toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
// Load a playtester-contributed map file ({name, tiles} or a bare tile array).
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.json';
fileInput.style.display = 'none';
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text()) as { name?: string; tiles?: number[] } | number[];
    const arr = Array.isArray(data) ? data : data.tiles;
    if (!arr || arr.length !== tiles.length) throw new Error('wrong size');
    tiles = Uint8Array.from(arr);
    if (!Array.isArray(data) && data.name) nameInput.value = String(data.name).slice(0, 6);
    rebuild();
    say(`loaded "${f.name}" (not yet applied)`);
  } catch (err) {
    say(`could not load: ${err instanceof Error ? err.message : 'bad file'}`);
  }
  fileInput.value = '';
});
document.body.appendChild(fileInput);
button('load json', () => fileInput.click());

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

// Arena mode: "select" clicks pick a screen; "paint" drags edit tiles at
// arena scale — for coherent whole-world features like rivers and hedges.
let arenaPaint = false;
const arenaModeBtn = button('arena: select', () => {
  arenaPaint = !arenaPaint;
  arenaModeBtn.textContent = arenaPaint ? 'arena: paint' : 'arena: select';
  say(arenaPaint
    ? 'arena painting on — drag to paint, right-drag to erase, shift-click to select a screen'
    : 'arena click selects a screen');
});

let arenaPainting = 0;
function paintArenaAt(e: MouseEvent): void {
  const r = arena.getBoundingClientRect();
  const tx = Math.floor((e.clientX - r.left) / r.width * WORLD_TW);
  const ty = Math.floor((e.clientY - r.top) / r.height * WORLD_TH);
  if (tx < 0 || ty < 0 || tx >= WORLD_TW || ty >= WORLD_TH) return;
  stampBrush(tx, ty, arenaPainting === 2);
}

arena.addEventListener('contextmenu', e => e.preventDefault());
arena.addEventListener('mousedown', e => {
  if (arenaPaint && !e.shiftKey) {
    arenaPainting = e.button === 2 ? 2 : 1;
    paintArenaAt(e);
    return;
  }
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
arena.addEventListener('mousemove', e => { if (arenaPainting) paintArenaAt(e); });
window.addEventListener('mouseup', () => { arenaPainting = 0; });

// --- brush stamping shared by both canvases
function stampBrush(tx: number, ty: number, erase: boolean): void {
  const t = erase ? Tl.GRASS : selTile;
  const b = SINGLE_PLACE.has(t) ? 1 : brush;
  const off = Math.floor(b / 2);
  let changed = false;
  for (let dy = 0; dy < b; dy++) {
    for (let dx = 0; dx < b; dx++) {
      const x = tx - off + dx, y = ty - off + dy;
      if (x < 1 || y < 1 || x >= WORLD_TW - 1 || y >= WORLD_TH - 1) continue;
      if (tiles[y * WORLD_TW + x] !== t) { tiles[y * WORLD_TW + x] = t; changed = true; }
    }
  }
  if (changed) rebuild();
}

// --- screen painting
let painting = 0; // 0 none, 1 paint, 2 erase
function paintAt(e: MouseEvent): void {
  const r = screenC.getBoundingClientRect();
  const lx = Math.floor((e.clientX - r.left) / r.width * SCR_TW);
  const ly = Math.floor((e.clientY - r.top) / r.height * SCR_TH);
  if (lx < 0 || ly < 0 || lx >= SCR_TW || ly >= SCR_TH) return;
  stampBrush(sel.x * SCR_TW + lx, sel.y * SCR_TH + ly, painting === 2);
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
