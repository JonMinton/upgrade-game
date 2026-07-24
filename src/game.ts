// Game state and simulation.

import {
  Game, Ent, Input, World, START_TIER, WIN_TIER, SHARDS_PER_UPGRADE, CHANNEL_TIME, FINAL_CHANNEL_TIME,
  FACING_VECS, TILE, SCR_W, SCR_H, inSafe, screenOf, clamp, WORLD_W, WORLD_H,
  FREEZE_TIME, STAGGER_TIME, WORLD_TW, Tl, PUSH_CFG,
} from './defs';
import { glenTiles, worldFromTiles, moveEnt, solidTile, blocksBolt, tileAt, pushSlide } from './map';
import { ruleGenTiles } from './rulegen';
import { evolveTiles, placePushstone, visitCount, rngFor } from './evolve';
import { updateRival } from './ai';
import { sfx, setMusicTier, SfxName } from './audio';

const SPEED = 64;
const BOLT_SPEED = 150;
const BOLT_LIFE = 0.9;
const RESPAWN_EVERY = 19;
const REGEN_EVERY = 12;
const MAX_GROUND_SHARDS = 10;

function makeEnt(x: number, y: number, rival: boolean): Ent {
  return {
    x, y, facing: 0, hp: 3, tier: START_TIER, shards: 0,
    cool: 0, channel: 0, inv: 0, regen: 0,
    stun: 0, wand: 'fire', onStation: false,
    animDist: 0, stepAcc: 0, homeX: x, homeY: y, rival,
  };
}

export function newGame(difficulty: 'easy' | 'hard' = 'easy', chaosSeed: number | null = null): Game {
  // Priority: chaos-mode roll > editor-staged map (localStorage) > default.
  // Named maps age between games (one CA generation per completed visit);
  // GLEN and chaos maps may also be offered a pushstone. Editor maps keep
  // their painted stones verbatim — hand-authored intent wins.
  let world: World;
  let mapName = 'GLEN';
  if (chaosSeed != null) {
    const t = ruleGenTiles(chaosSeed);
    placePushstone(t, rngFor('PUSH:CHAOS', chaosSeed));
    world = worldFromTiles(t);
    mapName = 'CHAOS';
  } else {
    try {
      const o = localStorage.getItem('upgrade-map');
      if (o) {
        const t = Uint8Array.from(JSON.parse(o) as number[]);
        mapName = (localStorage.getItem('upgrade-map-name') || 'CUSTOM').toUpperCase().slice(0, 6);
        for (let i = 1; i <= visitCount(mapName); i++) evolveTiles(t, mapName, i);
        world = worldFromTiles(t);
      } else {
        const t = glenTiles();
        const n = visitCount('GLEN');
        for (let i = 1; i <= n; i++) evolveTiles(t, 'GLEN', i);
        placePushstone(t, rngFor('PUSH:GLEN', n));
        world = worldFromTiles(t);
      }
    } catch {
      world = worldFromTiles(glenTiles());
    }
  }
  const g: Game = {
    mode: 'loading', difficulty, loadT: 0, time: 0, world,
    player: makeEnt(world.pHomeX, world.pHomeY, false),
    rival: makeEnt(world.rHomeX, world.rHomeY, true),
    bolts: [], shards: [], fx: [],
    berryCd: world.berrySpots.map(() => 0),
    respawn: RESPAWN_EVERY,
    msg: '', msgUntil: 0,
    push: null,
    ripple: -1, rippleFrom: START_TIER,
    ai: {
      state: 'forage', path: [], pathI: 0, repath: 0, lastX: 0, lastY: 0, stuck: 0,
      targetKey: '', interceptT: 0, coolUntil: 0, pauseUntil: 0, nearT: 0,
    },
    camX: 0, camY: SCR_H * 3,
    hinted3: false, endTime: 0, loseWhy: 'race', winWhy: 'transcend', winTier: WIN_TIER,
    maxTier: START_TIER, kills: 0, score: 0, scored: false, entryActive: false, entryName: '',
    mapName, chaosSeed, seedEntry: null, escArmUntil: 0,
  };
  // A modest starting scatter (4 shrines, spread across the map); the rest of
  // the economy comes from respawns, so neither racer can sprint the ladder.
  const n = world.shrines.length;
  for (const i of new Set([0, n >> 2, n >> 1, (3 * n) >> 2])) {
    const s = world.shrines[i];
    if (s) g.shards.push({ x: s.x * TILE + 4, y: s.y * TILE + 4 });
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
    g.maxTier = Math.max(g.maxTier, tier);
    g.ripple = g.time;
    g.rippleFrom = old;
    setMusicTier(tier);
  }
}

