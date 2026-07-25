// The living valley: between games the soft cover drifts — wood, turf, bare
// earth and reeds obey a seeded cellular automaton, one generation per
// completed game on that map. Everything built or gameplay-bearing is
// immutable. Deterministic per (map, generation): visit 7 is the same valley
// for everyone, whenever it is replayed.
//
// The same module owns the per-visit pushstone offer: a seeded coin flip,
// then placement at the crossing where a ford would save the longest detour.

import { Tl, SOLID, SOLID_LUT, DX4, DY4, WORLD_TW, WORLD_TH, Vec, DMG_CFG } from './defs';
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
      if ((dx || dy) && SOLID_LUT[at(x + dx, y + dy)]) n++;
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
      if (t !== Tl.TREE && t !== Tl.GRASS && t !== Tl.DIRT && t !== Tl.REED && t !== Tl.RUIN) continue;
      const bias = near(x, y, Tl.PATH, 2) ? R.witnessBias : 1;
      const roll = (p: number): boolean => rng() < Math.min(1, p * bias);

      if (t === Tl.RUIN) {
        // Masonry only ever slumps: a death, so it can never cost reachability.
        if (roll(DMG_CFG.ruinCrumble)) tiles[i] = Tl.DIRT;
      } else if (t === Tl.TREE) {
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

// --- Evolution cache. evolveTiles is deterministic per (map, generation), so
// replaying generations 1..n from genesis on every newGame is O(visits) of
// pure rework — ~200ms at the 40-visit cap. Cache the latest evolved state
// per map and evolve only the missing generations. Keyed by a hash of the
// base tiles and the live rates, so a re-saved editor map or a playtest
// rates tweak (window.__evo.rates) invalidates naturally.

function tilesHash(t: Uint8Array): number {
  let h = djb2(JSON.stringify(EVO_RATES));
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 33) ^ t[i]) >>> 0;
  return h;
}

export function evolveTo(tiles: Uint8Array, mapName: string, gen: number): void {
  if (gen <= 0) return;
  const key = 'upgrade-evocache-' + mapName;
  const base = tilesHash(tiles);
  let from = 0;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const c = JSON.parse(raw) as { base: number; gen: number; tiles: string };
      if (c.base === base && c.gen >= 1 && c.gen <= gen) {
        const dec = atob(c.tiles);
        if (dec.length === tiles.length) {
          for (let i = 0; i < tiles.length; i++) tiles[i] = dec.charCodeAt(i);
          from = c.gen;
        }
      }
    }
  } catch { /* corrupt or absent cache: replay from genesis */ }
  for (let i = from + 1; i <= gen; i++) evolveTiles(tiles, mapName, i);
  if (from === gen) return;
  try {
    let s = '';
    for (let i = 0; i < tiles.length; i++) s += String.fromCharCode(tiles[i]);
    localStorage.setItem(key, JSON.stringify({ base, gen, tiles: btoa(s) }));
  } catch { /* private mode / quota: caching is only ever an optimisation */ }
}

// --- The damage ledger: combat scars that outlive the game that made them.
//
// Burnt stumps and cracked rock earned in play are stored per map (tile
// index -> tile) and stamped onto the freshly evolved valley each new game.
// At every completed game the whole ledger weathers once, with seeded rolls:
// stumps mostly persist, sometimes decay to earth, rarely resolve into a
// pushstone; cracked rock persists, converts to ruin or earth, or — rarely —
// a pushstone; ruins slump to earth; earth heals out of the ledger entirely,
// and pushstones rest where they lie (capped — see PUSH_CAP).

const DMG_SOLID = new Set<number>([Tl.STUMP, Tl.CRACK, Tl.RUIN, Tl.PUSH]);

