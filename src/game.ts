// Game state and simulation.

import {
  Game, Ent, Input, START_TIER, WIN_TIER, SHARDS_PER_UPGRADE, CHANNEL_TIME, HOLD_TIME,
  FACING_VECS, TILE, SCR_W, SCR_H, inSafe, screenOf, clamp, WORLD_W, WORLD_H,
} from './defs';
import { genWorld, moveEnt, solidPx, solidTile } from './map';
import { updateRival } from './ai';
import { sfx, setMusicTier, SfxName } from './audio';

const SPEED = 64;
const BOLT_SPEED = 150;
const BOLT_LIFE = 0.9;
const RESPAWN_EVERY = 22;
const REGEN_EVERY = 12;
const MAX_GROUND_SHARDS = 9;

function makeEnt(x: number, y: number, rival: boolean): Ent {
  return {
    x, y, facing: 0, hp: 3, tier: START_TIER, shards: 0,
    cool: 0, channel: 0, hold: 0, inv: 0, regen: 0,
    animDist: 0, stepAcc: 0, homeX: x, homeY: y, rival,
  };
}

export function newGame(): Game {
  const world = genWorld();
  const g: Game = {
    mode: 'loading', loadT: 0, time: 0, world,
    player: makeEnt(world.pHomeX, world.pHomeY, false),
    rival: makeEnt(world.rHomeX, world.rHomeY, true),
    bolts: [], shards: [], fx: [],
    respawn: RESPAWN_EVERY,
    msg: '', msgUntil: 0,
    ripple: -1, rippleFrom: START_TIER,
    ai: {
      state: 'forage', path: [], pathI: 0, repath: 0, lastX: 0, lastY: 0, stuck: 0,
      targetKey: '', interceptT: 0, coolUntil: 0, pauseUntil: 0,
    },
    camX: 0, camY: SCR_H * 3,
    hinted3: false, endTime: 0,
  };
  // A modest starting scatter (4 shrines, spread across the map); the rest of
  // the economy comes from respawns, so neither racer can sprint the ladder.
  for (const i of [1, 2, 5, 9]) {
    const s = world.shrines[i];
    g.shards.push({ x: s.x * TILE + 4, y: s.y * TILE + 4 });
  }
  return g;
}

export function msg(g: Game, text: string, dur = 2.5): void {
  g.msg = text;
  g.msgUntil = g.time + dur;
}

// SFX positioned relative to the player's ears; rival events bleed across screens.
function relSfx(g: Game, name: SfxName, tier: number, x: number, y: number, base = 1): void {
  const p = g.player;
  const d = Math.hypot(x - p.x, y - p.y);
  const same = screenOf(x, y).x === screenOf(p.x, p.y).x && screenOf(x, y).y === screenOf(p.x, p.y).y;
  const vol = same ? base : base * Math.max(0, 1 - d / 420) * 0.55;
  if (vol <= 0.02) return;
  sfx(name, tier, vol, clamp((x - p.x) / 320, -1, 1));
}

function setTier(g: Game, e: Ent, tier: number): void {
  const old = e.tier;
  e.tier = tier;
  if (!e.rival) {
    g.ripple = g.time;
    g.rippleFrom = old;
    setMusicTier(tier);
  }
}

function fire(g: Game, e: Ent, dx: number, dy: number): void {
  if (e.cool > 0 || inSafe(e.x, e.y)) return;
  e.cool = 1.0;
  const d = Math.hypot(dx, dy) || 1;
  g.bolts.push({
    x: e.x + (dx / d) * 9, y: e.y + (dy / d) * 9,
    vx: (dx / d) * BOLT_SPEED, vy: (dy / d) * BOLT_SPEED,
    life: BOLT_LIFE, fromRival: e.rival, tier: e.tier,
  });
  relSfx(g, 'zap', e.tier, e.x, e.y);
}

// Compass bearing from the player to the Standing Stones altar.
export function stonesBearing(g: Game): string {
  const dx = g.world.altarX - g.player.x, dy = g.world.altarY - g.player.y;
  let s = '';
  if (dy < -40) s += 'N'; else if (dy > 40) s += 'S';
  if (dx > 40) s += 'E'; else if (dx < -40) s += 'W';
  return s || 'HERE';
}

