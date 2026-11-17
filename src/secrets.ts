// ============================ SPOILERS ============================
// Everything in this file is meant to be found by playing, not by reading.
// If you'd rather discover it, close the tab now. The rest of the codebase
// only calls the sx* hooks below and never needs to know what they do.
// ==================================================================

import {
  Game, Ent, Bolt, Input, Tl, TILE, WORLD_TW, WORLD_TH, WIN_TIER, SHARDS_PER_UPGRADE,
  FACING_VECS, CANVAS_H, SPECTRUM, C64, inSafe, SOLID_LUT,
} from './defs';
import { tileAt } from './map';
import { sfx } from './audio';
import { drawText, textWidth } from './font';

const VLY = 'upgrade-vly-';   // valley-owned state: the Void takes it with the rest
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null): void => {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
};
const say = (g: Game, text: string, dur = 3): void => { g.msg = text; g.msgUntil = g.time + dur; };
const num = (k: string): number => parseInt(get(k) ?? '0', 10) || 0;

const ICE_SECS = 7;

// ---------- per-game setup ----------

export function sxInit(g: Game): void {
  const sx: Record<string, number> = { bank: 0, put: 0, echo: -1, edge: 0, said: 0 };
  g.sx = sx;
  g.ice = [];
  // Kernagh keeps count. Beat him repeatedly and he sharpens up; lose and
  // lose again on easy and he lets his guard drop.
  const streak = num('upgrade-kernagh');
  sx.edge = streak >= 2 ? Math.min(3, streak - 1) : streak <= -3 && g.difficulty === 'easy' ? -1 : 0;
  if (g.chaosSeed != null) return;
  // What the well was given in earlier games.
  sx.bank = Math.min(3, num(VLY + 'well-' + g.mapName));
  // Where the last game derezzed you, something was left behind.
  const echo = get(VLY + 'echo-' + g.mapName);
  if (echo != null) {
    const i = +echo, tx = i % WORLD_TW, ty = (i / WORLD_TW) | 0;
    const x = tx * TILE + 4, y = ty * TILE + 4;
    if (i > 0 && i < g.world.tiles.length && !SOLID_LUT[g.world.tiles[i]] && !inSafe(g.world, x, y)) {
      g.shards.push({ x, y });
    }
  }
}

// Extra tiles of perception / seconds of dawdle for the AI (see sxInit).
export function sxSight(g: Game): number { return (g.sx?.edge ?? 0) * 3; }
export function sxDawdle(g: Game): number { return (g.sx?.edge ?? 0) * -1.2; }

export function sxOpening(g: Game): string | null {
  const e = g.sx?.edge ?? 0;
  return e > 0 ? 'KERNAGH HAS BEEN PRACTISING' : e < 0 ? 'KERNAGH GROWS COMPLACENT' : null;
}

// ---------- in play ----------

// FIRE while facing a well. An old deposit comes back; otherwise one carried
// shard goes down for a later game. True when the well took the keypress.
export function sxWell(g: Game): boolean {
  const sx = g.sx, p = g.player;
  if (!sx || g.chaosSeed != null) return false;
  const v = FACING_VECS[p.facing];
  if (tileAt(g.world, Math.floor(p.x / TILE) + v[0], Math.floor(p.y / TILE) + v[1]) !== Tl.WELL) return false;
  const key = VLY + 'well-' + g.mapName;
  if (sx.bank > 0 && p.shards < SHARDS_PER_UPGRADE) {
    const n = Math.min(sx.bank, SHARDS_PER_UPGRADE - p.shards);
    p.shards += n; sx.bank -= n;
    put(key, String(sx.bank + sx.put));
    sfx('pickup', p.tier);
    say(g, 'THE WELL RETURNS WHAT IT KEPT');
  } else if (p.shards > 0 && sx.bank + sx.put < 3) {
    p.shards--; sx.put++;
    put(key, String(sx.bank + sx.put));
    sfx('pushdone', p.tier, 0.6);
    say(g, 'THE WELL KEEPS IT FOR ANOTHER DAY');
  } else return false;
  p.cool = 0.7;
  return true;
}

// Opposing bolts that meet in the air cancel.
export function sxParry(g: Game): void {
  const B = g.bolts;
  for (let i = B.length - 1; i > 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      if (B[i].fromRival === B[j].fromRival) continue;
      if (Math.hypot(B[i].x - B[j].x, B[i].y - B[j].y) > 7) continue;
      g.fx.push({ x: (B[i].x + B[j].x) / 2, y: (B[i].y + B[j].y) / 2, t0: g.time, kind: 1 });
      sfx('crack', g.player.tier, 0.5);
      B.splice(i, 1); B.splice(j, 1);
      i--;
      break;
    }
  }
}

const occupied = (g: Game, i: number): boolean => {
  const cx = (i % WORLD_TW) * TILE + 4, cy = ((i / WORLD_TW) | 0) * TILE + 4;
  return [g.player, g.rival].some(e => Math.abs(e.x - cx) < 7.5 && Math.abs(e.y - cy) < 7.5);
};

