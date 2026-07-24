// World generation and world loading.
// The shipped map is FIXED: one hard-coded seed, identical world every game.
// The generator is an authoring tool; edited maps (from the tile editor) load
// through worldFromTiles(), which derives shrines/berries/altar by scanning.

import {
  SCR_TW, SCR_TH, TILE, WORLD_TW, WORLD_TH, Tl, SOLID, World, Vec, PUSH_CFG,
} from './defs';
import { ruleGenTiles } from './rulegen';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tileAt(w: World, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= WORLD_TW || ty >= WORLD_TH) return Tl.TREE;
  return w.tiles[ty * WORLD_TW + tx];
}

export function solidTile(w: World, tx: number, ty: number): boolean {
  return SOLID.has(tileAt(w, tx, ty));
}

export function solidPx(w: World, x: number, y: number): boolean {
  return solidTile(w, Math.floor(x / TILE), Math.floor(y / TILE));
}

// Bolts (and firing sightlines) pass over water but not solid ground cover.
export function blocksBolt(w: World, x: number, y: number): boolean {
  const t = tileAt(w, Math.floor(x / TILE), Math.floor(y / TILE));
  return SOLID.has(t) && t !== Tl.WATER;
}

// A pushstone only budges along a straight line into water. The push is valid
// when at most maxSlide clear tiles separate stone from water, the water run
// it meets is fordable (≤ maxSpan tiles to a walkable far bank). Returns the
// water tiles to carve into causeway — widened to two abreast when the
// parallel column is also water, so the ford walks like the built bridges —
// or null when this direction goes nowhere useful.
export function pushSlideTiles(
  tiles: Uint8Array, tx: number, ty: number, dx: number, dy: number,
): { carve: Vec[] } | null {
  const at = (x: number, y: number): number =>
    (x < 0 || y < 0 || x >= WORLD_TW || y >= WORLD_TH) ? Tl.TREE : tiles[y * WORLD_TW + x];
  const clear = (t: number): boolean => t === Tl.GRASS || t === Tl.PATH || t === Tl.DIRT;
  let x = tx + dx, y = ty + dy;
  for (let slid = 0; slid < PUSH_CFG.maxSlide && clear(at(x, y)); slid++) { x += dx; y += dy; }
  if (at(x, y) !== Tl.WATER) return null;
  const run: Vec[] = [];
  while (at(x, y) === Tl.WATER && run.length <= PUSH_CFG.maxSpan) {
    run.push({ x, y }); x += dx; y += dy;
  }
  if (run.length > PUSH_CFG.maxSpan) return null;
  if (SOLID.has(at(x, y))) return null;   // far bank must be walkable
  const px = dy !== 0 ? 1 : 0, py = dx !== 0 ? 1 : 0;   // perpendicular axis
  for (const side of [1, -1]) {
    if (run.every(c => at(c.x + px * side, c.y + py * side) === Tl.WATER)
      && !SOLID.has(at(x + px * side, y + py * side))) {
      return { carve: [...run, ...run.map(c => ({ x: c.x + px * side, y: c.y + py * side }))] };
    }
  }
  return { carve: run };
}

export function pushSlide(
  w: World, tx: number, ty: number, dx: number, dy: number,
): { carve: Vec[] } | null {
  return pushSlideTiles(w.tiles, tx, ty, dx, dy);
}

const P_HOME_TX = 14, P_HOME_TY = 3 * SCR_TH + 12;
const R_HOME_TX = 5 * SCR_TW + 16, R_HOME_TY = 3 * SCR_TH + 14;

export function floodFrom(tiles: Uint8Array, tx: number, ty: number): Uint8Array {
  const reach = new Uint8Array(WORLD_TW * WORLD_TH);
  const q = [ty * WORLD_TW + tx];
  reach[q[0]] = 1;
  while (q.length) {
    const cur = q.pop()!;
    const cx = cur % WORLD_TW, cy = (cur / WORLD_TW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_TW || ny >= WORLD_TH) continue;
      const ni = ny * WORLD_TW + nx;
      if (!reach[ni] && !SOLID.has(tiles[ni])) { reach[ni] = 1; q.push(ni); }
    }
  }
  return reach;
}

