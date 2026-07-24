// All rendering. Two pipelines:
//  - Attribute pipeline (env tiers 0-2): 1-bit bitmap + 8x8 attribute cells,
//    with genuine colour clash at T1.
//  - Direct pipeline (env tiers 3-5): full-colour canvas drawing.
// Avatars always render at their OWN tier, whatever the environment tier.

import {
  Game, Ent, SCR_W, SCR_H, SCR_TW, SCR_TH, CANVAS_W, CANVAS_H, TILE, Tl, TIERS,
  SPECTRUM, C64, TILE_ATTR, THEME, Theme, PLAYER_BANDS, RIVAL_BANDS, Bands,
  PLAYER_INKS, RIVAL_INKS, BOLT_INK, SHARD_INK, CHANNEL_TIME, PUSH_CFG, clamp, screenOf,
} from './defs';
import { tileAt } from './map';
import {
  PATTERNS, GRASS_ALT, BOLT_PATS, shardPat, wizMask, bandOfRow,
  BERRY_DOTS, WAND_FIRE, WAND_ICE, SHARD_TAPE,
} from './sprites';
import { drawText, textWidth } from './font';
import { filteredScores, activeMapFilter } from './hiscores';

// Pulsing diamond burst for T0 shard signalling (16x16).
const BURST = (() => {
  const m = new Uint8Array(256);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const d = Math.abs(r - 7.5) + Math.abs(c - 7.5);
      if (d >= 6 && d <= 8) m[r * 16 + c] = 1;
    }
  }
  return m;
})();

const bmp = new Uint8Array(SCR_W * SCR_H);
const inkA = new Uint8Array(SCR_TW * SCR_TH);
const papA = new Uint8Array(SCR_TW * SCR_TH);

let img: ImageData | null = null;
let px32: Uint32Array | null = null;
let offA: HTMLCanvasElement | null = null;
let offB: HTMLCanvasElement | null = null;

const SPEC_ABGR = SPECTRUM.map(h => {
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
});
const WHITE_ABGR = 0xffffffff;
const BLACK_ABGR = 0xff000000;

function hash(i: number, s: number): number {
  let h = (i * 374761393 + s * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ---------- attribute pipeline helpers ----------

function stampPat(px: number, py: number, rows: number[]): void {
  for (let r = 0; r < 8; r++) {
    const y = py + r;
    if (y < 0 || y >= SCR_H) continue;
    const bits = rows[r];
    if (!bits) continue;
    for (let b = 0; b < 8; b++) {
      if (bits & (0x80 >> b)) {
        const x = px + b;
        if (x >= 0 && x < SCR_W) bmp[y * SCR_W + x] = 1;
      }
    }
  }
}

function stampMask16(px: number, py: number, m: Uint8Array): void {
  for (let r = 0; r < 16; r++) {
    const y = py + r;
    if (y < 0 || y >= SCR_H) continue;
    for (let c = 0; c < 16; c++) {
      if (m[r * 16 + c]) {
        const x = px + c;
        if (x >= 0 && x < SCR_W) bmp[y * SCR_W + x] = 1;
      }
    }
  }
}

function overrideInk(px: number, py: number, w: number, h: number, ink: number): void {
  const cx0 = Math.max(0, px >> 3), cy0 = Math.max(0, py >> 3);
  const cx1 = Math.min(SCR_TW - 1, (px + w - 1) >> 3), cy1 = Math.min(SCR_TH - 1, (py + h - 1) >> 3);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) inkA[cy * SCR_TW + cx] = ink;
  }
}

function quantPos(v: number, tier: number): number {
  const q = TIERS[Math.min(tier, 5)].quant;
  return Math.floor(v / q) * q;
}

function drawMaskPixels(
  c: CanvasRenderingContext2D, m: Uint8Array, px: number, py: number,
  colorOf: (row: number) => string,
): void {
  let last = '';
  for (let r = 0; r < 16; r++) {
    const col = colorOf(r);
    for (let cc = 0; cc < 16; cc++) {
      if (m[r * 16 + cc]) {
        if (col !== last) { c.fillStyle = col; last = col; }
        c.fillRect(px + cc, py + r, 1, 1);
      }
    }
  }
}

// Draw an 8-byte pattern directly to the canvas (direct pipeline + UI icons).
function drawPat(
  c: CanvasRenderingContext2D, rows: number[], x: number, y: number, color: string, scale = 1,
): void {
  c.fillStyle = color;
  for (let r = 0; r < 8; r++) {
    for (let b = 0; b < 8; b++) {
      if (rows[r] & (0x80 >> b)) c.fillRect(x + b * scale, y + r * scale, scale, scale);
    }
  }
}

function entFrame(e: Ent): number {
  return Math.floor(e.animDist / 12) % 2;
}

function entBob(e: Ent, moving = true): number {
  if (!moving) return 0;
  if (e.tier >= 4) return Math.round(Math.sin(e.animDist / 4));
  if (e.tier >= 2) return Math.floor(e.animDist / 6) % 2;
  return 0;
}

function invisible(g: Game, e: Ent): boolean {
  return e.inv > 0 && e.stun <= 0.6 && Math.floor(g.time * 12) % 2 === 0;
}

// A long stun is a freeze (icewand); a short one is just a stagger.
function frozen(e: Ent): boolean {
  return e.stun > 0.6;
}

// ---------- avatars ----------

function drawAvatarDirect(c: CanvasRenderingContext2D, e: Ent, sx: number, sy: number): void {
  const bands: Bands = e.rival ? RIVAL_BANDS : PLAYER_BANDS;
  const m = wizMask(e.facing, entFrame(e));
  const bob = entBob(e);
  if (e.tier >= 4) {
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    c.ellipse(sx + 8, sy + 15.5, 6, 2, 0, 0, Math.PI * 2);
    c.fill();
  }
  drawMaskPixels(c, m, sx, sy - bob, r => bands[bandOfRow(r)]);
  if (frozen(e)) {
    c.fillStyle = 'rgba(140,224,255,0.5)';
    c.fillRect(sx - 1, sy - 2, 18, 19);
  }
  if (e.channel > 0) drawChannelBar(c, e, sx, sy, '#ffffff');
}

function drawAvatarBlocky(c: CanvasRenderingContext2D, e: Ent, sx: number, sy: number): void {
  // A low-tier avatar seen inside a high-tier world: chunky two-colour relic.
  const m = wizMask(e.facing, e.tier === 0 ? 0 : entFrame(e));
  const [headInk, bodyInk] = e.rival ? RIVAL_INKS : PLAYER_INKS;
  drawMaskPixels(c, m, sx + 1, sy + 1, () => '#000000');
  drawMaskPixels(c, m, sx, sy,
    r => frozen(e) ? '#8ce0ff' : SPECTRUM[e.tier === 0 ? 7 : r < 8 ? headInk : bodyInk]);
  if (e.channel > 0) drawChannelBar(c, e, sx, sy, SPECTRUM[headInk]);
}

function drawChannelBar(c: CanvasRenderingContext2D, e: Ent, sx: number, sy: number, col: string): void {
  const w = Math.floor((e.channel / CHANNEL_TIME) * 16);
  c.fillStyle = '#000000';
  c.fillRect(sx, sy - 5, 16, 3);
  c.fillStyle = col;
  c.fillRect(sx + 1, sy - 4, Math.max(1, w - 2), 1);
}