// Drop shards on nearby walkable tiles so they can never land in water/hedges.
function dropShards(g: Game, e: Ent): void {
  const tx0 = Math.floor(e.x / TILE), ty0 = Math.floor(e.y / TILE);
  let left = e.shards;
  for (let r = 0; r <= 4 && left > 0; r++) {
    for (let dy = -r; dy <= r && left > 0; dy++) {
      for (let dx = -r; dx <= r && left > 0; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!solidTile(g.world, tx0 + dx, ty0 + dy)) {
          g.shards.push({ x: (tx0 + dx) * TILE + 4, y: (ty0 + dy) * TILE + 4 });
          left--;
        }
      }
    }
  }
}

function derez(g: Game, e: Ent): void {
  g.fx.push({ x: e.x, y: e.y, t0: g.time, kind: 0 });
  dropShards(g, e);
  e.shards = 0;
  setTier(g, e, Math.max(0, e.tier - 1));
  e.x = e.homeX; e.y = e.homeY;
  e.hp = 3; e.inv = 2; e.channel = 0; e.hold = 0;
  relSfx(g, 'derez', e.tier, g.player.x, g.player.y);
  msg(g, e.rival ? 'KERNAGH DEREZZED! HE DROPS TO T' + e.tier : 'DEREZZED! YOU FALL TO T' + e.tier, 3);
}

function pickups(g: Game, e: Ent): void {
  if (e.shards >= SHARDS_PER_UPGRADE) return;
  for (let i = g.shards.length - 1; i >= 0; i--) {
    const s = g.shards[i];
    if (Math.hypot(s.x - e.x, s.y - e.y) < 10) {
      g.shards.splice(i, 1);
      e.shards++;
      relSfx(g, 'pickup', e.tier, s.x, s.y);
      if (e.rival) g.ai.pauseUntil = g.time + 5;  // he potters a while, Leanoric-style
      if (!e.rival) {
        if (e.shards >= SHARDS_PER_UPGRADE && !g.hinted3) {
          g.hinted3 = true;
          msg(g, '3 SHARDS! THE STANDING STONES ARE ' + stonesBearing(g), 4);
        } else if (e.shards >= SHARDS_PER_UPGRADE) {
          msg(g, 'SHARDS 3/3 - STONES ARE ' + stonesBearing(g));
        } else {
          msg(g, 'SHARD ' + e.shards + '/3');
        }
      }
      if (e.shards >= SHARDS_PER_UPGRADE) break;
    }
  }
}

function ritual(g: Game, e: Ent, dt: number): void {
  const near = Math.hypot(e.x - g.world.altarX, e.y - g.world.altarY) < 24;
  if (near && e.shards >= SHARDS_PER_UPGRADE && e.tier < WIN_TIER) {
    const before = e.channel;
    e.channel += dt;
    if (Math.floor(e.channel) > Math.floor(before)) {
      relSfx(g, 'ritual', e.tier, e.x, e.y);
    }
    if (e.channel >= CHANNEL_TIME) {
      e.channel = 0;
      e.shards = 0;
      setTier(g, e, e.tier + 1);
      g.fx.push({ x: g.world.altarX, y: g.world.altarY, t0: g.time, kind: 2 });
      relSfx(g, 'upgrade', e.tier, e.x, e.y);
      msg(g, e.rival ? 'KERNAGH ASCENDS TO T' + e.tier + ' ' + tierName(e.tier)
        : 'UPGRADE! T' + e.tier + ' ' + tierName(e.tier), 3.5);
    }
  } else {
    e.channel = 0;
  }
}

function tierName(t: number): string {
  return ['1979 MONO', 'SPECTRUM 48K', 'SPECTRUM 128', '8-BIT SPRITES', '16-BIT ST', 'AMIGA'][t];
}