function scanTiles(tiles: Uint8Array, t: number): Vec[] {
  const out: Vec[] = [];
  for (let ty = 0; ty < WORLD_TH; ty++) {
    for (let tx = 0; tx < WORLD_TW; tx++) {
      if (tiles[ty * WORLD_TW + tx] === t) out.push({ x: tx, y: ty });
    }
  }
  return out;
}

// Build a playable World from a raw tile array (generated or hand-edited).
// Homes come from PBASE/RBASE marker tiles when present (movable bases);
// legacy maps without markers fall back to the canonical corners.
export function worldFromTiles(tiles: Uint8Array): World {
  const altarTiles = scanTiles(tiles, Tl.ALTAR);
  let ax = (3 * SCR_TW + 16) * TILE, ay = 11 * TILE;
  if (altarTiles.length) {
    ax = (altarTiles.reduce((s, v) => s + v.x, 0) / altarTiles.length + 0.5) * TILE;
    ay = (altarTiles.reduce((s, v) => s + v.y, 0) / altarTiles.length + 0.5) * TILE;
  }
  const pb = scanTiles(tiles, Tl.PBASE)[0];
  const rb = scanTiles(tiles, Tl.RBASE)[0];
  const pHomeX = pb ? pb.x * TILE + 4 : P_HOME_TX * TILE;
  const pHomeY = pb ? pb.y * TILE + 4 : P_HOME_TY * TILE;
  const rHomeX = rb ? rb.x * TILE + 4 : R_HOME_TX * TILE;
  const rHomeY = rb ? rb.y * TILE + 4 : R_HOME_TY * TILE;

  // Wand station: 3 tiles from home, choosing the candidate that sits deepest
  // inside the home screen — a pedestal near a screen edge gets walked over by
  // accident on the way through.
  const placeStation = (hx: number, hy: number): Vec => {
    const htx = Math.floor(hx / TILE), hty = Math.floor(hy / TILE);
    const scrX = Math.floor(htx / SCR_TW), scrY = Math.floor(hty / SCR_TH);
    let best: { tx: number; ty: number; margin: number } | null = null;
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]] as const) {
      const tx = htx + dx, ty = hty + dy;
      if (tx < 1 || ty < 1 || tx >= WORLD_TW - 1 || ty >= WORLD_TH - 1) continue;
      if (Math.floor(tx / SCR_TW) !== scrX || Math.floor(ty / SCR_TH) !== scrY) continue;
      if (SOLID.has(tiles[ty * WORLD_TW + tx])) continue;
      const lx = tx % SCR_TW, ly = ty % SCR_TH;
      const margin = Math.min(lx, SCR_TW - 1 - lx, ly, SCR_TH - 1 - ly);
      if (!best || margin > best.margin) best = { tx, ty, margin };
    }
    if (!best) best = { tx: htx + 3, ty: hty, margin: 0 };
    return { x: best.tx * TILE + 4, y: best.ty * TILE + 4 };
  };
  const pSt = placeStation(pHomeX, pHomeY);
  const rSt = placeStation(rHomeX, rHomeY);

  return {
    tiles,
    shrines: scanTiles(tiles, Tl.SHRINE),
    berrySpots: scanTiles(tiles, Tl.BERRY),
    altarX: ax, altarY: ay,
    pHomeX, pHomeY, rHomeX, rHomeY,
    pStationX: pSt.x, pStationY: pSt.y,
    rStationX: rSt.x, rStationY: rSt.y,
    pSafe: { x: Math.floor(pHomeX / (SCR_TW * TILE)), y: Math.floor(pHomeY / (SCR_TH * TILE)) },
    rSafe: { x: Math.floor(rHomeX / (SCR_TW * TILE)), y: Math.floor(rHomeY / (SCR_TH * TILE)) },
  };
}