// ---------- attribute pipeline (env tier 0-2) ----------

function attrRender(c: CanvasRenderingContext2D, g: Game, envTier: number): void {
  const w = g.world;
  const camX = Math.round(g.camX), camY = Math.round(g.camY);
  const camTx = camX >> 3, camTy = camY >> 3;
  bmp.fill(0);

  for (let cy = 0; cy < SCR_TH; cy++) {
    for (let cx = 0; cx < SCR_TW; cx++) {
      const tx = camTx + cx, ty = camTy + cy;
      const t = tileAt(w, tx, ty);
      const pat = t === Tl.GRASS && ((tx + ty) & 1) ? GRASS_ALT : PATTERNS[t];
      // At T0 the shrines are too degraded to render — the blinking shard IS the signal.
      if (!(envTier === 0 && t === Tl.SHRINE)) stampPat(cx * 8, cy * 8, pat);
      const ci = cy * SCR_TW + cx;
      inkA[ci] = TILE_ATTR[t][0];
      papA[ci] = TILE_ATTR[t][1];
    }
  }

  // Shards (world objects: env tier look). At T0 there's no colour to signal
  // with, so they BLINK inside a pulsing diamond burst — the monochrome era's
  // way of saying "look here".
  const spat = shardPat(envTier);
  const blinkOff = envTier === 0 && Math.floor(g.time * 3) % 2 === 1;
  for (const s of g.shards) {
    if (blinkOff) break;
    const sx = Math.round(s.x) - 4 - camX, sy = Math.round(s.y) - 4 - camY;
    if (sx < -12 || sy < -12 || sx > SCR_W + 4 || sy > SCR_H + 4) continue;
    stampPat(sx, sy, spat);
    if (envTier === 0) stampMask16(sx - 4, sy - 4, BURST);
    if (envTier >= 1) overrideInk(sx, sy, 8, 8, SHARD_INK);
  }

  // Berry bushes in fruit: dots overlay, cell ink flips to red.
  g.world.berrySpots.forEach((b, i) => {
    if (g.berryCd[i] > 0) return;
    const bx = b.x * 8 - camX, by = b.y * 8 - camY;
    if (bx < -8 || by < -8 || bx > SCR_W || by > SCR_H) return;
    stampPat(bx, by, BERRY_DOTS);
    if (envTier >= 1) overrideInk(bx, by, 8, 8, 10);
  });

  // Wand-swap stations: pedestal glyph shows the wand you'd swap TO.
  for (const [st, owner] of [[{x: g.world.pStationX, y: g.world.pStationY}, g.player], [{x: g.world.rStationX, y: g.world.rStationY}, g.rival]] as const) {
    const sx = Math.round(st.x) - 4 - camX, sy = Math.round(st.y) - 4 - camY;
    if (sx < -12 || sy < -12 || sx > SCR_W || sy > SCR_H) continue;
    const icePickup = owner.wand === 'fire';
    stampPat(sx, sy + 3, PATTERNS[Tl.SHRINE]);
    stampPat(sx, sy - 5, icePickup ? WAND_ICE : WAND_FIRE);
    if (envTier >= 1) overrideInk(sx, sy - 5, 8, 8, icePickup ? 13 : 10);
  }

  // Low-tier bolts join the bitmap; high-tier bolts drawn after colorize.
  for (const b of g.bolts) {
    if (b.tier > 2) continue;
    const bx = Math.round(b.x) - 4 - camX, by = Math.round(b.y) - 4 - camY;
    if (bx < -8 || by < -8 || bx > SCR_W || by > SCR_H) continue;
    stampPat(bx, by, BOLT_PATS[Math.floor(g.time * 14) % 2]);
    if (envTier >= 1) overrideInk(bx, by, 8, 8, b.kind === 'ice' ? 13 : BOLT_INK);
  }

  // Low-tier avatars into the bitmap (T1: attribute clash; T0: mono glyph)
  const overdraw: { e: Ent; sx: number; sy: number }[] = [];
  const direct: { e: Ent; sx: number; sy: number }[] = [];
  for (const e of [g.player, g.rival]) {
    const sx = quantPos(e.x - 8, e.tier) - camX;
    const sy = quantPos(e.y - 8, e.tier) - camY;
    if (sx < -16 || sy < -16 || sx > SCR_W || sy > SCR_H) continue;
    if (invisible(g, e)) continue;
    if (e.tier >= 3) { direct.push({ e, sx: Math.round(e.x) - 8, sy: Math.round(e.y) - 8 }); continue; }
    if (e.tier === 2) { overdraw.push({ e, sx, sy: sy - entBob(e) }); continue; }
    stampMask16(sx, sy, wizMask(e.facing, e.tier === 0 ? 0 : entFrame(e)));
    if (envTier >= 1) {
      if (frozen(e)) {
        overrideInk(sx, sy, 16, 16, 13);   // solid ice-cyan
      } else if (e.tier === 0) {
        overrideInk(sx, sy, 16, 16, 7);
      } else {
        // Two-colour Spectrum sprite: body cells first, head cells win the overlap.
        const [headInk, bodyInk] = e.rival ? RIVAL_INKS : PLAYER_INKS;
        overrideInk(sx, sy + 8, 16, 8, bodyInk);
        overrideInk(sx, sy, 16, 8, headInk);
      }
    }
  }

  // Colorize
  if (!img) {
    img = c.createImageData(SCR_W, SCR_H);
    px32 = new Uint32Array(img.data.buffer);
  }
  const p32 = px32!;
  if (envTier === 0) {
    // Downsample to chunky 4x4 blocks: 64x44 effective monochrome.
    for (let byi = 0; byi < SCR_H / 4; byi++) {
      for (let bxi = 0; bxi < SCR_W / 4; bxi++) {
        let n = 0;
        for (let y = 0; y < 4; y++) {
          const row = (byi * 4 + y) * SCR_W + bxi * 4;
          for (let x = 0; x < 4; x++) if (bmp[row + x]) n++;
        }
        // Threshold, not any-bit: sparse grass texture vanishes, solid shapes stay.
        const col = n >= 4 ? WHITE_ABGR : BLACK_ABGR;
        for (let y = 0; y < 4; y++) {
          const row = (byi * 4 + y) * SCR_W + bxi * 4;
          for (let x = 0; x < 4; x++) p32[row + x] = col;
        }
      }
    }
  } else {
    for (let y = 0; y < SCR_H; y++) {
      const cellRow = (y >> 3) * SCR_TW;
      const row = y * SCR_W;
      for (let x = 0; x < SCR_W; x++) {
        const ci = cellRow + (x >> 3);
        p32[row + x] = SPEC_ABGR[bmp[row + x] ? inkA[ci] : papA[ci]];
      }
    }
  }
  c.putImageData(img, 0, 0);

  // T2 avatars: sprite hardware escape from the grid — own colours, no clash.
  for (const o of overdraw) {
    const [headInk, bodyInk] = o.e.rival ? RIVAL_INKS : PLAYER_INKS;
    drawMaskPixels(c, wizMask(o.e.facing, entFrame(o.e)), o.sx, o.sy,
      r => frozen(o.e) ? SPECTRUM[13] : SPECTRUM[r < 8 ? headInk : bodyInk]);
    if (o.e.channel > 0) drawChannelBar(c, o.e, o.sx, o.sy, SPECTRUM[headInk]);
  }
  // High-tier avatars: full colour intruders in your 8-bit world.
  for (const d of direct) drawAvatarDirect(c, d.e, d.sx - camX, d.sy - camY);
  // Low-tier avatars' channel bars
  for (const e of [g.player, g.rival]) {
    if (e.tier <= 1 && e.channel > 0 && !invisible(g, e)) {
      drawChannelBar(c, e, quantPos(e.x - 8, e.tier) - camX, quantPos(e.y - 8, e.tier) - camY,
        envTier === 0 ? '#ffffff' : SPECTRUM[15]);
    }
  }

  // High-tier bolts
  for (const b of g.bolts) {
    if (b.tier <= 2) continue;
    drawBoltDirect(c, g, b.x - camX, b.y - camY, b.tier, b.kind === 'ice');
  }

  drawFx(c, g, envTier, camX, camY);
}

