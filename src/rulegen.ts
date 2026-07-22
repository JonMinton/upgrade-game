// Rule-based map generator (editor tool).
// Features are grown from rules rather than stamped from templates:
//   1. Rivers flow edge-to-edge with momentum and meander; may fork a tributary.
//   2. Forests grow as blob clusters; rocky patches and dirt clearings add variety.
//   3. Reeds colonise river banks.
//   4. Berries prefer forested surroundings (acceptance weighted by tree density).
//   5. Bases sit in opposite corners (fixed while the engine keeps homes there);
//      the stone circle REPELS both bases — placed to maximise the minimum
//      distance to either home.
//   6. Shrines scatter with poisson-style minimum spacing.
//   7. Bridges are added greedily where they reconnect areas that are otherwise
//      unreachable, then one "efficiency" bridge if it shortens the base-to-base
//      walk substantially.

import { WORLD_TW, WORLD_TH, Tl, SOLID } from './defs';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ruleGenTiles(seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const T = new Uint8Array(WORLD_TW * WORLD_TH).fill(Tl.GRASS);
  const idx = (x: number, y: number) => y * WORLD_TW + x;
  const inb = (x: number, y: number) => x > 0 && y > 0 && x < WORLD_TW - 1 && y < WORLD_TH - 1;
  const get = (x: number, y: number) => (inb(x, y) ? T[idx(x, y)] : Tl.TREE);
  const set = (x: number, y: number, t: number) => { if (inb(x, y)) T[idx(x, y)] = t; };
  const onGrass = (x: number, y: number, t: number) => { if (get(x, y) === Tl.GRASS) set(x, y, t); };
  const blob = (cx: number, cy: number, r: number, t: number) => {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy <= r * r) onGrass(cx + dx, cy + dy, t);
      }
    }
  };

  // --- Rule 1: river with momentum + meander
  const riverTiles: { x: number; y: number }[] = [];
  let ry = 24 + Math.floor(rng() * 40);
  let mom = 0;
  const width = 2 + (rng() < 0.4 ? 1 : 0);
  for (let x = 1; x < WORLD_TW - 1; x++) {
    mom += (rng() - 0.5) * 0.8;
    mom = Math.max(-1, Math.min(1, mom));
    ry += Math.round(mom + (rng() - 0.5));
    ry = Math.max(8, Math.min(WORLD_TH - 9, ry));
    for (let w = 0; w < width; w++) { set(x, ry + w, Tl.WATER); riverTiles.push({ x, y: ry + w }); }
  }
  if (rng() < 0.6) {
    // tributary: from a river point, flow to the nearer top/bottom edge
    const p = riverTiles[Math.floor(rng() * riverTiles.length)];
    const dir = p.y < WORLD_TH / 2 ? -1 : 1;
    let tx = p.x;
    for (let y = p.y; y > 4 && y < WORLD_TH - 4; y += dir) {
      tx += Math.round((rng() - 0.5) * 1.2);
      tx = Math.max(4, Math.min(WORLD_TW - 5, tx));
      set(tx, y, Tl.WATER); set(tx + 1, y, Tl.WATER);
      riverTiles.push({ x: tx, y }, { x: tx + 1, y });
    }
  }

  // --- Rule 2: forests (blob clusters), rocky patches, dirt clearings
  const forests = 6 + Math.floor(rng() * 3);
  for (let f = 0; f < forests; f++) {
    const cx = 6 + Math.floor(rng() * (WORLD_TW - 12));
    const cy = 6 + Math.floor(rng() * (WORLD_TH - 12));
    const n = 8 + Math.floor(rng() * 7);
    for (let i = 0; i < n; i++) {
      blob(cx + Math.floor((rng() - 0.5) * 16), cy + Math.floor((rng() - 0.5) * 10), 1 + rng() * 1.8, Tl.TREE);
    }
  }
  for (let r = 0; r < 4; r++) {
    const cx = 4 + Math.floor(rng() * (WORLD_TW - 8));
    const cy = 4 + Math.floor(rng() * (WORLD_TH - 8));
    for (let i = 0; i < 5; i++) {
      blob(cx + Math.floor((rng() - 0.5) * 8), cy + Math.floor((rng() - 0.5) * 6), 0.8 + rng() * 1.4, Tl.ROCK);
    }
  }
  for (let d = 0; d < 3; d++) {
    blob(6 + Math.floor(rng() * (WORLD_TW - 12)), 6 + Math.floor(rng() * (WORLD_TH - 12)), 2.5 + rng() * 3, Tl.DIRT);
  }

  // --- Rule 3: reeds colonise banks
  for (const p of riverTiles) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (get(p.x + dx, p.y + dy) === Tl.GRASS && rng() < 0.18) set(p.x + dx, p.y + dy, Tl.REED);
    }
  }

  // --- Rule 2b: RUINS. Lost settlements seeded by attractors — water is the
  // strongest draw (rivers meant life), then woodland, then rock — grown in
  // house-and-street dimensions: dirt lanes with broken-walled houses.
  const countNear = (x: number, y: number, t: number, r: number): number => {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (get(x + dx, y + dy) === t) n++;
      }
    }
    return n;
  };
  const ruinSites: { x: number; y: number; score: number }[] = [];
  for (let i = 0; i < 60; i++) {
    const x = 12 + Math.floor(rng() * (WORLD_TW - 24));
    const y = 9 + Math.floor(rng() * (WORLD_TH - 18));
    const score = (countNear(x, y, Tl.WATER, 6) > 0 ? 3 : 0)
      + (countNear(x, y, Tl.TREE, 4) >= 3 ? 2 : 0)
      + (countNear(x, y, Tl.ROCK, 4) > 0 ? 1 : 0)
      + rng() * 0.5;
    ruinSites.push({ x, y, score });
  }
  ruinSites.sort((a, b) => b.score - a.score);
  const ruins: { x: number; y: number }[] = [];
  for (const site of ruinSites) {
    if (ruins.length >= 2 + (rng() < 0.5 ? 1 : 0)) break;
    if (ruins.some(r2 => Math.hypot(r2.x - site.x, r2.y - site.y) < 30)) continue;
    ruins.push(site);
  }
  for (const ru of ruins) {
    const w = 12 + Math.floor(rng() * 8), h = 8 + Math.floor(rng() * 5);
    const x0 = ru.x - (w >> 1), y0 = ru.y - (h >> 1);
    // The settlers cleared this ground long ago.
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const t = get(x, y);
        if (t === Tl.TREE || t === Tl.ROCK || t === Tl.REED) set(x, y, Tl.GRASS);
      }
    }
    // Streets: a horizontal lane, usually a vertical one too.
    const laneY = y0 + 2 + Math.floor(rng() * (h - 5));
    for (let x = x0; x < x0 + w; x++) {
      if (get(x, laneY) === Tl.GRASS) set(x, laneY, Tl.DIRT);
      if (get(x, laneY + 1) === Tl.GRASS) set(x, laneY + 1, Tl.DIRT);
    }
    const laneX = x0 + 2 + Math.floor(rng() * (w - 5));
    if (rng() < 0.75) {
      for (let y = y0; y < y0 + h; y++) {
        if (get(laneX, y) === Tl.GRASS) set(laneX, y, Tl.DIRT);
        if (get(laneX + 1, y) === Tl.GRASS) set(laneX + 1, y, Tl.DIRT);
      }
    }
    // Houses: broken-walled rectangles beside the lanes, dirt floors inside.
    const tries = 5 + Math.floor(rng() * 3);
    for (let hnum = 0; hnum < tries; hnum++) {
      const hw = 4 + Math.floor(rng() * 3), hh = 3 + Math.floor(rng() * 3);
      const hx = x0 + Math.floor(rng() * Math.max(1, w - hw));
      const hy = y0 + Math.floor(rng() * Math.max(1, h - hh));
      // keep off the lanes
      if (hy <= laneY + 1 && hy + hh > laneY) continue;
      for (let y = hy; y < hy + hh; y++) {
        for (let x = hx; x < hx + hw; x++) {
          const edge = x === hx || x === hx + hw - 1 || y === hy || y === hy + hh - 1;
          if (get(x, y) !== Tl.GRASS && get(x, y) !== Tl.DIRT) continue;
          if (edge) { if (rng() < 0.72) set(x, y, Tl.RUIN); }
          else set(x, y, Tl.DIRT);
        }
      }
    }
  }

  // --- Rule 5a: bases REPEL each other. Sample candidate sites (away from
  // edges and open water), then take the pair with the greatest separation.
  const clearPatch = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (SOLID.has(get(x + dx, y + dy))) set(x + dx, y + dy, Tl.GRASS);
      }
    }
  };
  const nearWater = (x: number, y: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (get(x + dx, y + dy) === Tl.WATER) return true;
      }
    }
    return false;
  };
  const candidates: { x: number; y: number }[] = [];
  for (let i = 0; i < 60 && candidates.length < 30; i++) {
    const x = 13 + Math.floor(rng() * (WORLD_TW - 26));
    const y = 9 + Math.floor(rng() * (WORLD_TH - 18));
    if (!nearWater(x, y, 6)) candidates.push({ x, y });
  }
  if (candidates.length < 2) candidates.push({ x: 14, y: WORLD_TH - 12 }, { x: WORLD_TW - 16, y: WORLD_TH - 10 });
  let P_HOME = candidates[0], R_HOME = candidates[1], bestD = -1;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const d = Math.hypot(candidates[i].x - candidates[j].x, candidates[i].y - candidates[j].y);
      if (d > bestD) { bestD = d; P_HOME = candidates[i]; R_HOME = candidates[j]; }
    }
  }
  // player takes the more south-westerly of the pair (home feels like home)
  if (P_HOME.x + (WORLD_TH - P_HOME.y) > R_HOME.x + (WORLD_TH - R_HOME.y)) {
    [P_HOME, R_HOME] = [R_HOME, P_HOME];
  }
  // village
  clearPatch(P_HOME.x, P_HOME.y, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) set(P_HOME.x - 10 + x, P_HOME.y - 8 + y, Tl.HUT);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) set(P_HOME.x + 6 + x, P_HOME.y - 8 + y, Tl.HUT);
  set(P_HOME.x - 2, P_HOME.y, Tl.WELL);
  clearPatch(P_HOME.x + 3, P_HOME.y, 1);   // wand station sits 3 tiles east
  // keep
  clearPatch(R_HOME.x, R_HOME.y, 5);
  for (let x = -7; x <= 7; x++) {
    for (let y = -5; y <= 5; y++) {
      const edge = Math.abs(x) === 7 || Math.abs(y) === 5;
      const gate = (y === -5 && Math.abs(x) <= 1) || (x === -7 && Math.abs(y) <= 1);
      if (edge && !gate) set(R_HOME.x + x, R_HOME.y + y, Tl.WALL);
    }
  }
  clearPatch(R_HOME.x - 3, R_HOME.y, 1);   // wand station sits 3 tiles west
  set(P_HOME.x, P_HOME.y, Tl.PBASE);
  set(R_HOME.x, R_HOME.y, Tl.RBASE);

  // --- Rule 5: the stone circle repels both bases
  let best = { x: WORLD_TW >> 1, y: 12, score: -1 };
  for (let i = 0; i < 200; i++) {
    const x = 10 + Math.floor(rng() * (WORLD_TW - 20));
    const y = 8 + Math.floor(rng() * (WORLD_TH - 16));
    if (get(x, y) === Tl.WATER) continue;
    const s = Math.min(Math.hypot(x - P_HOME.x, y - P_HOME.y), Math.hypot(x - R_HOME.x, y - R_HOME.y));
    if (s > best.score) best = { x, y, score: s };
  }
  clearPatch(best.x, best.y, 8);
  for (let i = 0; i < 14; i++) {
    if (i === 3 || i === 10) continue;
    const a = (i / 14) * Math.PI * 2;
    onGrass(best.x + Math.round(Math.cos(a) * 7), best.y + Math.round(Math.sin(a) * 5.5), Tl.STONE);
  }
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) set(best.x + x - 1, best.y + y - 1, Tl.ALTAR);

  // --- Rule 6: shrines with poisson-style spacing
  const shrines: { x: number; y: number }[] = [];
  for (let tries = 0; tries < 4000 && shrines.length < 20; tries++) {
    const x = 3 + Math.floor(rng() * (WORLD_TW - 6));
    const y = 3 + Math.floor(rng() * (WORLD_TH - 6));
    const t0 = get(x, y);
    if (SOLID.has(t0) || t0 === Tl.ALTAR || t0 === Tl.SHRINE || t0 === Tl.PBASE || t0 === Tl.RBASE) continue;
    if (Math.hypot(x - best.x, y - best.y) < 8) continue;
    if (Math.hypot(x - P_HOME.x, y - P_HOME.y) < 8 || Math.hypot(x - R_HOME.x, y - R_HOME.y) < 8) continue;
    if (shrines.some(s => Math.hypot(s.x - x, s.y - y) < 17)) continue;
    set(x, y, Tl.SHRINE);
    clearPatch(x, y, 1);
    set(x, y, Tl.SHRINE);
    shrines.push({ x, y });
  }

  // --- Rule 4: berries prefer forested surroundings
  const berrySpots: { x: number; y: number }[] = [];
  for (let tries = 0; tries < 4000 && berrySpots.length < 22; tries++) {
    const x = 2 + Math.floor(rng() * (WORLD_TW - 4));
    const y = 2 + Math.floor(rng() * (WORLD_TH - 4));
    if (get(x, y) !== Tl.GRASS) continue;
    let trees = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (get(x + dx, y + dy) === Tl.TREE) trees++;
    if (rng() < (trees >= 2 ? 0.8 : 0.08)) { set(x, y, Tl.BERRY); berrySpots.push({ x, y }); }
  }

  // border
  for (let x = 0; x < WORLD_TW; x++) { T[idx(x, 0)] = Tl.TREE; T[idx(x, WORLD_TH - 1)] = Tl.TREE; }
  for (let y = 0; y < WORLD_TH; y++) { T[idx(0, y)] = Tl.TREE; T[idx(WORLD_TW - 1, y)] = Tl.TREE; }

  // --- Rule 7: bridges where they reconnect the world
  const flood = (sx: number, sy: number): Uint8Array => {
    const reach = new Uint8Array(WORLD_TW * WORLD_TH);
    const q = [idx(sx, sy)];
    reach[q[0]] = 1;
    while (q.length) {
      const cur = q.pop()!;
      const cx = cur % WORLD_TW, cy = (cur / WORLD_TW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_TW || ny >= WORLD_TH) continue;
        const ni = idx(nx, ny);
        if (!reach[ni] && !SOLID.has(T[ni])) { reach[ni] = 1; q.push(ni); }
      }
    }
    return reach;
  };
  // Candidate crossing: a short vertical run of water with walkable ground
  // above and below (or horizontal run with ground left/right).
  interface Crossing { x: number; y: number; len: number; vert: boolean }
  const findCrossings = (): Crossing[] => {
    const out: Crossing[] = [];
    for (let x = 2; x < WORLD_TW - 2; x++) {
      for (let y = 2; y < WORLD_TH - 2; y++) {
        if (T[idx(x, y)] !== Tl.WATER || T[idx(x, y - 1)] === Tl.WATER) continue;
        let len = 0;
        while (T[idx(x, y + len)] === Tl.WATER && len < 6) len++;
        if (len <= 5 && !SOLID.has(T[idx(x, y - 1)]) && !SOLID.has(T[idx(x, y + len)])) {
          out.push({ x, y, len, vert: true });
        }
      }
    }
    for (let y = 2; y < WORLD_TH - 2; y++) {
      for (let x = 2; x < WORLD_TW - 2; x++) {
        if (T[idx(x, y)] !== Tl.WATER || T[idx(x - 1, y)] === Tl.WATER) continue;
        let len = 0;
        while (T[idx(x + len, y)] === Tl.WATER && len < 6) len++;
        if (len <= 5 && !SOLID.has(T[idx(x - 1, y)]) && !SOLID.has(T[idx(x + len, y)])) {
          out.push({ x, y, len, vert: false });
        }
      }
    }
    return out;
  };
  const carve = (cr: Crossing) => {
    for (let i = -1; i <= cr.len; i++) {
      if (cr.vert) { set(cr.x, cr.y + i, Tl.PATH); set(cr.x + 1, cr.y + i, Tl.PATH); }
      else { set(cr.x + i, cr.y, Tl.PATH); set(cr.x + i, cr.y + 1, Tl.PATH); }
    }
  };
  // Reconnect the largest genuinely-unreachable region each pass. A bridge is
  // only placed when it lands ON that region (measured traversability gain,
  // not hoped-for gain); when the blockage is trees/rock rather than water,
  // the villagers cleared a minimal way through themselves (dirt).
  for (let guard = 0; guard < 16; guard++) {
    const reach = flood(P_HOME.x, P_HOME.y);
    const seen2 = new Uint8Array(WORLD_TW * WORLD_TH);
    let region: number[] | null = null;
    for (let i = 0; i < T.length; i++) {
      if (reach[i] || seen2[i] || SOLID.has(T[i])) continue;
      const comp: number[] = [];
      const q = [i];
      seen2[i] = 1;
      while (q.length) {
        const cur = q.pop()!;
        comp.push(cur);
        const cx = cur % WORLD_TW, cy = (cur / WORLD_TW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= WORLD_TW || ny >= WORLD_TH) continue;
          const ni = idx(nx, ny);
          if (!seen2[ni] && !reach[ni] && !SOLID.has(T[ni])) { seen2[ni] = 1; q.push(ni); }
        }
      }
      if (!region || comp.length > region.length) region = comp;
    }
    if (!region || region.length < 8) break;
    const regionSet = new Set(region);

    // Prefer a bridge whose far bank is IN the target region.
    const cands = findCrossings().filter(cr => {
      const aI = cr.vert ? idx(cr.x, cr.y - 1) : idx(cr.x - 1, cr.y);
      const bI = cr.vert ? idx(cr.x, cr.y + cr.len) : idx(cr.x + cr.len, cr.y);
      return (reach[aI] && regionSet.has(bI)) || (reach[bI] && regionSet.has(aI));
    });
    if (cands.length) {
      carve(cands.sort((c1, c2) => c1.len - c2.len)[0]);
      continue;
    }

    // Villager clearing: the shortest run of solid, non-water ground between
    // the region and already-reached land becomes a dirt cut.
    let bestCut: number[] | null = null;
    for (const t of region) {
      const cx = t % WORLD_TW, cy = (t / WORLD_TW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const run: number[] = [];
        for (let k = 1; k <= 7; k++) {
          const nx = cx + dx * k, ny = cy + dy * k;
          if (nx < 1 || ny < 1 || nx >= WORLD_TW - 1 || ny >= WORLD_TH - 1) break;
          const ni = idx(nx, ny);
          if (!SOLID.has(T[ni])) {
            if (reach[ni] && run.length > 0 && (!bestCut || run.length < bestCut.length)) bestCut = run.slice();
            break;
          }
          if (T[ni] === Tl.WATER) break;   // water gaps are for bridges
          run.push(ni);
        }
      }
    }
    if (!bestCut) break;   // give up; the POI repair pass is the backstop
    for (const ti of bestCut) T[ti] = Tl.DIRT;
  }
  // Final repair: any POI still cut off (by tree walls, not water) gets a carved path.
  const pois = [...shrines, ...berrySpots, { x: best.x, y: best.y }, R_HOME];
  let reach = flood(P_HOME.x, P_HOME.y);
  for (const poi of pois) {
    if (reach[idx(poi.x, poi.y)]) continue;
    let cx = poi.x, cy = poi.y, guard = 600;
    while (!reach[idx(cx, cy)] && guard-- > 0) {
      if (SOLID.has(T[idx(cx, cy)])) T[idx(cx, cy)] = Tl.PATH;
      if (cx !== P_HOME.x) cx += Math.sign(P_HOME.x - cx);
      else if (cy !== P_HOME.y) cy += Math.sign(P_HOME.y - cy);
      else break;
    }
    reach = flood(P_HOME.x, P_HOME.y);
  }

  return T;
}