// True when every shrine, berry, the altar, and both homes are mutually walkable.
export function poisReachable(w: World): boolean {
  const reach = floodFrom(w.tiles, Math.floor(w.pHomeX / TILE), Math.floor(w.pHomeY / TILE));
  const pois: Vec[] = [
    ...w.shrines, ...w.berrySpots,
    { x: Math.floor(w.altarX / TILE), y: Math.floor(w.altarY / TILE) },
    { x: Math.floor(w.rHomeX / TILE), y: Math.floor(w.rHomeY / TILE) },
  ];
  return pois.every(p => reach[p.y * WORLD_TW + p.x]);
}

// The default map: rule-generated from a hand-picked seed whose qualities
// echo the original hand-authored VALE (SW village, NE keep, full-width
// mid-river, north stone circle). Deterministic — identical every game.
export const DEFAULT_MAP_SEED = 6;

// Hand-tuning on top of the rules: the grown tributary in the south-west ran
// its whole length one tile west of the x=32 screen seam — from the
// neighbouring screen the way west just "didn't work", with nothing visible
// to say why — and it left only a 3-tile corridor along the southern edge.
// Trim its southern fifth (the corridor becomes 8 tiles) and widen it two
// tiles east so water shows on both sides of the seam.
function tuneGlenTributary(T: Uint8Array): void {
  const at = (x: number, y: number) => T[y * WORLD_TW + x];
  const put = (x: number, y: number, t: number) => { T[y * WORLD_TW + x] = t; };
  const open = (t: number) => t === Tl.GRASS || t === Tl.REED;
  for (let y = 79; y <= 84; y++) {
    for (let x = 27; x <= 33; x++) {
      if (at(x, y) === Tl.WATER || at(x, y) === Tl.REED) put(x, y, Tl.GRASS);
    }
  }
  for (let y = 59; y <= 78; y++) {
    let right = -1;
    for (let x = 28; x <= 33; x++) if (at(x, y) === Tl.WATER) right = x;
    if (right < 0) continue;
    for (let x = right + 1; x <= right + 2; x++) if (open(at(x, y))) put(x, y, Tl.WATER);
    // reeds flag the new east bank to players approaching from the next screen
    if (y % 3 === 0 && open(at(right + 3, y))) put(right + 3, y, Tl.REED);
  }
}

// GLEN's raw tiles, pre-evolution: the canonical launch valley.
export function glenTiles(): Uint8Array {
  const tiles = ruleGenTiles(DEFAULT_MAP_SEED);
  tuneGlenTributary(tiles);
  return tiles;
}

export function genWorld(): World {
  return worldFromTiles(glenTiles());
}

// Region per screen
function region(sx: number, sy: number): string {
  if (sx === 0 && sy === 3) return 'village';
  if (sx === 5 && sy === 3) return 'keep';
  if (sx === 3 && sy === 0) return 'stones';
  if (sx >= 4 && sy <= 1) return 'marsh';
  if (sx >= 1 && sx <= 4 && sy >= 1 && sy <= 2) return 'forest';
  return 'meadow';
}