// ---------- direct pipeline (env tier 3-5) ----------

function drawTileDirect(
  c: CanvasRenderingContext2D, th: Theme, t: number, x: number, y: number,
  tier: number, time: number, wtx: number, wty: number,
): void {
  c.fillStyle = th.grass;
  c.fillRect(x, y, 8, 8);
  if ((wtx * 7 + wty * 13) % 5 === 0) {
    c.fillStyle = th.grass2;
    c.fillRect(x + ((wtx * 3) % 6), y + ((wty * 5) % 6), 2, 1);
  }
  switch (t) {
    case Tl.PATH:
      c.fillStyle = th.path; c.fillRect(x, y, 8, 8);
      c.fillStyle = th.path2; c.fillRect(x + ((wtx * 5 + wty) % 6), y + ((wty * 3 + wtx) % 6), 1, 1);
      break;
    case Tl.TREE: {
      const sway = tier >= 5 ? Math.sin(time * 1.5 + wtx * 0.9) * 0.7 : 0;
      c.fillStyle = th.trunk; c.fillRect(x + 3, y + 5, 2, 3);
      c.fillStyle = th.tree1;
      c.beginPath(); c.arc(x + 4 + sway, y + 3, 3.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = th.tree2;
      c.beginPath(); c.arc(x + 3 + sway, y + 2, 2.2, 0, Math.PI * 2); c.fill();
      if (tier >= 4) {
        c.fillStyle = th.tree3;
        c.beginPath(); c.arc(x + 2.6 + sway, y + 1.6, 1.1, 0, Math.PI * 2); c.fill();
      }
      break;
    }
    case Tl.WATER: {
      c.fillStyle = th.water; c.fillRect(x, y, 8, 8);
      const ph = tier >= 4 ? Math.floor(time * 3 + wtx) % 3 : (wtx + wty) % 3;
      c.fillStyle = th.water2;
      c.fillRect(x + ph, y + 2, 4, 1);
      c.fillRect(x + 3 - ph, y + 6, 3, 1);
      if (tier >= 5) { c.fillStyle = th.water3; c.fillRect(x + ph * 2, y + 4, 2, 1); }
      break;
    }
    case Tl.REED: {
      c.fillStyle = th.reed;
      const sw = tier >= 5 ? Math.round(Math.sin(time * 2 + wtx)) : 0;
      c.fillRect(x + 1 + sw, y + 2, 1, 5);
      c.fillRect(x + 4, y + 1, 1, 6);
      c.fillRect(x + 6 + sw, y + 3, 1, 4);
      break;
    }
    case Tl.WALL:
    case Tl.HUT: {
      const base = t === Tl.WALL ? th.wall : th.hut;
      const dark = t === Tl.WALL ? th.wallDark : th.hutDark;
      c.fillStyle = base; c.fillRect(x, y, 8, 8);
      c.fillStyle = dark;
      c.fillRect(x, y + 3, 8, 1); c.fillRect(x, y + 7, 8, 1);
      c.fillRect(x + (wty % 2 ? 2 : 5), y, 1, 3);
      c.fillRect(x + (wty % 2 ? 6 : 1), y + 4, 1, 3);
      if (tier >= 4) { c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(x, y, 8, 1); }
      break;
    }
    case Tl.ROCK:
      c.fillStyle = th.rock;
      c.beginPath(); c.ellipse(x + 4, y + 4.5, 3.4, 2.6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = th.rockHi; c.fillRect(x + 2, y + 3, 2, 1);
      break;
    case Tl.STONE:
      if (tier >= 4) {
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.beginPath(); c.ellipse(x + 4, y + 7.5, 3.4, 1.2, 0, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = th.stone; c.fillRect(x + 2, y, 4, 8);
      c.fillStyle = th.stoneHi; c.fillRect(x + 2, y, 1, 8);
      break;
    case Tl.ALTAR: {
      c.fillStyle = th.altarPad; c.fillRect(x, y, 8, 8);
      const a = tier >= 5 ? 0.55 + Math.sin(time * 3) * 0.35 : 0.7;
      c.globalAlpha = a;
      c.strokeStyle = th.altarGlow;
      c.strokeRect(x + 1.5, y + 1.5, 5, 5);
      c.globalAlpha = 1;
      break;
    }
    case Tl.SHRINE:
      c.fillStyle = th.stone; c.fillRect(x + 2, y + 3, 4, 4);
      c.fillStyle = th.shrineGlow; c.fillRect(x + 3, y + 1, 2, 2);
      break;
    case Tl.WELL:
      c.fillStyle = th.stone;
      c.beginPath(); c.arc(x + 4, y + 4, 3.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = tier === 3 ? C64.black : '#10141c';
      c.beginPath(); c.arc(x + 4, y + 4, 1.8, 0, Math.PI * 2); c.fill();
      break;
    case Tl.BERRY:
      c.fillStyle = th.tree2;
      c.beginPath(); c.arc(x + 4, y + 4.5, 3, 0, Math.PI * 2); c.fill();
      c.fillStyle = th.tree3;
      c.beginPath(); c.arc(x + 3, y + 3.5, 1.6, 0, Math.PI * 2); c.fill();
      break;
    case Tl.DIRT:
      c.fillStyle = tier >= 5 ? '#66522f' : tier >= 4 ? '#5f4c31' : C64.orange;
      c.fillRect(x, y, 8, 8);
      if ((wtx * 11 + wty * 7) % 4 === 0) {
        c.fillStyle = 'rgba(0,0,0,0.2)';
        c.fillRect(x + ((wtx * 3) % 6), y + ((wty * 5) % 6), 2, 1);
      }
      break;
    case Tl.PBASE:
    case Tl.RBASE:
      c.strokeStyle = t === Tl.PBASE ? th.altarGlow : tier === 3 ? C64.lightRed : '#f06078';
      c.globalAlpha = 0.8;
      c.beginPath(); c.arc(x + 4, y + 4, 3, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
      break;
    case Tl.PUSH: {
      // The pushstone: a faceted boulder in a colour no other stone wears.
      if (tier >= 4) {
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.beginPath(); c.ellipse(x + 4, y + 7, 3.4, 1.1, 0, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = tier === 3 ? C64.cyan : '#3e9a94';
      c.beginPath(); c.ellipse(x + 4, y + 4, 3.6, 3.2, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = tier === 3 ? C64.white : '#8fe0d8';
      c.fillRect(x + 2, y + 2, 2, 1);
      c.fillStyle = tier === 3 ? C64.blue : '#1e5a58';
      c.fillRect(x + 3, y + 5, 3, 1);   // the score-line across the facet
      break;
    }
    case Tl.RUIN: {
      // Broken masonry: irregular courses with missing chunks.
      c.fillStyle = th.wallDark;
      if ((wtx + wty * 3) % 3 !== 0) c.fillRect(x, y + 1, 7, 3);
      if ((wtx * 5 + wty) % 4 !== 0) c.fillRect(x + 1, y + 5, 6, 2);
      c.fillStyle = th.wall;
      c.fillRect(x + ((wtx * 3) % 3), y + 1, 3, 2);
      if ((wtx + wty) % 2 === 0) c.fillRect(x + 4, y + 5, 3, 1);
      if (tier >= 4) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x, y + 7, 8, 1); }
      break;
    }
  }
}

function drawShardDirect(c: CanvasRenderingContext2D, th: Theme, x: number, y: number, tier: number, time: number): void {
  const bob = Math.sin(time * 3 + x * 0.1) * 1.4;
  const sy = y + bob;
  if (tier <= 4) {
    // 3.5" floppy
    c.fillStyle = tier === 3 ? C64.blue : '#20266a'; c.fillRect(x - 4, sy - 4, 8, 8);
    c.fillStyle = tier === 3 ? C64.lightGrey : '#b8bcd0'; c.fillRect(x - 1, sy - 4, 4, 3);   // shutter
    c.fillStyle = tier === 3 ? C64.white : '#e8e8f0'; c.fillRect(x - 3, sy, 6, 3);           // label
  } else {
    // CD
    c.fillStyle = '#d4d8e8';
    c.beginPath(); c.arc(x, sy, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#8ce0f0'; c.fillRect(x - 3, sy - 2, 2, 1);
    c.fillStyle = '#f0b0e0'; c.fillRect(x + 1, sy + 1, 2, 1);
    c.fillStyle = '#10141c';
    c.beginPath(); c.arc(x, sy, 1.2, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 0.45 + Math.sin(time * 4) * 0.2;
  c.fillStyle = th.shrineGlow;
  c.fillRect(x - 1, sy - 6, 2, 1);
  c.globalAlpha = 1;
}

function drawBoltDirect(
  c: CanvasRenderingContext2D, g: Game, x: number, y: number, tier: number, ice: boolean,
): void {
  c.fillStyle = ice
    ? (tier === 3 ? C64.cyan : '#9ce8ff')
    : tier >= 5 ? '#ffd24a' : tier === 3 ? C64.yellow : '#ffe860';
  c.beginPath(); c.arc(x, y, 2.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff';
  c.fillRect(x - 1, y - 1, 2, 2);
  if (tier >= 4) {
    c.globalAlpha = 0.4;
    c.fillStyle = ice ? '#58b8e0' : '#f0a840';
    c.fillRect(x - 4 + Math.sin(g.time * 30) * 2, y - 1, 3, 2);
    c.globalAlpha = 1;
  }
}

function directRender(c: CanvasRenderingContext2D, g: Game, envTier: number): void {
  const th = THEME[envTier];
  const w = g.world;
  const camX = g.camX, camY = g.camY;
  const tx0 = Math.floor(camX / TILE), ty0 = Math.floor(camY / TILE);
  const xoff = -(camX - tx0 * TILE), yoff = -(camY - ty0 * TILE);

  for (let cy = 0; cy <= SCR_TH; cy++) {
    for (let cx = 0; cx <= SCR_TW; cx++) {
      const tx = tx0 + cx, ty = ty0 + cy;
      drawTileDirect(c, th, tileAt(w, tx, ty), Math.round(cx * TILE + xoff), Math.round(cy * TILE + yoff), envTier, g.time, tx, ty);
    }
  }

  for (const s of g.shards) {
    const sx = s.x - camX, sy = s.y - camY;
    if (sx < -10 || sy < -10 || sx > SCR_W + 10 || sy > SCR_H + 10) continue;
    drawShardDirect(c, th, sx, sy, envTier, g.time);
  }

  // Berries in fruit
  g.world.berrySpots.forEach((b, i) => {
    if (g.berryCd[i] > 0) return;
    const bx = b.x * TILE - camX, by = b.y * TILE - camY;
    if (bx < -8 || by < -8 || bx > SCR_W || by > SCR_H) return;
    c.fillStyle = envTier === 3 ? C64.lightRed : '#e03040';
    c.fillRect(bx + 2, by + 2, 2, 2);
    c.fillRect(bx + 5, by + 3, 2, 2);
    c.fillRect(bx + 3, by + 5, 2, 2);
    c.fillStyle = envTier === 3 ? C64.white : '#ffb0b8';
    c.fillRect(bx + 2, by + 2, 1, 1);
  });

  // Wand-swap stations
  for (const [st, owner] of [[{x: g.world.pStationX, y: g.world.pStationY}, g.player], [{x: g.world.rStationX, y: g.world.rStationY}, g.rival]] as const) {
    const sx = Math.round(st.x) - 4 - camX, sy = Math.round(st.y) - 4 - camY;
    if (sx < -14 || sy < -14 || sx > SCR_W || sy > SCR_H) continue;
    const icePickup = owner.wand === 'fire';
    c.fillStyle = th.stone;
    c.fillRect(sx + 1, sy + 4, 6, 4);
    drawPat(c, icePickup ? WAND_ICE : WAND_FIRE, sx, sy - 5,
      icePickup ? (envTier === 3 ? C64.cyan : '#8ce0ff') : (envTier === 3 ? C64.lightRed : '#ff7040'));
  }

  for (const e of [g.player, g.rival]) {
    if (invisible(g, e)) continue;
    if (e.tier <= 2) {
      const sx = quantPos(e.x - 8, e.tier) - camX;
      const sy = quantPos(e.y - 8, e.tier) - camY;
      if (sx > -18 && sy > -18 && sx < SCR_W + 2 && sy < SCR_H + 2) drawAvatarBlocky(c, e, sx, Math.round(sy));
    } else {
      const sx = Math.round(e.x - 8 - camX), sy = Math.round(e.y - 8 - camY);
      if (sx > -18 && sy > -18 && sx < SCR_W + 2 && sy < SCR_H + 2) drawAvatarDirect(c, e, sx, sy);
    }
  }

  for (const b of g.bolts) {
    const bx = b.x - camX, by = b.y - camY;
    if (bx < -6 || by < -6 || bx > SCR_W + 6 || by > SCR_H + 6) continue;
    if (b.tier <= 2) {
      c.fillStyle = Math.floor(g.time * 14) % 2 ? '#ffe000' : '#ffffff';
      const qx = Math.floor(bx / 4) * 4, qy = Math.floor(by / 4) * 4;
      c.fillRect(qx - 2, qy - 2, 5, 5);
    } else {
      drawBoltDirect(c, g, bx, by, b.tier, b.kind === 'ice');
    }
  }

  drawFx(c, g, envTier, camX, camY);

  // Drifting cloud shadows: the "lush 16-bit" ambient layer (soft-edged).
  if (envTier >= 4) {
    for (let i = 0; i < 2; i++) {
      const cxp = ((g.time * (7 + i * 4) + i * 700) % (SCR_W + 260)) - 130;
      const cyp = 40 + i * 70;
      const grad = c.createRadialGradient(cxp, cyp, 8, cxp, cyp, 80);
      const a = envTier >= 5 ? 0.1 : 0.06;
      grad.addColorStop(0, `rgba(0,0,32,${a})`);
      grad.addColorStop(1, 'rgba(0,0,32,0)');
      c.fillStyle = grad;
      c.fillRect(cxp - 80, cyp - 80, 160, 160);
    }
  }
}

// ---------- FX ----------

function drawFx(c: CanvasRenderingContext2D, g: Game, envTier: number, camX: number, camY: number): void {
  const th = THEME[Math.max(3, envTier)];
  for (const f of g.fx) {
    const t = g.time - f.t0;
    const fx = f.x - camX, fy = f.y - camY;
    if (fx < -60 || fy < -60 || fx > SCR_W + 60 || fy > SCR_H + 60) continue;
    if (f.kind === 0) {
      for (let i = 0; i < 26; i++) {
        const a = hash(i, 1) * Math.PI * 2;
        const sp = 14 + hash(i, 2) * 30;
        c.fillStyle = envTier <= 2
          ? (i % 2 ? '#ffffff' : SPECTRUM[13])
          : (i % 3 === 0 ? th.shrineGlow : i % 3 === 1 ? '#ffffff' : th.altarGlow);
        c.fillRect(fx + Math.cos(a) * sp * t, fy + Math.sin(a) * sp * t, 2, 2);
      }
    } else if (f.kind === 1) {
      for (let i = 0; i < 6; i++) {
        c.fillStyle = envTier <= 2 ? '#ffffff' : th.shrineGlow;
        c.fillRect(fx - 6 + i * 2.4, fy - t * (10 + i * 6), 1, 1);
      }
    } else {
      c.strokeStyle = envTier <= 2 ? '#ffffff' : th.altarGlow;
      c.globalAlpha = Math.max(0, 1 - t);
      c.beginPath(); c.arc(fx, fy, t * 46, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }
  }
}

// ---------- HUD & messages ----------

function hudColors(envTier: number): { bg: string; fg: string; acc: string; hp: string } {
  if (envTier === 0) return { bg: '#000000', fg: '#ffffff', acc: '#ffffff', hp: '#ffffff' };
  if (envTier <= 2) return { bg: '#000000', fg: SPECTRUM[15], acc: SPECTRUM[14], hp: SPECTRUM[10] };
  const th = THEME[envTier];
  return { bg: th.hudBg, fg: th.hudFg, acc: th.hudAccent, hp: envTier === 3 ? C64.lightRed : '#f05060' };
}

function drawHUD(c: CanvasRenderingContext2D, g: Game): void {
  const envTier = g.player.tier;
  const col = hudColors(envTier);
  c.fillStyle = col.bg;
  c.fillRect(0, SCR_H, CANVAS_W, CANVAS_H - SCR_H);
  const p = g.player, r = g.rival;
  drawText(c, `YOU T${p.tier} ${TIERS[p.tier].name}`, 2, SCR_H + 2, col.fg);
  drawText(c, '♥'.repeat(p.hp), 122, SCR_H + 2, col.hp);
  drawText(c, '◆'.repeat(p.shards), 140, SCR_H + 2, col.acc);
  drawPat(c, p.wand === 'ice' ? WAND_ICE : WAND_FIRE, 156, SCR_H + 1,
    p.wand === 'ice' ? (envTier === 3 ? C64.cyan : '#8ce0ff') : (envTier === 3 ? C64.lightRed : '#ff7040'));
  drawText(c, `KERNAGH T${r.tier} ${TIERS[r.tier].name}`, 2, SCR_H + 9, col.fg);
  drawText(c, '♥'.repeat(r.hp), 122, SCR_H + 9, col.hp);
  drawText(c, '◆'.repeat(r.shards), 140, SCR_H + 9, col.acc);
  const mins = Math.floor(g.time / 60), secs = Math.floor(g.time % 60);
  drawText(c, `${mins}:${secs < 10 ? '0' : ''}${secs}`, 236, SCR_H + 2, col.fg);

  // Minimap: 6x4 screen grid. Village green, Standing Stones cyan, keep red,
  // your current screen blinks white.
  const cur = screenOf(g.player.x, g.player.y);
  const stonesScr = screenOf(g.world.altarX, g.world.altarY);
  const mono = envTier === 0;
  const MM_X = 196, MM_Y = SCR_H + 3;
  c.fillStyle = '#000000';
  c.fillRect(MM_X - 1, MM_Y - 1, 6 * 5 + 1, 4 * 3 + 1);
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 6; sx++) {
      const c64 = envTier === 3;
      let cc = mono ? '#3c3c3c' : c64 ? C64.darkGrey : '#303030';
      if (sx === g.world.pSafe.x && sy === g.world.pSafe.y) cc = mono ? '#909090' : c64 ? C64.green : SPECTRUM[4];      // village
      if (sx === g.world.rSafe.x && sy === g.world.rSafe.y) cc = mono ? '#909090' : c64 ? C64.lightRed : SPECTRUM[10];  // keep
      if (sx === stonesScr.x && sy === stonesScr.y) cc = mono ? '#c0c0c0' : c64 ? C64.cyan : SPECTRUM[13];              // stones
      if (sx === cur.x && sy === cur.y && Math.floor(g.time * 4) % 2 === 0) cc = '#ffffff';
      c.fillStyle = cc;
      c.fillRect(MM_X + sx * 5, MM_Y + sy * 3, 4, 2);
    }
  }

  if (g.time < g.msgUntil && g.msg) {
    const wpx = textWidth(g.msg);
    const x = Math.floor((CANVAS_W - wpx) / 2);
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.fillRect(x - 3, 2, wpx + 6, 9);
    drawText(c, g.msg, x, 4, envTier === 0 ? '#ffffff' : col.acc);
  }

  // Quit confirm: armed by ESC during play.
  if (g.time < g.escArmUntil) {
    const qt = 'ESC AGAIN - TITLE SCREEN';
    const wpx = textWidth(qt);
    const x = Math.floor((CANVAS_W - wpx) / 2);
    c.fillStyle = 'rgba(0,0,0,0.85)';
    c.fillRect(x - 4, 13, wpx + 8, 10);
    drawText(c, qt, x, 15, envTier === 0 ? '#ffffff' : col.hp);
  }
}

// ---------- title & end screens ----------

function borderStripes(c: CanvasRenderingContext2D, time: number): void {
  for (let y = 0; y < CANVAS_H; y += 4) {
    const col = SPECTRUM[[2, 6, 4, 5, 1, 3][Math.floor(y / 4 + time * 24) % 6] + 8];
    c.fillStyle = col;
    c.fillRect(0, y, 6, 4);
    c.fillRect(CANVAS_W - 6, y, 6, 4);
  }
}

// Simulated tape load: pilot-tone bars, then fast data stripes, in the border
// around a pale "Program: upgrade" screen.
function renderLoading(c: CanvasRenderingContext2D, g: Game, time: number): void {
  const pilot = g.loadT < 1.2;
  for (let y = 0; y < CANVAS_H; y += 2) {
    let col: string;
    if (pilot) {
      col = SPECTRUM[Math.floor(y / 6 + time * 16) % 2 ? 13 : 10]; // cyan/red pilot
    } else {
      const h = hash(Math.floor(y / 2) + Math.floor(time * 40) * 97, 5);
      col = SPECTRUM[h > 0.5 ? 9 : 14]; // blue/yellow data bursts
    }
    c.fillStyle = col;
    c.fillRect(0, y, CANVAS_W, 2);
  }
  const B = 16;
  c.fillStyle = SPECTRUM[7];
  c.fillRect(B, B, CANVAS_W - 2 * B, CANVAS_H - 2 * B);
  drawText(c, 'PROGRAM: UPGRADE', B + 4, B + 6, '#000000');
  if (!pilot) {
    drawText(c, 'BYTES: UPGRADE', B + 4, B + 16, '#000000');
    const w = Math.floor(((g.loadT - 1.2) / 1.8) * (CANVAS_W - 2 * B - 8));
    c.fillStyle = '#000000';
    c.fillRect(B + 4, CANVAS_H - B - 12, w, 4);
  }
}

// Guide screen: alternates with the title every 6 seconds.
function renderGuide(c: CanvasRenderingContext2D, time: number): void {
  c.fillStyle = '#000000';
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  borderStripes(c, time);
  drawText(c, 'HOW TO PLAY', Math.floor((CANVAS_W - textWidth('HOW TO PLAY', 2)) / 2), 14, SPECTRUM[15], 2);
  const rows: [() => void, string, string][] = [
    [() => drawPat(c, SHARD_TAPE, 40, 0, SPECTRUM[13], 2), 'GATHER 3 SHARDS', ''],
    [() => { drawPat(c, PATTERNS[Tl.STONE], 36, 0, SPECTRUM[15], 2); drawPat(c, PATTERNS[Tl.ALTAR], 46, 0, SPECTRUM[13]); },
      'CHANNEL AT THE STONE CIRCLE', 'TO UPGRADE'],
    [() => { drawPat(c, PATTERNS[Tl.BERRY], 40, 0, SPECTRUM[12], 2); drawPat(c, BERRY_DOTS, 44, 4, SPECTRUM[10]); },
      'BERRIES RESTORE ♥', ''],
    [() => { drawPat(c, WAND_FIRE, 34, 0, SPECTRUM[10], 2); drawPat(c, WAND_ICE, 50, 0, SPECTRUM[13]); },
      'SWAP WANDS AT YOUR VILLAGE', 'FIRE HARMS - ICE FREEZES'],
    [() => drawMaskPixels(c, wizMask(0, 0), 40, 0, r => SPECTRUM[r < 8 ? RIVAL_INKS[0] : RIVAL_INKS[1]]),
      'KERNAGH RACES YOU', 'DEFEAT OR AVOID HIM'],
    [() => drawPat(c, PATTERNS[Tl.WATER], 40, 0, SPECTRUM[9], 2), 'CROSS THE RIVER', 'AT THE BRIDGES'],
  ];
  let y = 34;
  for (const [icon, l1, l2] of rows) {
    c.save();
    c.translate(0, y);
    icon();
    c.restore();
    drawText(c, l1, 76, y + (l2 ? 0 : 5), SPECTRUM[15]);
    if (l2) drawText(c, l2, 76, y + 9, SPECTRUM[7]);
    y += 21;
  }
  if (Math.floor(time * 2) % 2 === 0) {
    drawText(c, 'PRESS ENTER', Math.floor((CANVAS_W - textWidth('PRESS ENTER')) / 2), 170, SPECTRUM[14]);
  }
}

// Hall of Signals: the persistent hi-score table, third screen in the cycle.
function renderScoresScreen(c: CanvasRenderingContext2D, time: number): void {
  c.fillStyle = '#000000';
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  borderStripes(c, time);
  drawText(c, 'HALL OF SIGNALS', Math.floor((CANVAS_W - textWidth('HALL OF SIGNALS', 2)) / 2), 14, SPECTRUM[15], 2);
  const filter = activeMapFilter();
  const fLabel = `MAP: ${filter ?? 'ALL'}`;
  drawText(c, fLabel, Math.floor((CANVAS_W - textWidth(fLabel)) / 2), 30, SPECTRUM[13]);
  const scores = filteredScores();
  if (!scores.length) {
    drawText(c, 'NO SIGNALS RECORDED YET',
      Math.floor((CANVAS_W - textWidth('NO SIGNALS RECORDED YET')) / 2), 80, SPECTRUM[7]);
  }
  scores.forEach((s, i) => {
    const col = i === 0 ? SPECTRUM[14] : i < 3 ? SPECTRUM[13] : SPECTRUM[15];
    const rank = `${i + 1}`.padStart(2, ' ');
    const score = `${s.score}`.padStart(5, ' ');
    drawText(c, `${rank}  ${s.name}  ${score}  ${s.map.slice(0, 6)}`, 48, 44 + i * 13, col);
  });
  drawText(c, 'M - FILTER BY MAP', Math.floor((CANVAS_W - textWidth('M - FILTER BY MAP')) / 2), 156, SPECTRUM[7]);
  if (Math.floor(time * 2) % 2 === 0) {
    drawText(c, 'PRESS ENTER', Math.floor((CANVAS_W - textWidth('PRESS ENTER')) / 2), 168, SPECTRUM[14]);
  }
}

// The credit year walks the tier ladder at 1 fps with cycling attributes.
const CREDIT_YEARS = ['1979', '1982', '1986', '1987', '1990', '1995'];
const CREDIT_ATTRS: [number, number][] = [[7, 0], [15, 1], [14, 2], [12, 0], [13, 3], [11, 0]];

function renderTitle(c: CanvasRenderingContext2D, g: Game, time: number): void {
  c.fillStyle = '#000000';
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  borderStripes(c, time);
  if (g.seedEntry !== null) {
    drawText(c, 'UPGRADE', Math.floor((CANVAS_W - textWidth('UPGRADE', 4)) / 2), 30, SPECTRUM[15], 4);
    drawText(c, 'SEEDED CHAOS - ENTER A SEED:',
      Math.floor((CANVAS_W - textWidth('SEEDED CHAOS - ENTER A SEED:')) / 2), 84, SPECTRUM[13]);
    const shown = g.seedEntry + (Math.floor(time * 3) % 2 === 0 && g.seedEntry.length < 6 ? '_' : '');
    drawText(c, shown || '_', Math.floor((CANVAS_W - textWidth(shown || '_', 2)) / 2), 100, SPECTRUM[14], 2);
    drawText(c, 'DIGITS THEN ENTER - ESC CANCELS',
      Math.floor((CANVAS_W - textWidth('DIGITS THEN ENTER - ESC CANCELS')) / 2), 124, SPECTRUM[7]);
    return;
  }
  drawText(c, 'UPGRADE', Math.floor((CANVAS_W - textWidth('UPGRADE', 4)) / 2), 30, SPECTRUM[15], 4);
  const lines: [string, string][] = [
    ['ARROWS MOVE - SPACE FIRE', SPECTRUM[15]],
    ['FIRST TO THE FINAL UPGRADE WINS', SPECTRUM[14]],
  ];
  lines.forEach(([s, colr], i) => {
    drawText(c, s, Math.floor((CANVAS_W - textWidth(s)) / 2), 80 + i * 12, colr);
  });
  if (time < (g.cheatMsgUntil ?? 0)) {
    drawText(c, 'ALL SIGNALS UNLOCKED',
      Math.floor((CANVAS_W - textWidth('ALL SIGNALS UNLOCKED')) / 2), 106, SPECTRUM[Math.floor(time * 6) % 2 ? 13 : 14]);
  }
  if (Math.floor(time * 2) % 2 === 0) {
    drawText(c, 'PRESS ENTER', Math.floor((CANVAS_W - textWidth('PRESS ENTER', 2)) / 2), 118, SPECTRUM[14], 2);
  }
  let crtUnlocked = false;
  try { crtUnlocked = localStorage.getItem('upgrade-crt-unlocked') === '1'; } catch { /* private mode */ }
  const chaosLine = 'C FOR CHAOS MODE' + (crtUnlocked ? ' - D FOR CRT' : '');
  drawText(c, chaosLine, Math.floor((CANVAS_W - textWidth(chaosLine)) / 2), 134, SPECTRUM[11]);
  let hardUnlocked = false;
  try { hardUnlocked = localStorage.getItem('upgrade-hard-unlocked') === '1'; } catch { /* private mode */ }
  if (hardUnlocked) {
    drawText(c, 'H FOR HARD - S FOR SEEDED CHAOS',
      Math.floor((CANVAS_W - textWidth('H FOR HARD - S FOR SEEDED CHAOS')) / 2), 143, SPECTRUM[10]);
  }
  const step = Math.floor(time) % CREDIT_YEARS.length;
  const credit = `JON FABLETON (C) ${CREDIT_YEARS[step]}`;
  const [ink, paper] = CREDIT_ATTRS[step];
  const cw = textWidth(credit);
  const cx = Math.floor((CANVAS_W - cw) / 2);
  c.fillStyle = SPECTRUM[paper];
  c.fillRect(cx - 4, 152, cw + 8, 11);
  drawText(c, credit, cx, 155, SPECTRUM[ink]);
}

// End-screen prompts: score, hi-score initials entry, and the easy-mode loop
// offer (face the true Kernagh, or rest on your laurels).
function drawEndOptions(
  c: CanvasRenderingContext2D, g: Game, time: number, acc: string, fg: string, y: number,
): void {
  const sc = `SCORE ${g.score}` + (g.chaosSeed != null ? ` - SEED ${g.chaosSeed}` : '');
  drawText(c, sc, Math.floor((CANVAS_W - textWidth(sc)) / 2), y - 12, acc);
  if (g.entryActive) {
    drawText(c, 'A NEW SIGNAL FOR THE HALL - YOUR NAME:',
      Math.floor((CANVAS_W - textWidth('A NEW SIGNAL FOR THE HALL - YOUR NAME:')) / 2), y + 4, fg);
    const shown = (g.entryName + (Math.floor(time * 3) % 2 === 0 && g.entryName.length < 3 ? '_' : ''))
      .padEnd(3, ' ');
    drawText(c, shown.split('').join(' '), Math.floor((CANVAS_W - textWidth('A A A', 2)) / 2), y + 16, acc, 2);
    drawText(c, 'A-Z THEN ENTER - ESC SKIPS', Math.floor((CANVAS_W - textWidth('A-Z THEN ENTER - ESC SKIPS')) / 2), y + 32, fg);
    return;
  }
  if (g.mode === 'win' && g.difficulty === 'easy') {
    drawText(c, 'BUT THIS WAS THE EASY SIGNAL...',
      Math.floor((CANVAS_W - textWidth('BUT THIS WAS THE EASY SIGNAL...')) / 2), y, fg);
    if (Math.floor(time * 2) % 2 === 0) {
      drawText(c, 'ENTER - FACE THE TRUE KERNAGH',
        Math.floor((CANVAS_W - textWidth('ENTER - FACE THE TRUE KERNAGH')) / 2), y + 14, acc);
    }
    drawText(c, 'SPACE - REST ON YOUR LAURELS',
      Math.floor((CANVAS_W - textWidth('SPACE - REST ON YOUR LAURELS')) / 2), y + 26, fg);
    drawText(c, 'ESC - TITLE SCREEN',
      Math.floor((CANVAS_W - textWidth('ESC - TITLE SCREEN')) / 2), y + 38, fg);
  } else if (g.mode === 'win' && g.difficulty === 'hard') {
    // The hard-mode reward: full transcendence earns the epigraph, a partial
    // (elimination) win just the unlock line. Either way the flag is set.
    let yy = y;
    if (g.winWhy !== 'elimination') {
      drawText(c, 'YOU HAVE ASCENDED IN HARD MODE',
        Math.floor((CANVAS_W - textWidth('YOU HAVE ASCENDED IN HARD MODE')) / 2), yy, fg);
      yy += 10;
      drawText(c, 'THE ONLY WAY UP IS BACK DOWN',
        Math.floor((CANVAS_W - textWidth('THE ONLY WAY UP IS BACK DOWN')) / 2), yy, fg);
      yy += 10;
    }
    drawText(c, '(CRT MODE UNLOCKED - PRESS D)',
      Math.floor((CANVAS_W - textWidth('(CRT MODE UNLOCKED - PRESS D)')) / 2), yy, acc);
    yy += 12;
    if (Math.floor(time * 2) % 2 === 0) {
      drawText(c, 'ENTER TO PLAY AGAIN',
        Math.floor((CANVAS_W - textWidth('ENTER TO PLAY AGAIN')) / 2), yy, acc);
    }
    yy += 12;
    drawText(c, 'ESC - TITLE SCREEN',
      Math.floor((CANVAS_W - textWidth('ESC - TITLE SCREEN')) / 2), yy, fg);
  } else {
    if (Math.floor(time * 2) % 2 === 0) {
      drawText(c, 'ENTER TO PLAY AGAIN', Math.floor((CANVAS_W - textWidth('ENTER TO PLAY AGAIN')) / 2), y + 8, acc);
    }
    drawText(c, 'ESC - TITLE SCREEN',
      Math.floor((CANVAS_W - textWidth('ESC - TITLE SCREEN')) / 2), y + 20, fg);
  }
}

function renderEnd(c: CanvasRenderingContext2D, g: Game, win: boolean, time: number): void {
  if (win && g.winWhy === 'elimination') {
    // Partial victory: Kernagh is gone, but the screen only celebrates at the
    // fidelity you actually reached.
    const t = g.winTier;
    const fg = t === 0 ? '#ffffff' : t <= 2 ? SPECTRUM[15] : THEME[t].hudFg;
    const acc = t === 0 ? '#ffffff' : t <= 2 ? SPECTRUM[14] : THEME[t].hudAccent;
    c.fillStyle = t >= 3 ? THEME[t].hudBg : '#000000';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (t <= 2) {
      for (let i = 0; i < 12; i++) {
        if (hash(i, 6) > 0.4) {
          c.fillStyle = t === 0 ? '#ffffff' : SPECTRUM[8 + Math.floor(hash(i, 7) * 7)];
          c.fillRect(Math.floor(hash(i, 1) * 62) * 4, Math.floor(hash(i, 2) * 46) * 4, 4, 4);
        }
      }
    }
    drawText(c, 'KERNAGH IS NO MORE', Math.floor((CANVAS_W - textWidth('KERNAGH IS NO MORE', 2)) / 2), 38, fg, 2);
    drawText(c, 'A PARTIAL VICTORY - THE VALLEY FALLS SILENT',
      Math.floor((CANVAS_W - textWidth('A PARTIAL VICTORY - THE VALLEY FALLS SILENT')) / 2), 64, acc);
    const at = `YOU REMAIN AT T${t} ${TIERS[t].name}`;
    drawText(c, at, Math.floor((CANVAS_W - textWidth(at)) / 2), 78, fg);
    const mins = Math.floor(g.endTime / 60), secs = Math.floor(g.endTime % 60);
    drawText(c, `TIME ${mins}:${secs < 10 ? '0' : ''}${secs}`,
      Math.floor((CANVAS_W - textWidth('TIME 0:00')) / 2), 100, fg);
    drawEndOptions(c, g, time, acc, fg, 122);
    return;
  }
  if (win) {
    const th = THEME[5];
    c.fillStyle = th.hudBg;
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = i % 2 ? th.altarGlow : th.shrineGlow;
      c.globalAlpha = 0.3 + hash(i, 3) * 0.5;
      c.fillRect(hash(i, 1) * CANVAS_W, (hash(i, 2) * CANVAS_H + time * (4 + i % 5)) % CANVAS_H, 2, 2);
    }
    c.globalAlpha = 1;
    drawText(c, 'TRANSCENDENCE', Math.floor((CANVAS_W - textWidth('TRANSCENDENCE', 3)) / 2), 34, th.hudFg, 3);
    drawText(c, 'THE FINAL UPGRADE - BEYOND 1995 ITSELF',
      Math.floor((CANVAS_W - textWidth('THE FINAL UPGRADE - BEYOND 1995 ITSELF')) / 2), 64, th.hudAccent);
    drawText(c, 'KERNAGH REMAINS IN THE OLD SIGNAL',
      Math.floor((CANVAS_W - textWidth('KERNAGH REMAINS IN THE OLD SIGNAL')) / 2), 78, th.hudFg);
  } else {
    c.fillStyle = '#000000';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // chunky mono blocks: you are stuck in 1979
    for (let i = 0; i < 20; i++) {
      c.fillStyle = '#ffffff';
      if (hash(i, 4) > 0.5) c.fillRect(Math.floor(hash(i, 1) * 62) * 4, Math.floor(hash(i, 2) * 46) * 4, 4, 4);
    }
    const big = g.loseWhy === 'derez' ? 'SIGNAL LOST' : 'KERNAGH ASCENDS';
    // The race loss reports where YOU actually got to, not a fixed 1979 line.
    const sub = g.loseWhy === 'derez'
      ? 'DEREZZED AT THE FLOOR OF HISTORY'
      : `YOU ARE LEFT AT T${g.winTier} ${TIERS[g.winTier].name}`;
    drawText(c, big, Math.floor((CANVAS_W - textWidth(big, 2)) / 2), 40, '#ffffff', 2);
    drawText(c, sub, Math.floor((CANVAS_W - textWidth(sub)) / 2), 70, '#ffffff');
  }
  const mins = Math.floor(g.endTime / 60), secs = Math.floor(g.endTime % 60);
  const t = `TIME ${mins}:${secs < 10 ? '0' : ''}${secs}`;
  drawText(c, t, Math.floor((CANVAS_W - textWidth(t)) / 2), 100, win ? THEME[5].hudFg : '#ffffff');
  drawEndOptions(c, g, time, win ? THEME[5].hudAccent : '#ffffff', win ? THEME[5].hudFg : '#ffffff', 122);
}

// ---------- main entry ----------

export function renderPlay(c: CanvasRenderingContext2D, g: Game, envTier: number): void {
  if (envTier <= 2) attrRender(c, g, envTier);
  else directRender(c, g, envTier);
}

export function render(c: CanvasRenderingContext2D, g: Game, time: number): void {
  if (g.mode === 'loading') { renderLoading(c, g, time); return; }
  if (g.mode === 'title') {
    const phase = Math.floor(time / 6) % 3;
    if (phase === 1) renderGuide(c, time);
    else if (phase === 2) renderScoresScreen(c, time);
    else renderTitle(c, g, time);
    return;
  }
  if (g.mode === 'win') { renderEnd(c, g, true, time); return; }
  if (g.mode === 'lose') { renderEnd(c, g, false, time); return; }

  const rippleT = g.ripple >= 0 ? g.time - g.ripple : 99;
  if (rippleT < 1) {
    if (!offA) {
      offA = document.createElement('canvas'); offA.width = SCR_W; offA.height = SCR_H;
      offB = document.createElement('canvas'); offB.width = SCR_W; offB.height = SCR_H;
    }
    const ca = offA.getContext('2d')!, cb = offB!.getContext('2d')!;
    renderPlay(ca, g, g.rippleFrom);
    renderPlay(cb, g, g.player.tier);
    c.drawImage(offA, 0, 0);
    const sweep = clamp(rippleT * 1.15, 0, 1) * SCR_W;
    c.save();
    c.beginPath();
    c.rect(0, 0, sweep, SCR_H);
    c.clip();
    c.drawImage(offB!, 0, 0);
    c.restore();
    c.fillStyle = '#ffffff';
    c.globalAlpha = 0.8;
    c.fillRect(sweep - 1, 0, 3, SCR_H);
    c.globalAlpha = 1;
  } else {
    renderPlay(c, g, g.player.tier);
  }
  // Pushstone progress: same idiom as the channel bar, drawn over either
  // pipeline above the player's head.
  if (g.push) {
    const sx = Math.round(g.player.x - g.camX) - 8, sy = Math.round(g.player.y - g.camY) - 10;
    const fill = Math.floor(clamp(g.push.t / PUSH_CFG.holdSecs, 0, 1) * 16);
    c.fillStyle = '#000000';
    c.fillRect(sx, sy - 5, 16, 3);
    c.fillStyle = g.player.tier <= 2 ? SPECTRUM[11] : '#8fe0d8';
    c.fillRect(sx + 1, sy - 4, Math.max(1, fill - 2), 1);
  }
  drawHUD(c, g);
}
