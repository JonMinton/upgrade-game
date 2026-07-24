// The living valley: between games the soft cover drifts — wood, turf, bare
// earth and reeds obey a seeded cellular automaton, one generation per
// completed game on that map. Everything built or gameplay-bearing is
// immutable. Deterministic per (map, generation): visit 7 is the same valley
// for everyone, whenever it is replayed.
//
// The same module owns the per-visit pushstone offer: a seeded coin flip,
// then placement at the crossing where a ford would save the longest detour.

import { Tl, SOLID, WORLD_TW, WORLD_TH, Vec } from './defs';
import { floodFrom, mulberry32, pushSlideTiles } from './map';

const W = WORLD_TW, H = WORLD_TH;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

export function rngFor(mapName: string, gen: number): () => number {
  return mulberry32((djb2(mapName) ^ Math.imul(gen + 1, 0x9e3779b9)) >>> 0);
}

// --- Visit ledger. Capped: the valley weathers toward equilibrium, and GLEN
// hi-scores can only drift so far from launch-GLEN.
const EVO_CAP = 40;

export function visitCount(mapName: string): number {
  try {
    return Math.min(EVO_CAP, parseInt(localStorage.getItem('upgrade-evo-' + mapName) ?? '0', 10) || 0);
  } catch { return 0; }
}

export function bumpVisit(mapName: string): void {
  try {
    const raw = parseInt(localStorage.getItem('upgrade-evo-' + mapName) ?? '0', 10) || 0;
    localStorage.setItem('upgrade-evo-' + mapName, String(raw + 1));
  } catch { /* private mode */ }
}

// --- Per-generation change rates. The asymmetries are equilibria: turf heals
// faster than it wears, wood edges retreat faster than fronts advance, reeds
// stay pinned to the water. Tuned against a ~50-150 changed tiles/generation
// budget; live-editable via window.__evo.rates while playtesting.
export const EVO_RATES = {
  treeSenesce: 0.01,    // interior tree (>=6 tree nbrs) -> clearing
  treeExposed: 0.025,   // edge tree (<=3 tree nbrs) -> grass
  treeColonise: 0.03,   // grass with >=2 tree nbrs -> tree
  treeCloseIn: 0.05,    // grass with >=4 tree nbrs -> tree (gaps heal fast)
  turfWear: 0.04,       // grass with >=2 dirt nbrs -> dirt
  turfHeal: 0.05,       // dirt with >=3 grass nbrs -> grass
  reedGenesis: 0.02,    // grass/dirt on a water bank -> reed
  reedSpread: 0.03,     // grass/dirt by >=2 reeds, within 2 of water -> reed
  reedChurn: 0.025,     // reed on the water -> grass
  reedStrand: 0.08,     // reed stranded away from water -> grass
  witnessBias: 2.5,     // rate multiplier within 2 tiles of a path
};

// POI safety: everything a game needs reachable from the player's base.
// Returns null when the map has no base markers (nothing to check against).
function poisOk(tiles: Uint8Array): boolean | null {
  let home: Vec | null = null;
  const pois: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t === Tl.PBASE) home = { x: i % W, y: (i / W) | 0 };
    if (t === Tl.RBASE || t === Tl.ALTAR || t === Tl.SHRINE || t === Tl.BERRY) pois.push(i);
  }
  if (!home) return null;
  const reach = floodFrom(tiles, home.x, home.y);
  return pois.every(i => reach[i]);
}