export function genClassicWorld(): World {
  const rng = mulberry32(1337);
  const tiles = new Uint8Array(WORLD_TW * WORLD_TH).fill(Tl.GRASS);
  const set = (tx: number, ty: number, t: number) => {
    if (tx >= 0 && ty >= 0 && tx < WORLD_TW && ty < WORLD_TH) tiles[ty * WORLD_TW + tx] = t;
  };
  const get = (tx: number, ty: number) => tiles[ty * WORLD_TW + tx];

  const onGrass = (tx: number, ty: number, t: number) => {
    if (tx > 0 && ty > 0 && tx < WORLD_TW - 1 && ty < WORLD_TH - 1 && get(tx, ty) === Tl.GRASS) set(tx, ty, t);
  };
  const blob = (cx: number, cy: number, r: number, t: number) => {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy <= r * r) onGrass(cx + dx, cy + dy, t);
      }
    }
  };
  const barLine = (x0: number, y0: number, horiz: boolean, len: number, t: number) => {
    for (let i = 0; i < len; i++) onGrass(x0 + (horiz ? i : 0), y0 + (horiz ? 0 : i), t);
  };

  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 6; sx++) {
      const bx = sx * SCR_TW, by = sy * SCR_TH;
      const L = (lx: number, ly: number, t: number) => set(bx + lx, by + ly, t);
      const rndBar = (t: number) => {
        const horiz = rng() < 0.5;
        const len = 5 + Math.floor(rng() * 7);
        barLine(bx + 2 + Math.floor(rng() * (horiz ? 24 : 28)),
          by + 2 + Math.floor(rng() * (horiz ? 18 : 12)), horiz, len, t);
      };
      const berries = (n: number) => {
        for (let i = 0; i < n; i++) {
          onGrass(bx + 2 + Math.floor(rng() * 28), by + 2 + Math.floor(rng() * 18), Tl.BERRY);
        }
      };
      const reg = region(sx, sy);
      if (reg === 'forest') {
        for (let i = 0; i < 12; i++) {
          blob(bx + 2 + Math.floor(rng() * 28), by + 2 + Math.floor(rng() * 18), 1 + rng() * 1.6, Tl.TREE);
        }
        for (let i = 0; i < 3; i++) rndBar(Tl.TREE);
        berries(2);
      } else if (reg === 'meadow') {
        for (let i = 0; i < 8; i++) {
          onGrass(bx + 2 + Math.floor(rng() * 28), by + 2 + Math.floor(rng() * 18), rng() < 0.7 ? Tl.TREE : Tl.ROCK);
        }
        for (let i = 0; i < 2; i++) rndBar(rng() < 0.6 ? Tl.TREE : Tl.ROCK);
        berries(1);
      } else if (reg === 'marsh') {
        for (let i = 0; i < 5; i++) {
          blob(bx + 3 + Math.floor(rng() * 26), by + 3 + Math.floor(rng() * 16), 1 + rng() * 1.8, Tl.WATER);
        }
        for (let i = 0; i < 2; i++) rndBar(Tl.WATER);
        for (let i = 0; i < 16; i++) {
          onGrass(bx + 2 + Math.floor(rng() * 28), by + 2 + Math.floor(rng() * 18), Tl.REED);
        }
        berries(1);
      } else if (reg === 'village') {
        for (let y = 2; y <= 6; y++) for (let x = 3; x <= 9; x++) L(x, y, Tl.HUT);
        for (let y = 2; y <= 6; y++) for (let x = 20; x <= 26; x++) L(x, y, Tl.HUT);
        for (let y = 15; y <= 19; y++) for (let x = 4; x <= 10; x++) L(x, y, Tl.HUT);
        L(12, 7, Tl.WELL);
        for (let i = 0; i < 4; i++) onGrass(bx + 20 + Math.floor(rng() * 10), by + 14 + Math.floor(rng() * 6), Tl.TREE);
        rndBar(Tl.TREE);
        berries(1);
      } else if (reg === 'keep') {
        const gate = (lx: number, ly: number) =>
          (ly === 19 && (lx === 15 || lx === 16)) || (lx === 3 && (ly === 10 || ly === 11))
          || (ly === 2 && (lx === 15 || lx === 16));
        for (let x = 3; x <= 28; x++) {
          if (!gate(x, 2)) L(x, 2, Tl.WALL);
          if (!gate(x, 19)) L(x, 19, Tl.WALL);
        }
        for (let y = 2; y <= 19; y++) {
          if (!gate(3, y)) L(3, y, Tl.WALL);
          if (!gate(28, y)) L(28, y, Tl.WALL);
        }
        for (let y = 4; y <= 17; y++) {
          if (y !== 10 && y !== 11) L(9, y, Tl.WALL);
          if (y !== 13 && y !== 14) L(22, y, Tl.WALL);
        }
        for (let i = 0; i < 5; i++) onGrass(bx + 11 + Math.floor(rng() * 10), by + 4 + Math.floor(rng() * 5), Tl.ROCK);
      } else if (reg === 'stones') {
        for (let i = 0; i < 14; i++) {
          if (i === 3 || i === 10) continue;
          const a = (i / 14) * Math.PI * 2;
          const lx = 16 + Math.round(Math.cos(a) * 7);
          const ly = 11 + Math.round(Math.sin(a) * 5.5);
          if (get(bx + lx, by + ly) === Tl.GRASS) L(lx, ly, Tl.STONE);
        }
        for (let y = 10; y <= 11; y++) for (let x = 15; x <= 16; x++) L(x, y, Tl.ALTAR);
      }
    }
  }

  // --- The maze layer: river + hedgerow barriers between screens.
  const BRIDGE_COLS = new Set([1 * SCR_TW + 15, 1 * SCR_TW + 16, 4 * SCR_TW + 15, 4 * SCR_TW + 16]);
  for (let ty = 42; ty <= 44; ty++) {
    for (let tx = 1; tx < WORLD_TW - 1; tx++) {
      set(tx, ty, BRIDGE_COLS.has(tx) ? Tl.PATH : Tl.WATER);
    }
  }
  for (const tx of BRIDGE_COLS) {
    for (let ty = 40; ty <= 46; ty++) if (get(tx, ty) !== Tl.PATH) set(tx, ty, Tl.PATH);
  }
  // Stream spurs: short water barriers running off the river into screens.
  for (let k = 0; k < 4; k++) {
    const tx = 12 + Math.floor(rng() * 168);
    if ([...BRIDGE_COLS].some(b => Math.abs(b - tx) < 5)) continue;
    const up = rng() < 0.5;
    const len = 6 + Math.floor(rng() * 8);
    for (let i = 1; i <= len; i++) onGrass(tx, up ? 42 - i : 44 + i, Tl.WATER);
  }

  // Closed screen edges (hand-picked; the graph stays fully connected).
  const closedEW: [number, number][] = [[1, 0], [3, 0], [0, 2], [3, 2], [2, 3]];
  for (const [sx, sy] of closedEW) {
    const tx = (sx + 1) * SCR_TW;
    for (let ty = sy * SCR_TH; ty < (sy + 1) * SCR_TH; ty++) {
      set(tx - 1, ty, Tl.TREE); set(tx, ty, Tl.TREE);
    }
  }
  const closedNS: [number, number][] = [[0, 0], [2, 0], [5, 0], [1, 2], [3, 2]];
  for (const [sx, sy] of closedNS) {
    const ty = (sy + 1) * SCR_TH;
    for (let tx = sx * SCR_TW; tx < (sx + 1) * SCR_TW; tx++) {
      set(tx, ty - 1, Tl.TREE); set(tx, ty, Tl.TREE);
    }
  }

  // Doorways: every OPEN screen edge gets one randomly-placed gateway.
  const ewClosed = new Set(closedEW.map(([a, b]) => `${a},${b}`));
  const nsClosed = new Set(closedNS.map(([a, b]) => `${a},${b}`));
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 5; sx++) {
      if (ewClosed.has(`${sx},${sy}`)) continue;
      const tx = (sx + 1) * SCR_TW;
      const ly = sy * SCR_TH + 3 + Math.floor(rng() * (SCR_TH - 8));
      for (let dx = -2; dx <= 1; dx++) {
        for (let dy = 0; dy <= 1; dy++) set(tx + dx, ly + dy, Tl.PATH);
      }
    }
  }
  for (let sy = 0; sy < 3; sy++) {
    if (sy === 1) continue; // the river boundary: bridges only
    for (let sx = 0; sx < 6; sx++) {
      if (nsClosed.has(`${sx},${sy}`)) continue;
      const ty = (sy + 1) * SCR_TH;
      const lx = sx * SCR_TW + 3 + Math.floor(rng() * (SCR_TW - 8));
      for (let dy = -2; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) set(lx + dx, ty + dy, Tl.PATH);
      }
    }
  }

  // World border
  for (let tx = 0; tx < WORLD_TW; tx++) { set(tx, 0, Tl.TREE); set(tx, WORLD_TH - 1, Tl.TREE); }
  for (let ty = 0; ty < WORLD_TH; ty++) { set(0, ty, Tl.TREE); set(WORLD_TW - 1, ty, Tl.TREE); }

  // Shrines: (screen sx, sy, local lx, ly) — 20 of them.
  const shrineDefs: [number, number, number, number][] = [
    [0, 3, 25, 15], [1, 1, 6, 5], [2, 2, 24, 16], [3, 1, 8, 15], [4, 2, 20, 4],
    [5, 0, 8, 14], [4, 1, 22, 6], [5, 3, 18, 13], [0, 0, 10, 6], [2, 3, 10, 16],
    [1, 0, 20, 6], [2, 1, 24, 5], [5, 2, 10, 8], [3, 3, 24, 7],
    [0, 1, 16, 14], [1, 2, 8, 6], [4, 3, 12, 14], [2, 0, 10, 4], [4, 0, 10, 16], [5, 1, 20, 16],
  ];
  for (const [sx, sy, lx, ly] of shrineDefs) {
    const tx = sx * SCR_TW + lx, ty = sy * SCR_TH + ly;
    set(tx, ty, Tl.SHRINE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && SOLID.has(get(tx + dx, ty + dy))) set(tx + dx, ty + dy, Tl.GRASS);
      }
    }
  }

  // Clear a patch around homes and the wand stations (a stray tree on a
  // station tile makes the pedestal unreachable and invisible), then plant
  // the home markers.
  for (const [htx, hty] of [
    [P_HOME_TX, P_HOME_TY], [R_HOME_TX, R_HOME_TY], [17, 3 * SCR_TH + 12], [5 * SCR_TW + 13, 3 * SCR_TH + 14],
  ]) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (SOLID.has(get(htx + dx, hty + dy))) set(htx + dx, hty + dy, Tl.GRASS);
      }
    }
  }
  set(P_HOME_TX, P_HOME_TY, Tl.PBASE);
  set(R_HOME_TX, R_HOME_TY, Tl.RBASE);

  // --- Connectivity repair: PROVE every point of interest is walkable from
  // the player's home; carve an emergency path if not.
  const pois = [
    ...scanTiles(tiles, Tl.SHRINE),
    ...scanTiles(tiles, Tl.BERRY),
    { x: 3 * SCR_TW + 16, y: 11 },
    { x: R_HOME_TX, y: R_HOME_TY },
  ];
  let reach = floodFrom(tiles, P_HOME_TX, P_HOME_TY);
  for (const poi of pois) {
    if (reach[poi.y * WORLD_TW + poi.x]) continue;
    let cx = poi.x, cy = poi.y;
    let guard = 600;
    while (!reach[cy * WORLD_TW + cx] && guard-- > 0) {
      if (SOLID.has(get(cx, cy))) set(cx, cy, Tl.PATH);
      if (cx !== P_HOME_TX) cx += Math.sign(P_HOME_TX - cx);
      else if (cy !== P_HOME_TY) cy += Math.sign(P_HOME_TY - cy);
      else break;
    }
    reach = floodFrom(tiles, P_HOME_TX, P_HOME_TY);
  }

  return worldFromTiles(tiles);
}

