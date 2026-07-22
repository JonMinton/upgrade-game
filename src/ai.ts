// Kernagh's brain: forage -> ritual -> intercept -> flee, with BFS pathfinding.

import { Game, Vec, TILE, WORLD_TW, WORLD_TH, SHARDS_PER_UPGRADE, WIN_TIER, inSafe } from './defs';
import { solidTile, solidPx, moveEnt } from './map';

const N = WORLD_TW * WORLD_TH;
const prev = new Int32Array(N);
const seen = new Int32Array(N);
const queue = new Int32Array(N);
const depth = new Int32Array(N);
let stamp = 0;

// Flood-fill from the rival's tile to the closest point BY WALKING DISTANCE.
// Euclidean-nearest is a trap in a maze: two targets at similar straight-line
// range in opposite directions make a greedy chooser orbit forever.
function nearestPointByPath(g: Game, sx: number, sy: number, maxDepth: number, points: Vec[]): Vec | null {
  if (!points.length) return null;
  const w = g.world;
  const shardTiles = new Map<number, Vec>();
  for (const s of points) {
    shardTiles.set(Math.floor(s.y / TILE) * WORLD_TW + Math.floor(s.x / TILE), s);
  }
  stamp++;
  const start = sy * WORLD_TW + sx;
  let head = 0, tail = 0;
  queue[tail++] = start;
  seen[start] = stamp;
  depth[start] = 0;
  while (head < tail) {
    const cur = queue[head++];
    const hit = shardTiles.get(cur);
    if (hit) return hit;
    if (depth[cur] >= maxDepth) continue;
    const cx = cur % WORLD_TW, cy = (cur / WORLD_TW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_TW || ny >= WORLD_TH) continue;
      const ni = ny * WORLD_TW + nx;
      if (seen[ni] === stamp || solidTile(w, nx, ny)) continue;
      seen[ni] = stamp;
      depth[ni] = depth[cur] + 1;
      queue[tail++] = ni;
    }
  }
  return null;
}

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

// Nearest active berry within a short walk, in world px.
function berryTarget(g: Game): Vec | null {
  const r = g.rival;
  const active: Vec[] = [];
  g.world.berrySpots.forEach((b, i) => {
    if (g.berryCd[i] <= 0) active.push({ x: b.x * TILE + 4, y: b.y * TILE + 4 });
  });
  return nearestPointByPath(g, Math.floor(r.x / TILE), Math.floor(r.y / TILE), 20, active);
}

// Chase only when it's genuinely threatening — not a standing stalk order.
function interceptWorthwhile(g: Game, distP: number): boolean {
  const p = g.player, r = g.rival, ai = g.ai;
  if (inSafe(p.x, p.y)) return false;
  if (p.tier >= WIN_TIER) return true;                  // endgame: always contest the hold
  if (p.channel > 0 && distP < 400) return true;        // break the ritual if reachable
  return p.shards >= 2 && r.shards < 2 && distP < 220 && g.time > ai.coolUntil;
}

export function updateRival(g: Game, dt: number, fire: (dx: number, dy: number) => void): void {
  const r = g.rival, p = g.player, ai = g.ai;
  if (r.stun > 0) return;   // frozen or staggered: no thinking, no moving
  const distP = Math.hypot(p.x - r.x, p.y - r.y);

  // Channeling at the altar: stand still.
  const nearAltar = Math.hypot(r.x - g.world.altarX, r.y - g.world.altarY) < 24;
  if (r.shards >= SHARDS_PER_UPGRADE && nearAltar) { ai.state = 'ritual'; return; }

  // Post-pickup dawdle (skipped in emergencies or when the player is close).
  if (g.time < ai.pauseUntil && r.hp > 1 && g.player.tier < WIN_TIER && distP > 200) return;

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
  } else if (r.hp <= 2 && berryTarget(g)) {
    ai.state = 'berry';
    const b = berryTarget(g)!;
    target = b;
    key = `b${b.x | 0},${b.y | 0}`;
  } else if (interceptWorthwhile(g, distP)) {
    ai.state = 'intercept';
    ai.interceptT += dt;
    if (ai.interceptT > 9) {
      // Give up the chase: go back to building his own economy for a while.
      ai.interceptT = 0;
      ai.coolUntil = g.time + 8;
    }
    target = { x: p.x, y: p.y };
    key = 'player';
  } else {
    ai.state = 'forage';
    ai.interceptT = 0;
    // Imperfect knowledge: he perceives shards within ~32 tiles of walking;
    // beyond that he patrols the shrines he knows.
    const found = nearestPointByPath(g, Math.floor(r.x / TILE), Math.floor(r.y / TILE), 32, g.shards);
    if (found) {
      target = { x: found.x, y: found.y };
      key = `s${found.x | 0},${found.y | 0}`;
    } else {
      const idx = Math.floor(g.time / 18) % g.world.shrines.length;
      const sh = g.world.shrines[idx];
      target = { x: sh.x * TILE + 4, y: sh.y * TILE + 4 };
      key = 'patrol' + idx;
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

  // Follow path. Clamp each step to the waypoint distance so a large timestep
  // can never overshoot and oscillate across a waypoint.
  let vx = 0, vy = 0, wpDist = Infinity;
  while (ai.pathI < ai.path.length) {
    const wp = ai.path[ai.pathI];
    const d = Math.hypot(wp.x - r.x, wp.y - r.y);
    if (d < 2) { ai.pathI++; continue; }
    vx = (wp.x - r.x) / d; vy = (wp.y - r.y) / d; wpDist = d;
    break;
  }
  if (vx === 0 && vy === 0 && target) {
    const d = Math.hypot(target.x - r.x, target.y - r.y);
    if (d > 4) { vx = (target.x - r.x) / d; vy = (target.y - r.y) / d; wpDist = d; }
  }
  if (vx || vy) {
    const sp = Math.min(64 * dt, wpDist);
    const m = moveEnt(g.world, r, vx * sp, vy * sp);
    r.animDist += m;
    r.stepAcc += m;
    r.facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 2 : 3) : (vy < 0 ? 1 : 0);
  }

  // Opportunistic fire — cardinal directions only, same rules as the player.
  if (r.cool <= 0 && distP < 150 && !inSafe(r.x, r.y) && !inSafe(p.x, p.y) && los(g, r.x, r.y, p.x, p.y)) {
    const dx = p.x - r.x, dy = p.y - r.y;
    if (Math.abs(dx) > 2.5 * Math.abs(dy)) fire(Math.sign(dx), 0);
    else if (Math.abs(dy) > 2.5 * Math.abs(dx)) fire(0, Math.sign(dy));
  }
}