// One CA generation, in place. Synchronous: all rules read a snapshot, so a
// death and a neighbouring birth in the same generation cannot interact.
// Solid births (trees) are guarded locally and the whole generation's births
// are reverted if they cost any POI its reachability — deaths never can.
export function evolveTiles(tiles: Uint8Array, mapName: string, gen: number): void {
  const R = EVO_RATES;
  const rng = rngFor(mapName, gen);
  const src = tiles.slice();
  const at = (x: number, y: number): number =>
    (x < 0 || y < 0 || x >= W || y >= H) ? Tl.TREE : src[y * W + x];
  const count8 = (x: number, y: number, t: number): number => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && at(x + dx, y + dy) === t) n++;
    }
    return n;
  };
  const solid8 = (x: number, y: number): number => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && SOLID.has(at(x + dx, y + dy))) n++;
    }
    return n;
  };
  const adj4 = (x: number, y: number, t: number): boolean =>
    at(x + 1, y) === t || at(x - 1, y) === t || at(x, y + 1) === t || at(x, y - 1) === t;
  const near = (x: number, y: number, t: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (at(x + dx, y + dy) === t) return true;
    }
    return false;
  };

  const treeBirths: number[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const t = src[i];
      if (t !== Tl.TREE && t !== Tl.GRASS && t !== Tl.DIRT && t !== Tl.REED) continue;
      const bias = near(x, y, Tl.PATH, 2) ? R.witnessBias : 1;
      const roll = (p: number): boolean => rng() < Math.min(1, p * bias);

      if (t === Tl.TREE) {
        const n = count8(x, y, Tl.TREE);
        if (n >= 6 ? roll(R.treeSenesce) : n <= 3 && roll(R.treeExposed)) tiles[i] = Tl.GRASS;
      } else if (t === Tl.REED) {
        if (adj4(x, y, Tl.WATER) ? roll(R.reedChurn) : roll(R.reedStrand)) tiles[i] = Tl.GRASS;
      } else {   // GRASS or DIRT
        if (adj4(x, y, Tl.WATER) && roll(R.reedGenesis)) { tiles[i] = Tl.REED; continue; }
        if (count8(x, y, Tl.REED) >= 2 && near(x, y, Tl.WATER, 2) && roll(R.reedSpread)) {
          tiles[i] = Tl.REED; continue;
        }
        if (t === Tl.GRASS) {
          const nT = count8(x, y, Tl.TREE);
          if ((nT >= 4 ? roll(R.treeCloseIn) : nT >= 2 && roll(R.treeColonise)) && solid8(x, y) <= 3) {
            tiles[i] = Tl.TREE; treeBirths.push(i); continue;
          }
          if (count8(x, y, Tl.DIRT) >= 2 && roll(R.turfWear)) tiles[i] = Tl.DIRT;
        } else {   // DIRT
          if (count8(x, y, Tl.GRASS) >= 3 && roll(R.turfHeal)) tiles[i] = Tl.GRASS;
        }
      }
    }
  }

  if (treeBirths.length && poisOk(tiles) === false) {
    for (const i of treeBirths) tiles[i] = src[i];
  }
}

// --- The per-visit pushstone offer.
//
// A seeded coin decides whether the valley offers a stone at all; when it
// does, candidate crossings are scored by the detour a ford there would save
// (or the region it would reconnect), and the stone lands 0-2 tiles back
// from the winning bank, square on the push line. pushSlideTiles is the
// validator, so the offer can never disagree with the mechanic.

interface Site { ax: number; ay: number; dx: number; dy: number; score: number }

function distField(tiles: Uint8Array, sx: number, sy: number): Int32Array {
  const d = new Int32Array(W * H).fill(-1);
  const q = [sy * W + sx];
  d[q[0]] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (d[ni] < 0 && !SOLID.has(tiles[ni])) { d[ni] = d[cur] + 1; q.push(ni); }
    }
  }
  return d;
}