// Axis-separated bbox move. Half-extent 3px: a body centred on a tile centre
// (±4px to the tile edge) must fit fully inside it, or tile-centre waypoint
// paths wedge against walls in 1- and 2-tile corridors.
// `other` is the opposing wizard: bodies block each other, but only against
// APPROACHING moves, so overlapping entities can always separate.
export function moveEnt(
  w: World, e: { x: number; y: number }, dx: number, dy: number,
  other?: { x: number; y: number },
): number {
  const H = 3;
  const bumps = (nx: number, ny: number): boolean => {
    if (!other) return false;
    const dNew = Math.hypot(nx - other.x, ny - other.y);
    return dNew < 11 && dNew < Math.hypot(e.x - other.x, e.y - other.y);
  };
  let moved = 0;
  if (dx !== 0) {
    const nx = e.x + dx;
    const ex = nx + Math.sign(dx) * H;
    if (!solidPx(w, ex, e.y - H) && !solidPx(w, ex, e.y + H) && !bumps(nx, e.y)) { e.x = nx; moved += Math.abs(dx); }
  }
  if (dy !== 0) {
    const ny = e.y + dy;
    const ey = ny + Math.sign(dy) * H;
    if (!solidPx(w, e.x - H, ey) && !solidPx(w, e.x + H, ey) && !bumps(e.x, ny)) { e.y = ny; moved += Math.abs(dy); }
  }
  return moved;
}