export function update(g: Game, inp: Input, dt: number): void {
  if (g.mode !== 'play') return;
  g.time += dt;
  const p = g.player, r = g.rival;

  // --- Player movement
  let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  if (dx || dy) {
    const m = moveEnt(g.world, p, dx * SPEED * dt, dy * SPEED * dt);
    p.animDist += m;
    p.stepAcc += m;
    p.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0);
    if (p.stepAcc > 11) { p.stepAcc = 0; sfx('step', p.tier, 1); }
  }
  if (inp.fire && p.cool <= 0) {
    if (inSafe(p.x, p.y)) { sfx('deny', p.tier, 0.7); p.cool = 0.4; }
    else { const v = FACING_VECS[p.facing]; fire(g, p, v[0], v[1]); }
  }

  // --- Rival
  updateRival(g, dt, (bx, by) => fire(g, r, bx, by));
  if (r.stepAcc > 11) { r.stepAcc = 0; relSfx(g, 'step', r.tier, r.x, r.y, 0.9); }

  // --- Timers
  for (const e of [p, r]) {
    e.cool = Math.max(0, e.cool - dt);
    e.inv = Math.max(0, e.inv - dt);
    e.regen += dt;
    if (e.regen > REGEN_EVERY) { e.regen = 0; if (e.hp < 3) e.hp++; }
  }

  // --- Bolts
  for (let i = g.bolts.length - 1; i >= 0; i--) {
    const b = g.bolts[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    const gone = b.life <= 0 || solidPx(g.world, b.x, b.y) || inSafe(b.x, b.y);
    let hit = false;
    const victim = b.fromRival ? p : r;
    if (!gone && victim.inv <= 0 && !inSafe(victim.x, victim.y)
      && Math.hypot(b.x - victim.x, b.y - victim.y) < 8) {
      hit = true;
      victim.hp--;
      victim.inv = 0.8;
      victim.channel = 0;
      relSfx(g, 'hit', b.tier, b.x, b.y);
      if (victim.hp <= 0) derez(g, victim);
    }
    if (gone || hit) g.bolts.splice(i, 1);
  }

  // --- Shards: pickups + respawn
  pickups(g, p);
  pickups(g, r);
  g.respawn -= dt;
  if (g.respawn <= 0) {
    g.respawn = RESPAWN_EVERY;
    if (g.shards.length < MAX_GROUND_SHARDS) {
      const empty = g.world.shrines.filter(s =>
        !g.shards.some(sh => Math.hypot(sh.x - (s.x * TILE + 4), sh.y - (s.y * TILE + 4)) < 12));
      if (empty.length) {
        const s = empty[Math.floor(Math.random() * empty.length)];
        const sx = s.x * TILE + 4, sy = s.y * TILE + 4;
        g.shards.push({ x: sx, y: sy });
        g.fx.push({ x: sx, y: sy, t0: g.time, kind: 1 });
        relSfx(g, 'spawn', p.tier, sx, sy, 0.8);
      }
    }
  }

  // --- Rituals & win hold
  ritual(g, p, dt);
  ritual(g, r, dt);
  for (const e of [p, r]) {
    if (e.tier >= WIN_TIER) {
      e.hold += dt;
      if (!e.rival || screenOf(r.x, r.y).x === screenOf(p.x, p.y).x) {
        msg(g, (e.rival ? 'KERNAGH LOCKS THE SIGNAL IN ' : 'SIGNAL LOCK IN ')
          + Math.ceil(HOLD_TIME - e.hold), 0.3);
      }
      if (e.hold >= HOLD_TIME) {
        g.mode = e.rival ? 'lose' : 'win';
        g.endTime = g.time;
        return;
      }
    } else {
      e.hold = 0;
    }
  }

  // Gentle reminder while carrying a full set away from the altar.
  if (p.shards >= SHARDS_PER_UPGRADE && p.tier < WIN_TIER && g.time > g.msgUntil
    && Math.hypot(p.x - g.world.altarX, p.y - g.world.altarY) > 120) {
    msg(g, 'STONES ARE ' + stonesBearing(g) + ' - CHANNEL THERE', 2);
  }

  // --- FX cleanup
  g.fx = g.fx.filter(f => g.time - f.t0 < 1);

  // --- Camera: snap at Spectrum tiers (flick-screen), slide at T3+
  const s = screenOf(p.x, p.y);
  const txc = clamp(s.x * SCR_W, 0, WORLD_W - SCR_W);
  const tyc = clamp(s.y * SCR_H, 0, WORLD_H - SCR_H);
  if (p.tier <= 2) {
    g.camX = txc; g.camY = tyc;
  } else {
    const k = Math.min(1, dt * 9);
    g.camX += (txc - g.camX) * k;
    g.camY += (tyc - g.camY) * k;
    if (Math.abs(txc - g.camX) < 0.6) g.camX = txc;
    if (Math.abs(tyc - g.camY) < 0.6) g.camY = tyc;
  }
}