export function loadDamage(mapName: string): Record<string, number> {
  try {
    const raw = localStorage.getItem('upgrade-dmg-' + mapName);
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch { return {}; }
}

// Stamp the surviving scars onto a freshly evolved map. Walkable scars can
// never hurt; solid ones are checked against POI reachability and skipped
// for this game if the valley has since grown to depend on those very tiles.
// One batched check covers the common case (scars almost never sever a POI);
// only on failure does it fall back to vetting each solid scar in turn.
export function applyDamage(tiles: Uint8Array, mapName: string): void {
  const dmg = loadDamage(mapName);
  const solid: Array<[number, number, number]> = [];   // [index, scar, previous]
  for (const [k, t] of Object.entries(dmg)) {
    const i = +k;
    if (!(i >= 0 && i < tiles.length)) continue;
    if (!DMG_SOLID.has(t)) { tiles[i] = t; continue; }
    solid.push([i, t, tiles[i]]);
    tiles[i] = t;
  }
  if (solid.length === 0 || poisOk(tiles) !== false) return;
  for (const [i, , keep] of solid) tiles[i] = keep;
  for (const [i, scar] of solid) {
    const keep = tiles[i];
    tiles[i] = scar;
    if (poisOk(tiles) === false) tiles[i] = keep;
  }
}

// A scar that has weathered all the way back to earth leaves the ledger: the
// evolved valley's own tile shows through, so the wound has truly healed.
// Pushstones never weather ("the valley keeps its levers"), so they are the
// one scar that can accumulate; past PUSH_CAP the surplus slumps to earth
// too, oldest grudges forgotten at random.
const PUSH_CAP = 16;

// Merge a finished game's fresh scars into the ledger, weather everything one
// step, persist. Call after bumpVisit so the raw visit count seeds the rolls
// (raw, not capped: a capped seed would repeat the same roll forever).
export function saveDamage(mapName: string, fresh: Record<number, number>): void {
  const cur = loadDamage(mapName);
  for (const [k, t] of Object.entries(fresh)) {
    cur[k] = t === Tl.BURN ? Tl.STUMP : t;   // still burning at game end: it burns out
  }
  let raw = 0;
  try { raw = parseInt(localStorage.getItem('upgrade-evo-' + mapName) ?? '0', 10) || 0; } catch { /* private mode */ }
  const rng = rngFor(mapName + '*DMG', raw);
  const D = DMG_CFG;
  const next: Record<string, number> = {};
  const pushes: string[] = [];
  for (const [k, t] of Object.entries(cur)) {
    const r = rng();
    let nt = t;
    if (t === Tl.STUMP) {
      nt = r < D.stumpStay ? Tl.STUMP : r < D.stumpStay + D.stumpPush ? Tl.PUSH : Tl.DIRT;
    } else if (t === Tl.CRACK) {
      nt = r < D.crackStay ? Tl.CRACK
        : r < D.crackStay + D.crackRuin ? Tl.RUIN
        : r < D.crackStay + D.crackRuin + D.crackPush ? Tl.PUSH : Tl.DIRT;
    } else if (t === Tl.RUIN) {
      nt = r < D.ruinCrumble ? Tl.DIRT : Tl.RUIN;
    }
    if (nt === Tl.DIRT) continue;   // healed: gone from the ledger
    if (nt === Tl.PUSH) pushes.push(k);
    next[k] = nt;
  }
  while (pushes.length > PUSH_CAP) {
    const j = Math.floor(rng() * pushes.length);
    delete next[pushes[j]];
    pushes.splice(j, 1);
  }
  try { localStorage.setItem('upgrade-dmg-' + mapName, JSON.stringify(next)); } catch { /* private mode */ }
}

// The Void consumes the valley's whole history: every map's age and every
// scar, back to genesis. (The Hall of Signals and unlocks are the player's,
// not the valley's, and survive.)
export function resetWorldState(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('upgrade-evo-') || k.startsWith('upgrade-dmg-')
        || k.startsWith('upgrade-evocache-'))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch { /* private mode */ }
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
  const q = new Int32Array(W * H);
  let head = 0, tail = 0;
  q[tail++] = sy * W + sx;
  d[q[0]] = 0;
  while (head < tail) {
    const cur = q[head++];
    const cx = cur % W, cy = (cur / W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX4[k], ny = cy + DY4[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (d[ni] < 0 && !SOLID_LUT[tiles[ni]]) { d[ni] = d[cur] + 1; q[tail++] = ni; }
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
      for (let k = 0; k < 4; k++) {
        const dx = DX4[k], dy = DY4[k];
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