// Ice over water leaves a brief crossing; fire takes it away again.
export function sxBolt(g: Game, b: Bolt): void {
  if (!g.ice) return;
  const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
  if (tx < 1 || ty < 1 || tx >= WORLD_TW - 1 || ty >= WORLD_TH - 1) return;
  const i = ty * WORLD_TW + tx, t = g.world.tiles[i];
  if (b.kind === 'ice' && (t === Tl.WATER || t === Tl.ICE)) {
    const held = g.ice.find(c => c.i === i);
    if (held) { held.until = g.time + ICE_SECS; return; }
    g.world.tiles[i] = Tl.ICE;
    g.ice.push({ i, until: g.time + ICE_SECS });
    if (g.sx && !g.sx.said && !b.fromRival) { g.sx.said = 1; say(g, 'THE WATER FREEZES - FOR NOW'); sfx('freeze', g.player.tier, 0.5); }
  } else if (b.kind === 'fire' && t === Tl.ICE && !occupied(g, i)) {
    g.world.tiles[i] = Tl.WATER;
    g.ice = g.ice.filter(c => c.i !== i);
  }
}

let wasFire = false;

export function sxUpdate(g: Game, inp: Input): void {
  if (g.ice) {
    for (let k = g.ice.length - 1; k >= 0; k--) {
      const c = g.ice[k];
      if (g.time < c.until) continue;
      if (g.world.tiles[c.i] !== Tl.ICE) { g.ice.splice(k, 1); continue; }
      // Never thaw under a wizard's boots: the floe holds while it is stood on.
      if (occupied(g, c.i)) { c.until = g.time + 0.4; continue; }
      g.world.tiles[c.i] = Tl.WATER;
      g.ice.splice(k, 1);
    }
  }
  wasFire = inp.fire;
}
export function sxFirePressed(inp: Input): boolean { return inp.fire && !wasFire; }

// The moment of a derez, before the fall is applied.
export function sxDerez(g: Game, e: Ent): void {
  if (e.rival || !g.sx) return;
  g.crash = { tier: e.tier, at: performance.now() / 1000 };
  if (!inSafe(g.world, e.x, e.y)) g.sx.echo = Math.floor(e.y / TILE) * WORLD_TW + Math.floor(e.x / TILE);
}

// A ritual at the very floor, by someone who has stood at the very top.
export function sxRitual(g: Game, e: Ent): boolean {
  if (e.rival || e.tier !== 0 || g.maxTier < WIN_TIER) return false;
  g.mode = 'win';
  g.winWhy = 'circle';
  g.winTier = 0;
  g.endTime = g.time;
  return true;
}
export function sxBonus(g: Game): number { return g.mode === 'win' && g.winWhy === 'circle' ? 2000 : 0; }

// ---------- between games ----------

export function sxEnd(g: Game): void {
  if (g.mode === 'void') return;
  const streak = num('upgrade-kernagh');
  const won = g.mode === 'win';
  put('upgrade-kernagh', String(won ? Math.max(1, streak + 1) : Math.min(-1, streak - 1)));
  put('upgrade-best-tier', String(Math.max(num('upgrade-best-tier'), g.maxTier)));
  if (g.chaosSeed == null && g.sx) {
    put(VLY + 'echo-' + g.mapName, g.sx.echo >= 0 ? String(g.sx.echo) : null);
  }
}

// The title credit only counts as far as you have ever climbed.
export function sxYears(all: number): number {
  return Math.max(6, Math.min(all, num('upgrade-best-tier') + 1));
}

// ---------- keys ----------

let typed = '';
let lastKey = 0;
const WORDS: [string, string][] = [
  ['xyzzy', 'NOTHING HAPPENS'],
  ['iddqd', 'DEGREELESSNESS IS ANOTHER GAME ENTIRELY'],
  ['idkfa', 'NO KEYS. NO AMMO. ONLY SHARDS'],
  ['rosebud', 'THE VALLEY HAS NO USE FOR SIMOLEONS'],
  ['plugh', 'A HOLLOW VOICE SAYS - UPGRADE'],
];

export function sxKey(g: Game, key: string): void {
  lastKey = performance.now() / 1000;
  if (g.mode !== 'play' || key.length !== 1) return;
  typed = (typed + key.toLowerCase()).slice(-12);
  for (const [w, reply] of WORDS) {
    if (typed.endsWith(w)) { typed = ''; say(g, reply, 3.5); sfx('deny', g.player.tier, 0.6); }
  }
}

// ---------- drawing ----------

type Ctx = CanvasRenderingContext2D;
const mid = (c: Ctx, s: string, y: number, col: string, VW: number, scale = 1): void =>
  drawText(c, s, Math.floor((VW - textWidth(s, scale)) / 2), y, col, scale);

