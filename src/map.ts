// World generation: 6x4 flick-screens, seeded and deterministic.

import {
  SCR_TW, SCR_TH, TILE, WORLD_TW, WORLD_TH, Tl, SOLID, World, Vec,
} from './defs';

function mulberry32(seed: number): () => number {
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

// Region per screen
function region(sx: number, sy: number): string {
  if (sx === 0 && sy === 3) return 'village';
  if (sx === 5 && sy === 3) return 'keep';
  if (sx === 3 && sy === 0) return 'stones';
  if (sx >= 4 && sy <= 1) return 'marsh';
  if (sx >= 1 && sx <= 4 && sy >= 1 && sy <= 2) return 'forest';
  return 'meadow';
}

export function genWorld(): World {
  const rng = mulberry32(1337);
  const tiles = new Uint8Array(WORLD_TW * WORLD_TH).fill(Tl.GRASS);
  const set = (tx: number, ty: number, t: number) => {
    if (tx >= 0 && ty >= 0 && tx < WORLD_TW && ty < WORLD_TH) tiles[ty * WORLD_TW + tx] = t;
  };
  const get = (tx: number, ty: number) => tiles[ty * WORLD_TW + tx];

  // Cross paths through every screen guarantee connectivity.
  for (let sy = 0; sy < 4; sy++) {
    const ty = sy * SCR_TH + 10;
    for (let tx = 1; tx < WORLD_TW - 1; tx++) { set(tx, ty, Tl.PATH); set(tx, ty + 1, Tl.PATH); }
  }
  for (let sx = 0; sx < 6; sx++) {
    const tx = sx * SCR_TW + 15;
    for (let ty = 1; ty < WORLD_TH - 1; ty++) { set(tx, ty, Tl.PATH); set(tx + 1, ty, Tl.PATH); }
  }

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

  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 6; sx++) {
      const bx = sx * SCR_TW, by = sy * SCR_TH;
      const L = (lx: number, ly: number, t: number) => set(bx + lx, by + ly, t);
      const reg = region(sx, sy);
      if (reg === 'forest') {
        for (let i = 0; i < 10; i++) {
          blob(bx + 2 + Math.floor(rng() * 28), by + 2 + Math.floor(rng() * 18), 1 + rng() * 1.6, Tl.TREE);
        }
      } else if (reg === 'meadow') {
        for (let i = 0; i < 7; i++) {
          onGrass(bx + 2 + Math.floor(rng() * 28), by + 2 + Math.floor(rng() * 18), rng() < 0.7 ? Tl.TREE : Tl.ROCK);
        }
      } else if (reg === 'marsh') {
        for (let i = 0; i < 5; i++) {
          blob(bx + 3 + Math.floor(rng() * 26), by + 3 + Math.floor(rng() * 16), 1 + rng() * 1.8, Tl.WATER);
        }
        for (let i = 0; i < 16; i++) {
          onGrass(bx + 2 + Math.floor(rng() * 28), by + 2 + Math.floor(rng() * 18), Tl.REED);
        }
      } else if (reg === 'village') {
        for (let y = 2; y <= 6; y++) for (let x = 3; x <= 9; x++) L(x, y, Tl.HUT);
        for (let y = 2; y <= 6; y++) for (let x = 20; x <= 26; x++) L(x, y, Tl.HUT);
        for (let y = 15; y <= 19; y++) for (let x = 4; x <= 10; x++) L(x, y, Tl.HUT);
        L(12, 7, Tl.WELL);
        for (let i = 0; i < 4; i++) onGrass(bx + 20 + Math.floor(rng() * 10), by + 14 + Math.floor(rng() * 6), Tl.TREE);
      } else if (reg === 'keep') {
        for (let x = 3; x <= 28; x++) {
          if (get(bx + x, by + 2) === Tl.GRASS) L(x, 2, Tl.WALL);
          if (get(bx + x, by + 19) === Tl.GRASS) L(x, 19, Tl.WALL);
        }
        for (let y = 2; y <= 19; y++) {
          if (get(bx + 3, by + y) === Tl.GRASS) L(3, y, Tl.WALL);
          if (get(bx + 28, by + y) === Tl.GRASS) L(28, y, Tl.WALL);
        }
        for (let y = 4; y <= 17; y++) {
          if (get(bx + 9, by + y) === Tl.GRASS) L(9, y, Tl.WALL);
          if (get(bx + 22, by + y) === Tl.GRASS) L(22, y, Tl.WALL);
        }
        for (let i = 0; i < 5; i++) onGrass(bx + 11 + Math.floor(rng() * 10), by + 4 + Math.floor(rng() * 5), Tl.ROCK);
      } else if (reg === 'stones') {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const lx = 16 + Math.round(Math.cos(a) * 7);
          const ly = 11 + Math.round(Math.sin(a) * 5.5);
          if (get(bx + lx, by + ly) === Tl.GRASS) L(lx, ly, Tl.STONE);
        }
        for (let y = 10; y <= 11; y++) for (let x = 15; x <= 16; x++) L(x, y, Tl.ALTAR);
      }
    }
  }

  // World border
  for (let tx = 0; tx < WORLD_TW; tx++) { set(tx, 0, Tl.TREE); set(tx, WORLD_TH - 1, Tl.TREE); }
  for (let ty = 0; ty < WORLD_TH; ty++) { set(0, ty, Tl.TREE); set(WORLD_TW - 1, ty, Tl.TREE); }

  // Shrines: (screen sx, sy, local lx, ly)
  const shrineDefs: [number, number, number, number][] = [
    [0, 3, 25, 15], [1, 1, 6, 5], [2, 2, 24, 16], [3, 1, 8, 15], [4, 2, 20, 4],
    [5, 0, 8, 14], [4, 1, 22, 6], [5, 3, 18, 13], [0, 0, 10, 6], [2, 3, 10, 16],
  ];
  const shrines: Vec[] = [];
  for (const [sx, sy, lx, ly] of shrineDefs) {
    const tx = sx * SCR_TW + lx, ty = sy * SCR_TH + ly;
    set(tx, ty, Tl.SHRINE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && SOLID.has(get(tx + dx, ty + dy))) set(tx + dx, ty + dy, Tl.GRASS);
      }
    }
    shrines.push({ x: tx, y: ty });
  }

  const w: World = {
    tiles, shrines,
    altarX: (3 * SCR_TW + 16) * TILE, altarY: 11 * TILE,
    pHomeX: (0 * SCR_TW + 14) * TILE, pHomeY: (3 * SCR_TH + 12) * TILE,
    rHomeX: (5 * SCR_TW + 16) * TILE, rHomeY: (3 * SCR_TH + 14) * TILE,
  };

  // Clear a patch around homes and altar approach.
  for (const [hx, hy] of [[w.pHomeX, w.pHomeY], [w.rHomeX, w.rHomeY]]) {
    const tx = Math.floor(hx / TILE), ty = Math.floor(hy / TILE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (SOLID.has(get(tx + dx, ty + dy))) set(tx + dx, ty + dy, Tl.GRASS);
      }
    }
  }
  return w;
}

// Axis-separated bbox move; half-extent 5px.
export function moveEnt(w: World, e: { x: number; y: number }, dx: number, dy: number): number {
  const H = 5;
  let moved = 0;
  if (dx !== 0) {
    const nx = e.x + dx;
    const ex = nx + Math.sign(dx) * H;
    if (!solidPx(w, ex, e.y - H) && !solidPx(w, ex, e.y + H)) { e.x = nx; moved += Math.abs(dx); }
  }
  if (dy !== 0) {
    const ny = e.y + dy;
    const ey = ny + Math.sign(dy) * H;
    if (!solidPx(w, e.x - H, ey) && !solidPx(w, e.x + H, ey)) { e.y = ny; moved += Math.abs(dy); }
  }
  return moved;
}
