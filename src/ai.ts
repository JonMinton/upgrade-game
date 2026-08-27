// Kernagh's brain: forage -> ritual -> intercept -> flee, with BFS pathfinding.

import {
  Game, Vec, TILE, WORLD_TW, WORLD_TH, SHARDS_PER_UPGRADE, WIN_TIER, inSafe,
  SOLID_LUT, DX4, DY4,
} from './defs';
import { solidTile, moveEnt, blocksBolt } from './map';

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
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX4[d], ny = cy + DY4[d];
      if (nx < 0 || ny < 0 || nx >= WORLD_TW || ny >= WORLD_TH) continue;
      const ni = ny * WORLD_TW + nx;
      if (seen[ni] === stamp || SOLID_LUT[w.tiles[ni]]) continue;
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
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX4[d], ny = cy + DY4[d];
      if (nx < 0 || ny < 0 || nx >= WORLD_TW || ny >= WORLD_TH) continue;
      const ni = ny * WORLD_TW + nx;
      if (seen[ni] === stamp || SOLID_LUT[w.tiles[ni]]) continue;
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
    if (blocksBolt(g.world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
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

// A short potter: a random walkable tile a few tiles off, never in a safe
// screen. Kernagh uses this instead of standing still when he has time to
// kill — a statue reads as a bot; a wizard poking about the bushes does not.
function potterSpot(g: Game): Vec | null {
  const r = g.rival;
  const tx0 = Math.floor(r.x / TILE), ty0 = Math.floor(r.y / TILE);
  for (let tries = 0; tries < 12; tries++) {
    const tx = tx0 + Math.floor(Math.random() * 13) - 6;
    const ty = ty0 + Math.floor(Math.random() * 13) - 6;
    if (tx < 1 || ty < 1 || tx >= WORLD_TW - 1 || ty >= WORLD_TH - 1) continue;
    if (Math.abs(tx - tx0) + Math.abs(ty - ty0) < 3) continue;
    if (solidTile(g.world, tx, ty)) continue;
    const x = tx * TILE + 4, y = ty * TILE + 4;
    if (inSafe(g.world, x, y)) continue;
    return { x, y };
  }
  return null;
}

// The shrine he has not stood on for longest (ties broken by straight-line
// distance). Replaces a clock-driven patrol that parked him on one shrine
// for 18 s at a time.
function stalestShrine(g: Game): number {
  const r = g.rival, ai = g.ai;
  let best = 0, bestT = Infinity, bestD = Infinity;
  g.world.shrines.forEach((sh, i) => {
    const t = ai.visited[i] ?? -999;
    const d = Math.hypot(sh.x * TILE + 4 - r.x, sh.y * TILE + 4 - r.y);
    if (t < bestT || (t === bestT && d < bestD)) { best = i; bestT = t; bestD = d; }
  });
  return best;
}

// Chase only when it's genuinely threatening — not a standing stalk order.
// In easy mode he only contests the endgame and nearby rituals.
function interceptWorthwhile(g: Game, distP: number): boolean {
  const p = g.player, r = g.rival, ai = g.ai;
  if (inSafe(g.world, p.x, p.y)) return false;
  // An active ritual is always worth breaking, even mid-disengage.
  if (p.channel > 0 && distP < (g.difficulty === 'easy' ? 200 : 400)) return true;
  if (g.time < ai.coolUntil) return false;              // disengaged: go live your life
  if (p.tier >= WIN_TIER) return true;                  // endgame: contest the last shards
  if (g.difficulty === 'easy') return false;
  return p.shards >= 2 && r.shards < 2 && distP < 220;
}

export function updateRival(g: Game, dt: number, fire: (dx: number, dy: number) => void): void {
  const r = g.rival, p = g.player, ai = g.ai;
  if (r.stun > 0) return;   // frozen or staggered: no thinking, no moving
  const distP = Math.hypot(p.x - r.x, p.y - r.y);

  // Encounter cap: after ~12s glued to the player he disengages and goes
  // back to collecting or healing for a while.
  if (distP < 200) {
    ai.nearT += dt;
    if (ai.nearT > 12) {
      ai.nearT = 0;
      ai.coolUntil = Math.max(ai.coolUntil, g.time + 10);
    }
  } else {
    ai.nearT = Math.max(0, ai.nearT - dt * 2);
  }

  // Channeling at the altar: stand still.
  const nearAltar = Math.hypot(r.x - g.world.altarX, r.y - g.world.altarY) < 24;
  if (r.shards >= SHARDS_PER_UPGRADE && nearAltar) { ai.state = 'ritual'; return; }

  // Remember which shrines he has recently stood on.
  g.world.shrines.forEach((sh, i) => {
    if (Math.hypot(sh.x * TILE + 4 - r.x, sh.y * TILE + 4 - r.y) < 12) ai.visited[i] = g.time;
  });

  // Pick target
  let target: Vec | null = null;
  let key = '';
  const dawdling = g.time < ai.pauseUntil && r.hp > 1 && g.player.tier < WIN_TIER && distP > 200;
  if (!dawdling && ai.state === 'potter') ai.wander = null;   // dawdle over: forget the potter spot
  if (dawdling) {
    // Post-pickup dawdle: potter about rather than stand on the empty shrine.
    ai.state = 'potter';
    if (!ai.wander || Math.hypot(ai.wander.x - r.x, ai.wander.y - r.y) < 6) ai.wander = potterSpot(g);
    target = ai.wander;
    key = target ? `w${target.x | 0},${target.y | 0}` : '';
  } else if (r.hp <= 1 && distP < 300) {
    ai.state = 'flee';
    target = { x: r.homeX, y: r.homeY };
    key = 'home';
  } else if (r.shards >= SHARDS_PER_UPGRADE) {
    ai.state = 'ritual';
    target = { x: g.world.altarX, y: g.world.altarY };
    key = 'altar';
  } else if (r.hp <= 2 && (target = berryTarget(g))) {
    ai.state = 'berry';
    key = `b${target.x | 0},${target.y | 0}`;
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
    // Imperfect knowledge: he perceives shards within a walking range (shorter
    // when degraded); beyond that he patrols the shrines he knows.
    const sight = g.difficulty === 'easy' ? 18 : 32;
    const found = nearestPointByPath(g, Math.floor(r.x / TILE), Math.floor(r.y / TILE), sight, g.shards);
    if (found) {
      target = { x: found.x, y: found.y };
      key = `s${found.x | 0},${found.y | 0}`;
    } else if (ai.wander) {
      // Bored: off to look at something else (or someone else).
      target = ai.wander;
      key = `w${target.x | 0},${target.y | 0}`;
      if (Math.hypot(target.x - r.x, target.y - r.y) < 6) ai.wander = null;
    } else {
      // Commit to one patrol shrine until reached (or bored): re-choosing
      // every tick lets two equally stale shrines flip-flop him in place.
      if (ai.patrol < 0) ai.patrol = stalestShrine(g);
      const sh = g.world.shrines[ai.patrol];
      const sx = sh.x * TILE + 4, sy = sh.y * TILE + 4;
      if (Math.hypot(sx - r.x, sy - r.y) < 6) {
        // Arrived: linger a while (boredom decides how long), then move on.
        target = null; key = 'wait' + ai.patrol;
      } else {
        target = { x: sx, y: sy };
        key = 'patrol' + ai.patrol;
      }
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
    ai.repath = (key === 'player' ? 0.4 : 0.8) * (g.difficulty === 'easy' ? 2.2 : 1);
    ai.stuck = 0;
  }

  // Boredom: a wizard with nothing to do does not stand on a shrine waiting
  // for it to refill. Idling in forage/potter accrues boredom; walking drains
  // it. Past the threshold he marks this spot as seen and goes elsewhere —
  // on hard, sometimes to see what the player is up to. Hard mode tolerates
  // a longer wait: lingering on a shrine is genuinely good play, it just
  // must not be indefinite.
  const idling = (ai.state === 'forage' || ai.state === 'potter') && moved < 1;
  ai.bored = idling ? ai.bored + dt : Math.max(0, ai.bored - dt * 2);
  if (ai.bored > (g.difficulty === 'easy' ? 5 : 10)) {
    ai.bored = 0;
    ai.pauseUntil = 0;
    ai.patrol = -1;
    g.world.shrines.forEach((sh, i) => {
      if (Math.hypot(sh.x * TILE + 4 - r.x, sh.y * TILE + 4 - r.y) < 40) ai.visited[i] = g.time;
    });
    const nosy = g.difficulty === 'hard' && g.time >= ai.coolUntil && !inSafe(g.world, p.x, p.y)
      && Math.random() < 0.35;
    ai.wander = nosy ? { x: p.x, y: p.y } : potterSpot(g);
    if (ai.wander) {
      target = ai.wander; key = `w${target.x | 0},${target.y | 0}`;
      ai.path = bfs(g, Math.floor(r.x / TILE), Math.floor(r.y / TILE), Math.floor(target.x / TILE), Math.floor(target.y / TILE));
      ai.pathI = 0; ai.targetKey = key; ai.stuck = 0;
    }
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
    const m = moveEnt(g.world, r, vx * sp, vy * sp, p);
    r.animDist += m;
    r.stepAcc += m;
    r.facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 2 : 3) : (vy < 0 ? 1 : 0);
  }

  // Opportunistic fire — cardinal directions only, same rules as the player.
  // Degraded Kernagh hesitates and often lets the shot go.
  if (r.cool <= 0 && distP < 150 && !inSafe(g.world, r.x, r.y) && !inSafe(g.world, p.x, p.y) && los(g, r.x, r.y, p.x, p.y)) {
    if (g.difficulty === 'easy' && Math.random() < 0.45) {
      r.cool = 0.6;
    } else {
      const dx = p.x - r.x, dy = p.y - r.y;
      if (Math.abs(dx) > 2.5 * Math.abs(dy)) fire(Math.sign(dx), 0);
      else if (Math.abs(dy) > 2.5 * Math.abs(dx)) fire(0, Math.sign(dy));
    }
  }
}