// Leave the title alone long enough and the machine looks after its tube.
export function sxTitleScreen(c: Ctx, time: number): boolean {
  if (lastKey === 0) lastKey = time;
  if (time - lastKey < 75) return false;
  c.fillStyle = '#000000';
  c.fillRect(0, 0, 256, CANVAS_H);
  for (let i = 0; i < 90; i++) {
    const z = 1 - (((time * (0.12 + (i % 7) * 0.02) + i * 0.137) % 1));
    const a = i * 2.399, r = (1 - z) * 190;
    const x = 128 + Math.cos(a) * r, y = 96 + Math.sin(a) * r * 0.75;
    const s = z < 0.35 ? 2 : 1;
    c.fillStyle = z < 0.2 ? '#ffffff' : z < 0.55 ? '#b0b0b0' : '#606060';
    c.fillRect(Math.floor(x), Math.floor(y), s, s);
  }
  return true;
}

// For a breath after you are derezzed, the tier you just lost fails the way
// its hardware used to.
export function sxOverlay(c: Ctx, g: Game, time: number, VW: number): void {
  const cr = g.crash;
  if (!cr) return;
  const t = time - cr.at;
  if (t < 0 || t > 1.5) { if (t > 1.5) g.crash = undefined; return; }
  const H = CANVAS_H, blink = Math.floor(time * 3) % 2 === 0;
  if (cr.tier <= 2) {
    c.fillStyle = SPECTRUM[5]; c.fillRect(0, 0, VW, H);
    c.fillStyle = SPECTRUM[7]; c.fillRect(16, 16, VW - 32, H - 32);
    drawText(c, 'R TAPE LOADING ERROR, 0:1', 20, H - 26, '#000000');
  } else if (cr.tier === 3) {
    c.fillStyle = C64.lightBlue; c.fillRect(0, 0, VW, H);
    c.fillStyle = C64.blue; c.fillRect(16, 16, VW - 32, H - 32);
    drawText(c, '?OUT OF MEMORY  ERROR', 20, 60, C64.lightBlue);
    drawText(c, 'READY.', 20, 68, C64.lightBlue);
    if (blink) { c.fillStyle = C64.lightBlue; c.fillRect(20, 76, 4, 6); }
  } else if (cr.tier === 4) {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, VW, H);
    c.fillStyle = '#000000';
    for (let i = 0; i < 4; i++) {
      const x = 18 + i * 16;
      c.beginPath(); c.arc(x, 96, 5, 0, Math.PI * 2); c.fill();
      c.fillRect(x - 1, 88, 3, 4); c.fillRect(x + 1, 86, 4, 1); c.fillRect(x + 5, 84, 1, 2);
    }
  } else if (cr.tier === 5) {
    c.fillStyle = '#000000'; c.fillRect(0, 0, VW, H);
    if (blink) { c.strokeStyle = '#e00000'; c.lineWidth = 3; c.strokeRect(6, 6, VW - 12, 40); }
    mid(c, 'SOFTWARE FAILURE.   PRESS LEFT MOUSE BUTTON TO CONTINUE.', 16, '#e00000', VW);
    mid(c, 'GURU MEDITATION #00000004.0000AAC0', 30, '#e00000', VW);
  } else if (cr.tier === 6) {
    c.fillStyle = '#0000aa'; c.fillRect(0, 0, VW, H);
    const w = textWidth(' WINDOWS ');
    c.fillStyle = '#aaaaaa'; c.fillRect(Math.floor((VW - w) / 2) - 2, 52, w + 4, 9);
    mid(c, ' WINDOWS ', 54, '#0000aa', VW);
    drawText(c, 'A FATAL EXCEPTION 0E HAS OCCURRED AT 0028:C0011E36 IN', 18, 74, '#ffffff');
    drawText(c, 'VXD KERNAGH(01). THE CURRENT WIZARD WILL BE TERMINATED.', 18, 82, '#ffffff');
    drawText(c, '*  YOU WILL LOSE ANY UNSAVED SHARDS.', 18, 98, '#ffffff');
    mid(c, 'PRESS ANY KEY TO CONTINUE ' + (blink ? '_' : ' '), 120, '#ffffff', VW);
  } else {
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(0, 0, VW, H);
    const x = Math.floor(VW / 2) - 92;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x + 3, 63, 184, 62);
    c.fillStyle = '#f0f0f0'; c.fillRect(x, 60, 184, 62);
    c.fillStyle = '#4a78b8'; c.fillRect(x, 60, 184, 11);
    drawText(c, 'VALLEY.EXE', x + 4, 63, '#ffffff');
    drawText(c, 'VALLEY.EXE HAS STOPPED WORKING', x + 8, 80, '#1a3a8a');
    drawText(c, 'CHECKING FOR A SOLUTION TO THE PROBLEM...', x + 8, 92, '#202020');
    c.fillStyle = '#c8c8c8'; c.fillRect(x + 8, 104, 168, 6);
    c.fillStyle = '#30b030'; c.fillRect(x + 8 + ((t * 120) % 140), 104, 28, 6);
  }
}