// Arcade scoring: progress + aggression + victory + speed, doubled in hard mode.
export function finalScore(g: Game): number {
  let s = g.maxTier * 150 + g.kills * 75;
  if (g.mode === 'win') {
    s += g.winWhy === 'transcend' ? 500 : 250;
    s += Math.max(0, 600 - Math.floor(g.endTime));
  }
  if (g.difficulty === 'hard') s *= 2;
  return s;
}

function fire(g: Game, e: Ent, dx: number, dy: number): void {
  if (e.cool > 0 || inSafe(g.world, e.x, e.y)) return;
  e.cool = 1.0;
  const d = Math.hypot(dx, dy) || 1;
  g.bolts.push({
    x: e.x + (dx / d) * 9, y: e.y + (dy / d) * 9,
    vx: (dx / d) * BOLT_SPEED, vy: (dy / d) * BOLT_SPEED,
    life: BOLT_LIFE, fromRival: e.rival, tier: e.tier, kind: e.wand,
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
  if (e.rival) g.kills++;
  // Derezzed at the very floor of history: that entity is finished.
  if (e.tier === 0) {
    sfx('derez', e.rival ? g.player.tier : 0, 1);
    g.mode = e.rival ? 'win' : 'lose';
    g.loseWhy = 'derez';
    g.winWhy = 'elimination';
    g.winTier = g.player.tier;
    g.endTime = g.time;
    return;
  }
  const dropped = e.shards;
  dropShards(g, e);
  e.shards = 0;
  setTier(g, e, Math.max(0, e.tier - 1));
  e.x = e.homeX; e.y = e.homeY;
  e.hp = 3; e.inv = 2; e.channel = 0; e.stun = 0;
  relSfx(g, 'derez', e.tier, g.player.x, g.player.y);
  const loot = dropped > 0 ? ' - DROPS ' + '◆'.repeat(dropped) : '';
  msg(g, e.rival
    ? 'KERNAGH DEREZZED TO T' + e.tier + loot
    : 'DEREZZED! YOU FALL TO T' + e.tier + loot, 3);
}

function pickups(g: Game, e: Ent): void {
  if (e.shards >= SHARDS_PER_UPGRADE) return;
  for (let i = g.shards.length - 1; i >= 0; i--) {
    const s = g.shards[i];
    if (Math.hypot(s.x - e.x, s.y - e.y) < 10) {
      g.shards.splice(i, 1);
      e.shards++;
      relSfx(g, 'pickup', e.tier, s.x, s.y);
      if (e.rival) g.ai.pauseUntil = g.time + (g.difficulty === 'easy' ? 9 : 5);  // he potters a while
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

const BERRY_REGROW = 30;

function berryPickups(g: Game, e: Ent): void {
  if (e.hp >= 3) return;
  g.world.berrySpots.forEach((b, i) => {
    if (g.berryCd[i] > 0) return;
    if (Math.hypot(b.x * TILE + 4 - e.x, b.y * TILE + 4 - e.y) < 10) {
      g.berryCd[i] = BERRY_REGROW;
      e.hp = Math.min(3, e.hp + 1);
      relSfx(g, 'berry', e.tier, e.x, e.y);
      if (!e.rival) msg(g, 'BERRIES! +♥');
    }
  });
}

function ritual(g: Game, e: Ent, dt: number): void {
  const near = Math.hypot(e.x - g.world.altarX, e.y - g.world.altarY) < 24;
  if (near && e.shards >= SHARDS_PER_UPGRADE) {
    const needed = e.tier >= WIN_TIER ? FINAL_CHANNEL_TIME : CHANNEL_TIME;
    const before = e.channel;
    e.channel += dt;
    if (Math.floor(e.channel) > Math.floor(before)) {
      relSfx(g, 'ritual', e.tier, e.x, e.y);
    }
    if (e.channel >= needed) {
      e.channel = 0;
      e.shards = 0;
      g.fx.push({ x: g.world.altarX, y: g.world.altarY, t0: g.time, kind: 2 });
      relSfx(g, 'upgrade', e.tier, e.x, e.y);
      if (e.tier >= WIN_TIER) {
        // The final upgrade: transcendence beyond 1995.
        g.mode = e.rival ? 'lose' : 'win';
        g.loseWhy = 'race';
        g.winWhy = 'transcend';
        g.winTier = g.player.tier;
        g.endTime = g.time;
        return;
      }
      setTier(g, e, e.tier + 1);
      msg(g, e.rival ? 'KERNAGH ASCENDS TO T' + e.tier + ' ' + tierName(e.tier)
        : 'UPGRADE! T' + e.tier + ' ' + tierName(e.tier), 3.5);
      if (e.tier >= WIN_TIER && !e.rival) {
        msg(g, 'ONE FINAL RITUAL REMAINS - 3 MORE SHARDS', 4);
      }
    }
  } else {
    e.channel = 0;
  }
}

function tierName(t: number): string {
  return ['1979 MONO', 'SPECTRUM 48K', 'SPECTRUM 128', 'C64', '16-BIT ST', 'AMIGA'][t];
}

export function update(g: Game, inp: Input, dt: number): void {
  if (g.mode !== 'play') return;
  g.time += dt;
  const p = g.player, r = g.rival;

  // --- Player movement (locked while frozen/staggered)
  let dx = p.stun > 0 ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let dy = p.stun > 0 ? 0 : (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  if (dx || dy) {
    const m = moveEnt(g.world, p, dx * SPEED * dt, dy * SPEED * dt, r);
    p.animDist += m;
    p.stepAcc += m;
    p.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0);
    if (p.stepAcc > 11) { p.stepAcc = 0; sfx('step', p.tier, 1); }
  }
  if (inp.fire && p.cool <= 0 && p.stun <= 0) {
    if (inSafe(g.world, p.x, p.y)) { sfx('deny', p.tier, 0.7); p.cool = 0.4; }
    else { const v = FACING_VECS[p.facing]; fire(g, p, v[0], v[1]); }
  }

  // --- Wand station: walk onto your village pedestal to swap fire <-> ice.
  // Latch on entering 10px, release only past 16px — the release radius must
  // EXCEED the trigger radius or walking in arms the latch before the trigger.
  const stD = Math.hypot(g.world.pStationX - p.x, g.world.pStationY - p.y);
  if (stD < 10 && !p.onStation) {
    p.onStation = true;
    p.wand = p.wand === 'fire' ? 'ice' : 'fire';
    sfx('wand', p.tier);
    msg(g, p.wand === 'ice'
      ? 'ICEWAND - FREEZES BUT DOES NOT HARM'
      : 'FIREWAND - HARMS WITH A BRIEF STUN', 3);
  } else if (stD > 16) {
    p.onStation = false;
  }

  // --- Pushstone: sustained, square-on shoving shifts the marked stone into
  // the river, fording it — permanently, for this game, for both wizards.
  // Only a direction that actually reaches water accumulates; anything else
  // is just leaning on a rock. Any interruption (release, diagonal, stun)
  // resets progress: the hold time IS the cost.
  let pushing = false;
  {
    const pdx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const pdy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (p.stun <= 0 && (pdx === 0) !== (pdy === 0)) {
      const ptx = Math.floor(p.x / TILE) + pdx, pty = Math.floor(p.y / TILE) + pdy;
      if (tileAt(g.world, ptx, pty) === Tl.PUSH && pushSlide(g.world, ptx, pty, pdx, pdy)) {
        pushing = true;
        if (!g.push || g.push.tx !== ptx || g.push.ty !== pty || g.push.dx !== pdx || g.push.dy !== pdy) {
          g.push = { tx: ptx, ty: pty, dx: pdx, dy: pdy, t: 0 };
        }
        const before = g.push.t;
        g.push.t += dt;
        // Grind in effortful bursts rather than a continuous drone.
        if (Math.floor(before / 0.45) !== Math.floor(g.push.t / 0.45)) sfx('push', p.tier);
        if (g.push.t >= PUSH_CFG.holdSecs) {
          const slide = pushSlide(g.world, ptx, pty, pdx, pdy)!;
          const T = g.world.tiles;
          T[pty * WORLD_TW + ptx] = Tl.DIRT;   // the bare socket the stone left
          for (const cv of slide.carve) T[cv.y * WORLD_TW + cv.x] = Tl.PATH;
          const splash = slide.carve[0];
          g.fx.push({ x: splash.x * TILE + 4, y: splash.y * TILE + 4, t0: g.time, kind: 0 });
          sfx('pushdone', p.tier);
          msg(g, 'THE STONE SETTLES - A NEW FORD', 4);
          g.push = null;
        }
      }
    }
  }
  if (!pushing) g.push = null;

  // --- Rival
  updateRival(g, dt, (bx, by) => {
    fire(g, r, bx, by);
    if (g.difficulty === 'easy') r.cool = 1.8;   // slower trigger finger
  });
  if (r.stepAcc > 11) { r.stepAcc = 0; relSfx(g, 'step', r.tier, r.x, r.y, 0.9); }

  // --- Timers
  for (const e of [p, r]) {
    e.cool = Math.max(0, e.cool - dt);
    e.inv = Math.max(0, e.inv - dt);
    e.stun = Math.max(0, e.stun - dt);
    e.regen += dt;
    if (e.regen > REGEN_EVERY) { e.regen = 0; if (e.hp < 3) e.hp++; }
  }

  // --- Bolts
  for (let i = g.bolts.length - 1; i >= 0; i--) {
    const b = g.bolts[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    const gone = b.life <= 0 || blocksBolt(g.world, b.x, b.y) || inSafe(g.world, b.x, b.y);
    let hit = false;
    const victim = b.fromRival ? p : r;
    if (!gone && victim.inv <= 0 && !inSafe(g.world, victim.x, victim.y)
      && Math.hypot(b.x - victim.x, b.y - victim.y) < 8) {
      hit = true;
      victim.channel = 0;
      if (b.kind === 'ice') {
        // Icewand: harmless but freezes solid for a long moment.
        victim.stun = FREEZE_TIME;
        victim.inv = 0.4;
        relSfx(g, 'freeze', b.tier, b.x, b.y);
      } else {
        victim.hp--;
        victim.stun = Math.max(victim.stun, STAGGER_TIME);
        victim.inv = 0.8;
        relSfx(g, 'hit', b.tier, b.x, b.y);
        if (victim.hp <= 0) derez(g, victim);
      }
    }
    if (gone || hit) g.bolts.splice(i, 1);
  }

  // --- Shards & berries: pickups + respawn
  pickups(g, p);
  pickups(g, r);
  berryPickups(g, p);
  berryPickups(g, r);
  for (let i = 0; i < g.berryCd.length; i++) g.berryCd[i] = Math.max(0, g.berryCd[i] - dt);
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

  // --- Rituals (including the final transcendence ritual at T5)
  ritual(g, p, dt);
  if (g.mode !== 'play') return;
  ritual(g, r, dt);
  if (g.mode !== 'play') return;

  // Gentle reminder while carrying a full set away from the altar.
  if (p.shards >= SHARDS_PER_UPGRADE && g.time > g.msgUntil
    && Math.hypot(p.x - g.world.altarX, p.y - g.world.altarY) > 120) {
    msg(g, (p.tier >= WIN_TIER ? 'THE FINAL RITUAL AWAITS ' : 'STONES ARE ')
      + stonesBearing(g), 2);
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
