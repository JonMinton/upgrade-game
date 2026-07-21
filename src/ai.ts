// Kernagh's brain: forage -> ritual -> intercept -> flee, with BFS pathfinding.

import { Game, Vec, TILE, WORLD_TW, WORLD_TH, SHARDS_PER_UPGRADE, inSafe } from './defs';
import { solidTile, solidPx, moveEnt } from './map';

const N = WORLD_TW * WORLD_TH;
const prev = new Int32Array(N);
const seen = new Int32Array(N);
const queue = new Int32Array(N);
let stamp = 0;

function bfs(g: Game, sx: number, sy: number, tx: number, ty: number): Vec[] {
  const w = g.world;
  if (solidTile(w, tx, ty)) {
    // nudge target to a walkable neighbour
    outer: for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!solidTile(w, tx + dx, ty + dy)) { tx += dx; ty += dy; break outer; }
        }
      }
    }
  }
  stamp++;
  const start = sy * WORLD_TW + sx;
  const goal = ty * WORLD_TW + tx;
  let head = 0, tail = 0;
  queue[tail++] = start;
  seen[start] = stamp;
  prev[start] = -1;
  while (head < tail) {
    const cur = queue[head++];
    if (cur === goal) break;
    const cx = cur % WORLD_TW, cy = (cur / WORLD_TW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_TW || ny >= WORLD_TH) continue;
      const ni = ny * WORLD_TW + nx;
      if (seen[ni] === stamp || solidTile(w, nx, ny)) continue;
      seen[ni] = stamp;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (seen[goal] !== stamp) return [];
  const path: Vec[] = [];
  for (let cur = goal; cur !== -1; cur = prev[cur]) {
    path.push({ x: (cur % WORLD_TW) * TILE + 4, y: ((cur / WORLD_TW) | 0) * TILE + 4 });
  }
  path.reverse();
  return path;
}

function los(g: Game, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidPx(g.world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

export function updateRival(g: Game, dt: number, fire: (dx: number, dy: number) => void): void {
  const r = g.rival, p = g.player, ai = g.ai;
  const distP = Math.hypot(p.x - r.x, p.y - r.y);

  // Channeling at the altar: stand still.
  const nearAltar = Math.hypot(r.x - g.world.altarX, r.y - g.world.altarY) < 24;
  if (r.shards >= SHARDS_PER_UPGRADE && nearAltar) { ai.state = 'ritual'; return; }

  // Pick target
  let target: Vec | null = null;
  let key = '';
  if (r.hp <= 1 && distP < 300) {
    ai.state = 'flee';
    target = { x: r.homeX, y: r.homeY };
    key = 'home';
  } else if (r.shards >= SHARDS_PER_UPGRADE) {
    ai.state = 'ritual';
    target = { x: g.world.altarX, y: g.world.altarY };
    key = 'altar';
  } else if ((p.channel > 0 || p.tier >= 4 || (p.shards >= 2 && r.shards < 2)) && distP < 460 && !inSafe(p.x, p.y)) {
    ai.state = 'intercept';
    target = { x: p.x, y: p.y };
    key = 'player';
  } else {
    ai.state = 'forage';
    let best = Infinity;
    for (const s of g.shards) {
      const d = (s.x - r.x) ** 2 + (s.y - r.y) ** 2;
      if (d < best) { best = d; target = { x: s.x, y: s.y }; key = `s${s.x | 0},${s.y | 0}`; }
    }
    if (!target) {
      const sh = g.world.shrines[(Math.floor(g.time / 7) * 3 + 1) % g.world.shrines.length];
      target = { x: sh.x * TILE + 4, y: sh.y * TILE + 4 };
      key = 'wander';
    }
  }

  // Repath when target changed, timer expired, or stuck.
  ai.repath -= dt;
  const moved = Math.hypot(r.x - ai.lastX, r.y - ai.lastY);
  ai.stuck = moved < 1 ? ai.stuck + dt : 0;
  ai.lastX = r.x; ai.lastY = r.y;
  if (target && (key !== ai.targetKey || ai.repath <= 0 || ai.stuck > 0.5)) {
    ai.path = bfs(g, Math.floor(r.x / TILE), Math.floor(r.y / TILE), Math.floor(target.x / TILE), Math.floor(target.y / TILE));
    ai.pathI = 0;
    ai.targetKey = key;
    ai.repath = key === 'player' ? 0.4 : 0.8;
    ai.stuck = 0;
  }

  // Follow path
  let vx = 0, vy = 0;
  while (ai.pathI < ai.path.length) {
    const wp = ai.path[ai.pathI];
    const d = Math.hypot(wp.x - r.x, wp.y - r.y);
    if (d < 3) { ai.pathI++; continue; }
    vx = (wp.x - r.x) / d; vy = (wp.y - r.y) / d;
    break;
  }
  if (vx === 0 && vy === 0 && target) {
    const d = Math.hypot(target.x - r.x, target.y - r.y);
    if (d > 4) { vx = (target.x - r.x) / d; vy = (target.y - r.y) / d; }
  }
  if (vx || vy) {
    const sp = 64 * dt;
    const m = moveEnt(g.world, r, vx * sp, vy * sp);
    r.animDist += m;
    r.stepAcc += m;
    r.facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 2 : 3) : (vy < 0 ? 1 : 0);
  }

  // Opportunistic fire
  if (r.cool <= 0 && distP < 150 && !inSafe(r.x, r.y) && !inSafe(p.x, p.y) && los(g, r.x, r.y, p.x, p.y)) {
    const jitter = (Math.random() - 0.5) * 0.18;
    const a = Math.atan2(p.y - r.y, p.x - r.x) + jitter;
    fire(Math.cos(a), Math.sin(a));
  }
}