export function placePushstone(tiles: Uint8Array, rng: () => number): void {
  if (rng() >= 0.5) return;   // the valley doesn't always offer a lever

  let pb: Vec | null = null, rb: Vec | null = null;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tl.PBASE) pb = { x: i % W, y: (i / W) | 0 };
    if (tiles[i] === Tl.RBASE) rb = { x: i % W, y: (i / W) | 0 };
  }
  if (!pb || !rb) return;
  const d1 = distField(tiles, pb.x, pb.y);
  const d2 = distField(tiles, rb.x, rb.y);
  const at = (x: number, y: number): number =>
    (x < 0 || y < 0 || x >= W || y >= H) ? Tl.TREE : tiles[y * W + x];

  // Candidate crossings: short water runs with open banks, both orientations.
  const MAXSPAN = 5;
  const sites: Site[] = [];
  const consider = (ax: number, ay: number, dx: number, dy: number): void => {
    // ax,ay: near-bank cell; water starts one step along (dx,dy)
    let x = ax + dx, y = ay + dy, len = 0;
    while (at(x, y) === Tl.WATER && len <= MAXSPAN) { x += dx; y += dy; len++; }
    if (len === 0 || len > MAXSPAN) return;
    if (SOLID.has(at(x, y))) return;
    const a = ay * W + ax, b = y * W + x;
    if (d1[a] < 0 && d1[b] < 0) return;   // nobody can even reach it
    let score: number;
    if (d1[a] >= 0 !== d1[b] >= 0) {
      // Reconnection: one side is cut off from the player's world entirely.
      score = 250;
    } else {
      const s1 = Math.abs(d1[a] - d1[b]), s2 = Math.abs(d2[a] - d2[b]);
      score = Math.max(s1, s2) - len - 1;   // the detour a ford here saves
    }
    if (score >= 8) sites.push({ ax, ay, dx, dy, score });
  };
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (SOLID.has(tiles[y * W + x]) || tiles[y * W + x] === Tl.WATER) continue;
      if (at(x + 1, y) === Tl.WATER) consider(x, y, 1, 0);
      if (at(x - 1, y) === Tl.WATER) consider(x, y, -1, 0);
      if (at(x, y + 1) === Tl.WATER) consider(x, y, 0, 1);
      if (at(x, y - 1) === Tl.WATER) consider(x, y, 0, -1);
    }
  }
  if (!sites.length) return;

  // Group sites by connected water body — a 190-column river is ONE
  // opportunity, however many columns it has. Pick a body weighted by its
  // best score, then wander along it: position varies between visits even
  // when the same river keeps winning.
  const comp = new Int32Array(W * H).fill(-1);
  let nComp = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tl.WATER || comp[i] >= 0) continue;
    const q = [i]; comp[i] = nComp;
    for (let qi = 0; qi < q.length; qi++) {
      const cx = q[qi] % W, cy = (q[qi] / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = (cy + dy) * W + cx + dx;
        if (cx + dx >= 0 && cy + dy >= 0 && cx + dx < W && cy + dy < H
          && tiles[ni] === Tl.WATER && comp[ni] < 0) { comp[ni] = nComp; q.push(ni); }
      }
    }
    nComp++;
  }
  const byBody = new Map<number, Site[]>();
  for (const s of sites) {
    const c = comp[(s.ay + s.dy) * W + s.ax + s.dx];
    if (!byBody.has(c)) byBody.set(c, []);
    byBody.get(c)!.push(s);
  }
  const bodies = [...byBody.values()]
    .map(list => ({ list, best: Math.max(...list.map(s => s.score)) }))
    .sort((a, b) => b.best - a.best)
    .slice(0, 4);
  const total = bodies.reduce((sum, b) => sum + b.best, 0);
  let pickAt = rng() * total;
  const body = bodies.find(b => (pickAt -= b.best) <= 0) ?? bodies[0];
  // Wander among that body's near-best sites (uniform along the bank).
  const good = body.list.filter(s => s.score >= body.best * 0.7);
  const first = good[Math.floor(rng() * good.length)];
  const rest = sites.filter(s => s !== first).sort((p, q) => q.score - p.score);
  const order = [first, ...rest];

  // Jitter the stone 0-2 tiles back from the bank; every placement must pass
  // the real push validator and must not cost any POI its reachability.
  for (const s of order) {
    const backs = [0, 1, 2];
    for (let i = backs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [backs[i], backs[j]] = [backs[j], backs[i]];
    }
    for (const k of backs) {
      const sx = s.ax - s.dx * k, sy = s.ay - s.dy * k;
      const si = sy * W + sx;
      if (sx < 1 || sy < 1 || sx >= W - 1 || sy >= H - 1) continue;
      if (tiles[si] !== Tl.GRASS && tiles[si] !== Tl.DIRT) continue;
      const keep = tiles[si];
      tiles[si] = Tl.PUSH;
      if (pushSlideTiles(tiles, sx, sy, s.dx, s.dy) && poisOk(tiles) !== false) return;
      tiles[si] = keep;
    }
  }
}
