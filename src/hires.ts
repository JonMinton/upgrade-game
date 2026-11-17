// The PC pipeline (env tiers 6-7). Both tiers share one set of procedural art,
// painted with canvas vector ops at the tier's native resolution, and differ
// in the "hardware" it is pushed through:
//  - T6 (c.1997, 640x480 SVGA): every sprite is crushed to a 6x6x6 colour cube
//    with ordered dither and 1-bit alpha, water palette-cycles, text is a
//    thresholded GUI face, and the HUD is a Win95 taskbar.
//  - T7 (c.2007, 1280x768 widescreen): the art is left smooth, terrain blends
//    by feathered alpha, and a post chain adds vignette, additive light, bloom
//    and drifting motes. The camera follows instead of flicking.
// Callers hand in a context already scaled by tierScale(tier); everything here
// is drawn in logical (256-wide) units.

import {
  Game, Ent, Tl, SCR_H, THEME, TIERS, WIN_TIER, CHANNEL_TIME, FINAL_CHANNEL_TIME,
  tierScale, clamp, screenOf, WORLD_TW,
} from './defs';
import { tileAt } from './map';
import { drawText, textWidth } from './font';
import { drawLegacyAvatar } from './render';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

function mk(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h));
  return [cv, cv.getContext('2d', { willReadFrequently: true })!];
}

function h2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 974711)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rnd(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

// Value noise that tiles every `period` lattice cells.
function pnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = mod(xi, period), x1 = mod(xi + 1, period);
  const y0 = mod(yi, period), y1 = mod(yi + 1, period);
  const a = h2(x0, y0, seed), b = h2(x1, y0, seed), c = h2(x0, y1, seed), d = h2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// ---------- the T6 treatment: 216 colours, ordered dither, 1-bit alpha ----------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function quantise(cv: HTMLCanvasElement, k: Ctx): void {
  const id = k.getImageData(0, 0, cv.width, cv.height);
  const d = id.data;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const a = d[i + 3];
      d[i + 3] = a < 36 ? 0 : a > 214 ? 255 : a / 255 > th ? 255 : 0;
      for (let ch = 0; ch < 3; ch++) {
        const v = Math.round(d[i + ch] / 51 + (th - 0.5) * 0.85);
        d[i + ch] = clamp(v, 0, 5) * 51;
      }
    }
  }
  k.putImageData(id, 0, 0);
}

// ---------- ground: periodic textures with feathered (or dithered) edges ----------

// Draw priority, low to high: water, ice, earth, path, turf. Each tile's
// sprite overhangs its square by a noisy feathered margin, so higher classes
// creep organically over lower ones.
const G_WATER = 0, G_ICE = 1, G_DIRT = 2, G_PATH = 3, G_GRASS = 4;
const GCLASS = new Uint8Array(32).fill(G_GRASS);
GCLASS[Tl.WATER] = G_WATER; GCLASS[Tl.ICE] = G_ICE; GCLASS[Tl.PATH] = G_PATH;
for (const t of [Tl.DIRT, Tl.WALL, Tl.HUT, Tl.RUIN, Tl.STUMP, Tl.BURN]) GCLASS[t] = G_DIRT;

const groundCache: (HTMLCanvasElement | undefined)[][] = [[], []];

function groundSprite(tier: number, cls: number, vx: number, vy: number, frame: number): HTMLCanvasElement {
  const cache = groundCache[tier - 6];
  const key = ((cls * 4 + frame) * 4 + vy) * 4 + vx;
  const hit = cache[key];
  if (hit) return hit;
  const S = tierScale(tier), P = 8 * S, M = P / 4, size = P + 2 * M;
  const [cv, k] = mk(size, size);
  const id = k.createImageData(size, size);
  const d = id.data;
  const th = THEME[tier];
  const A = rgb(cls === G_GRASS ? th.grass2 : cls === G_PATH ? th.path2 : cls === G_DIRT ? '#54401f'
    : cls === G_ICE ? '#bcdcf4' : '#143a90');
  const B = rgb(cls === G_GRASS ? th.grass : cls === G_PATH ? th.path : cls === G_DIRT ? '#7c6238'
    : cls === G_ICE ? '#f0f8ff' : th.water);
  const HI = rgb(th.water2), HI2 = rgb(th.water3);
  const wrap = Math.round(32 * S);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const lx = vx * 8 + (px - M + 0.5) / S, ly = vy * 8 + (py - M + 0.5) / S;
      const n1 = pnoise(lx / 8, ly / 8, 4, 11 + cls);
      const n2 = pnoise(lx / 2, ly / 2, 16, 23 + cls);
      const wn = h2(mod(Math.round(lx * S), wrap), mod(Math.round(ly * S), wrap), 5 + cls);
      let m = clamp(n1 * 0.75 + n2 * 0.5 - 0.12, 0, 1);
      let r = A[0] + (B[0] - A[0]) * m, gg = A[1] + (B[1] - A[1]) * m, b = A[2] + (B[2] - A[2]) * m;
      if (cls === G_WATER) {
        // Light bands that march with the frame: palette cycling at T6, and
        // the base the T7 glints ride on.
        const band = Math.sin(lx * 0.8 + ly * 0.45 + n1 * 5 + frame * Math.PI / 2);
        if (band > 0.97) { r = HI2[0]; gg = HI2[1]; b = HI2[2]; }
        else if (band > 0.82) { r = HI[0]; gg = HI[1]; b = HI[2]; }
      } else if (cls === G_ICE) {
        if (Math.abs(n2 - 0.5) < 0.035) { r = 120; gg = 170; b = 220; }
      } else {
        m = wn > 0.93 ? 1.22 : wn < 0.07 ? 0.78 : 0.96 + wn * 0.08;
        r *= m; gg *= m; b *= m;
      }
      const dd = Math.max(M - px - 0.5, px + 0.5 - (M + P), M - py - 0.5, py + 0.5 - (M + P), 0);
      let a = 1;
      if (dd > 0 && cls !== G_WATER) {
        a = clamp(1 - dd / M + (n2 - 0.5) * 1.3, 0, 1);
        a = a * a * (3 - 2 * a);
      }
      const i = (py * size + px) * 4;
      d[i] = clamp(r, 0, 255); d[i + 1] = clamp(gg, 0, 255); d[i + 2] = clamp(b, 0, 255);
      d[i + 3] = a * 255;
    }
  }
  k.putImageData(id, 0, 0);
  if (tier === 6) quantise(cv, k);
  cache[key] = cv;
  return cv;
}

// ---------- object sprites ----------
// Painted in logical units with the tile at (0,0)-(8,8); the sprite canvas
// spans x -4..12, y -8..10 so canopies, raised walls and shadows can overhang.

const ell = (c: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient): void => {
  c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill();
};
const lg = (c: Ctx, x0: number, y0: number, x1: number, y1: number, a: string, b: string): CanvasGradient => {
  const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g;
};
const rg = (c: Ctx, x: number, y: number, r: number, a: string, b: string): CanvasGradient => {
  const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, a); g.addColorStop(1, b); return g;
};
const shade = (c: Ctx, x: number, y: number, rx: number, ry: number): void =>
  ell(c, x, y, rx, ry, 'rgba(0,0,24,0.30)');
const poly = (c: Ctx, pts: number[], fill: string | CanvasGradient): void => {
  c.fillStyle = fill; c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath(); c.fill();
};

function boulder(c: Ctx, base: string, hi: string, lo: string): void {
  shade(c, 4.8, 6.6, 3.8, 1.5);
  ell(c, 4, 4.6, 3.5, 2.8, lg(c, 1, 2, 7, 7, hi, lo));
  ell(c, 3.2, 3.7, 1.9, 1.3, base);
  ell(c, 2.7, 3.2, 0.9, 0.5, 'rgba(255,255,255,0.35)');
}

function fissure(c: Ctx, pts: number[]): void {
  c.strokeStyle = '#12141c'; c.lineWidth = 0.45; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
}

function menhir(c: Ctx, base: string, hi: string, lo: string): void {
  shade(c, 5.2, 7.5, 3.6, 1.3);
  c.fillStyle = lg(c, 2, 0, 6, 0, hi, lo);
  c.beginPath();
  c.moveTo(2.3, 7.6); c.lineTo(2.1, -1.2); c.quadraticCurveTo(2.6, -3.4, 4.2, -3.5);
  c.quadraticCurveTo(5.8, -3.2, 5.9, -1); c.lineTo(5.8, 7.6); c.closePath(); c.fill();
  c.fillStyle = base; c.fillRect(3, -2.4, 1.6, 9.6);
  c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(2.4, -1.8, 0.5, 8.6);
  ell(c, 4.6, 2.2, 0.6, 0.4, 'rgba(120,150,90,0.5)');
  ell(c, 3.4, 5.2, 0.5, 0.3, 'rgba(120,150,90,0.4)');
}

function block(c: Ctx, v: number, hut: boolean): void {
  const r = rnd(v * 31 + (hut ? 7 : 3));
  // front face (only ever seen on a mass's southern edge)
  c.fillStyle = hut ? lg(c, 0, 5, 0, 8, '#6a4424', '#3e2610') : lg(c, 0, 5, 0, 8, '#787c8a', '#4a4e5c');
  c.fillRect(0, 5, 8, 3);
  c.fillStyle = 'rgba(0,0,0,0.28)';
  if (hut) { for (let x = 1.2; x < 8; x += 1.7) c.fillRect(x, 5, 0.25, 3); }
  else { c.fillRect(0, 6.4, 8, 0.25); c.fillRect(v ? 2 : 5, 5, 0.25, 1.4); c.fillRect(v ? 6 : 1.5, 6.6, 0.25, 1.4); }
  // top face, raised three pixels
  c.fillStyle = hut ? lg(c, 0, -3, 8, 5, '#d8b060', '#a87c34') : lg(c, 0, -3, 8, 5, '#b8bcc8', '#8e92a0');
  c.fillRect(0, -3, 8, 8);
  if (hut) {
    for (let i = 0; i < 22; i++) {
      c.fillStyle = r() > 0.5 ? 'rgba(255,240,180,0.35)' : 'rgba(90,60,10,0.35)';
      c.fillRect(r() * 7.6, -3 + r() * 6.6, 0.3, 0.8 + r() * 1.2);
    }
  } else {
    c.fillStyle = 'rgba(40,44,60,0.4)';
    c.fillRect(0, -0.4, 8, 0.25); c.fillRect(0, 2.3, 8, 0.25);
    c.fillRect(v ? 2.5 : 5.5, -3, 0.25, 2.6); c.fillRect(v ? 5.5 : 2, -0.2, 0.25, 2.5); c.fillRect(v ? 3 : 6, 2.5, 0.25, 2.5);
    for (let i = 0; i < 5; i++) ell(c, r() * 8, -3 + r() * 8, 0.3, 0.2, 'rgba(255,255,255,0.25)');
  }
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 4.7, 8, 0.3);
}

const PAINT: Record<string, (c: Ctx, v: number, f: number, tier: number) => void> = {
  tree(c, v) {
    const r = rnd(v * 77 + 1);
    shade(c, 5.4, 7.3, 4.4, 1.7);
    if (v === 3) {
      c.fillStyle = lg(c, 3.4, 0, 4.8, 0, '#8a5e34', '#4e3218'); c.fillRect(3.5, 5.2, 1.1, 2.6);
      for (let i = 0; i < 3; i++) {
        const yb = 6 - i * 2.7, hw = 3.9 - i * 0.9;
        poly(c, [4, yb - 4.4, 4 - hw, yb, 4 + hw, yb], lg(c, 0, 0, 8, 0, '#2c7440', '#123a24'));
        poly(c, [4, yb - 4.4, 4 - hw, yb, 3.4, yb - 0.3], 'rgba(150,220,150,0.28)');
      }
      return;
    }
    const s = v === 2 ? 0.82 : 1;
    const [dk, md, lt] = v === 1 ? ['#3a601a', '#5c8c26', '#92c44e'] : ['#1b4c1c', '#2f7a28', '#58aa40'];
    c.fillStyle = lg(c, 3.2, 0, 4.9, 0, '#9a6a3a', '#56361a'); c.fillRect(3.3, 4, 1.5, 3.8);
    ell(c, 4.3, 1.9, 4.4 * s, 3.9 * s, dk);
    ell(c, 3.8, 1.2, 3.6 * s, 3.2 * s, md);
    ell(c, 3.1, 0.3, 2.3 * s, 1.9 * s, lt);
    for (let i = 0; i < 18; i++) {
      const a = r() * TAU, q = Math.sqrt(r());
      ell(c, 4.2 + Math.cos(a) * q * 3.6 * s, 1.6 + Math.sin(a) * q * 3.2 * s, 0.4, 0.3,
        r() > 0.5 ? 'rgba(190,240,140,0.4)' : 'rgba(8,40,12,0.4)');
    }
  },
  rock(c, v) {
    boulder(c, '#9a9eac', '#c4c8d6', '#5c6070');
    if (v) ell(c, 6.6, 6.4, 1, 0.7, '#7c8090');
  },
  cleft(c) { boulder(c, '#9a9eac', '#c4c8d6', '#5c6070'); fissure(c, [4.4, 1.9, 3.6, 3.6, 4.5, 4.8, 3.9, 7.2]); },
  stone(c) { menhir(c, '#c6cad8', '#eef0fa', '#7e8296'); },
  crack(c) { menhir(c, '#a0a4b0', '#c0c4d0', '#666a7a'); fissure(c, [4.4, -3.2, 3.5, -0.6, 4.6, 1.8, 3.6, 4.4, 4.3, 7.4]); },
  wall(c, v) { block(c, v, false); },
  hut(c, v) { block(c, v, true); },
  ruin(c, v) {
    const r = rnd(v * 13 + 5);
    for (let i = 0; i < 3; i++) {
      if (r() < 0.25) continue;
      const x = r() * 4.5, y = 1 + i * 2.1 + r() * 0.6, w = 2 + r() * 3, hgt = 1 + r() * 1.3;
      c.fillStyle = '#4c5060'; c.fillRect(x, y + hgt * 0.5, w, hgt * 0.8);
      c.fillStyle = lg(c, x, y, x + w, y + hgt, '#b0b4c2', '#868a9a'); c.fillRect(x, y - 0.9, w, hgt + 0.4);
      c.fillStyle = 'rgba(30,34,50,0.4)'; c.fillRect(x + w * 0.45, y - 0.9, 0.25, hgt + 0.4);
    }
    for (let i = 0; i < 5; i++) ell(c, r() * 8, r() * 8, 0.5, 0.35, r() > 0.5 ? '#9094a4' : '#5c6070');
  },
  well(c) {
    shade(c, 4.8, 6.6, 4, 1.6);
    ell(c, 4, 5.2, 3.8, 2.6, '#5c6070');
    ell(c, 4, 4, 3.8, 2.6, lg(c, 0, 2, 8, 6, '#d0d4e0', '#888c9c'));
    ell(c, 4, 4, 2.5, 1.6, '#0a1430');
    ell(c, 3.2, 3.6, 0.9, 0.35, 'rgba(140,190,255,0.55)');
  },
  shrine(c) {
    shade(c, 4.6, 7.2, 2.8, 1);
    c.fillStyle = lg(c, 2, 0, 6, 0, '#d0d4e0', '#7c8092'); c.fillRect(2.4, 3.4, 3.2, 3.8);
    c.fillStyle = '#e4e6f0'; c.fillRect(1.9, 2.8, 4.2, 0.9);
    c.fillStyle = '#6c7082'; c.fillRect(1.9, 6.6, 4.2, 0.8);
    ell(c, 4, 1.7, 1.1, 1.1, rg(c, 3.7, 1.4, 1.2, '#fff8c8', '#e0a020'));
  },
  berry(c, _v, f) {
    shade(c, 4.6, 7, 3.6, 1.3);
    ell(c, 4, 4.8, 3.5, 2.6, '#1f5a22'); ell(c, 3.3, 4, 2.6, 2, '#348a2c'); ell(c, 2.8, 3.3, 1.4, 1, '#62b648');
    if (f) {
      for (const [x, y] of [[2.6, 3.4], [5.3, 4.2], [3.8, 5.6], [5.6, 6], [1.9, 5.4]]) {
        ell(c, x, y, 0.75, 0.75, '#d81e36'); ell(c, x - 0.2, y - 0.25, 0.25, 0.25, '#ffc0c8');
      }
    }
  },
  reed(c, v, f) {
    const sway = Math.sin(f * Math.PI / 2) * 0.7;
    c.lineCap = 'round';
    for (const [x, h, w] of v ? [[1.6, 6, 0.5], [3.4, 7.4, 0.55], [5.2, 5.6, 0.5], [6.6, 6.8, 0.45]]
      : [[1.2, 6.6, 0.5], [3, 5.8, 0.5], [4.6, 7.6, 0.55], [6.4, 6.2, 0.5]]) {
      c.strokeStyle = '#6aa040'; c.lineWidth = w;
      c.beginPath(); c.moveTo(x, 7.8); c.quadraticCurveTo(x + sway * 0.3, 7.8 - h * 0.5, x + sway, 7.8 - h); c.stroke();
      c.strokeStyle = '#a8dc70'; c.lineWidth = w * 0.4;
      c.beginPath(); c.moveTo(x - 0.1, 7.6); c.quadraticCurveTo(x + sway * 0.3 - 0.1, 7.8 - h * 0.5, x + sway - 0.1, 8 - h); c.stroke();
      ell(c, x + sway, 7.6 - h, 0.45, 0.9, '#7a5230');
    }
  },
  push(c) {
    shade(c, 4.8, 7, 4, 1.5);
    poly(c, [4, 0.4, 7.6, 3, 6.8, 6.8, 1.2, 6.8, 0.4, 3], lg(c, 0, 0, 8, 8, '#8ff0e4', '#1c5c5a'));
    poly(c, [4, 0.4, 7.6, 3, 4.2, 3.6], 'rgba(255,255,255,0.3)');
    poly(c, [0.4, 3, 4.2, 3.6, 1.2, 6.8], 'rgba(0,40,40,0.25)');
    c.strokeStyle = 'rgba(10,50,50,0.6)'; c.lineWidth = 0.3;
    c.beginPath(); c.moveTo(4.2, 3.6); c.lineTo(6.8, 6.8); c.moveTo(4.2, 3.6); c.lineTo(4, 0.4); c.stroke();
  },
  stump(c) {
    ell(c, 4.2, 6.6, 3.6, 1.4, 'rgba(120,112,104,0.55)');
    c.fillStyle = lg(c, 2.6, 0, 5.8, 0, '#3a2c24', '#120c0a');
    c.beginPath(); c.moveTo(2.6, 7); c.lineTo(2.9, 3.6); c.lineTo(3.6, 4.4); c.lineTo(4.1, 2.4); c.lineTo(4.8, 4);
    c.lineTo(5.5, 3); c.lineTo(5.8, 7); c.closePath(); c.fill();
    ell(c, 4.2, 7, 1.7, 0.5, '#0c0808');
  },
  burn(c, _v, f) {
    c.fillStyle = '#3a2412'; c.fillRect(3.3, 4, 1.5, 3.8);
    ell(c, 4.2, 1.8, 4, 3.5, '#2a1a0c'); ell(c, 3.8, 1.3, 2.8, 2.4, '#4a2a10');
    const r = rnd(f + 40);
    for (let i = 0; i < 7; i++) {
      const x = 1.4 + r() * 5.4, y = 3.6 - r() * 3.4, hgt = 2.2 + r() * 2.6, w = 0.8 + r() * 0.8;
      poly(c, [x, y - hgt, x + w, y, x, y + 0.7, x - w, y], '#ff5a1e');
      poly(c, [x, y - hgt * 0.6, x + w * 0.5, y, x, y + 0.4, x - w * 0.5, y], '#ffd040');
    }
    ell(c, 2 + r() * 4, -3 - r() * 2, 0.3, 0.3, '#ffb040');
  },
  altar(c) {
    c.fillStyle = lg(c, 0, 0, 8, 8, '#3a4058', '#1a1e30'); c.fillRect(0.2, 0.2, 7.6, 7.6);
    c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 0.3; c.strokeRect(0.5, 0.5, 7, 7);
    c.strokeStyle = '#58e6f6'; c.lineWidth = 0.5;
    c.beginPath(); c.ellipse(4, 4, 2.6, 2.6, 0, 0, TAU); c.stroke();
    c.lineWidth = 0.3;
    c.beginPath(); c.moveTo(4, 1.8); c.lineTo(5.9, 5.1); c.lineTo(2.1, 5.1); c.closePath(); c.stroke();
  },
  base(c, v) {
    c.strokeStyle = v ? '#ff6a84' : '#5ce8f8'; c.lineWidth = 0.6;
    c.beginPath(); c.ellipse(4, 4.4, 3.3, 2.5, 0, 0, TAU); c.stroke();
    c.lineWidth = 0.3; c.globalAlpha = 0.7;
    c.beginPath(); c.ellipse(4, 4.4, 2, 1.5, 0, 0, TAU); c.stroke();
    c.globalAlpha = 1;
  },
  pedestal(c, v) {
    // v: the wand you'd swap TO (0 fire, 1 ice)
    shade(c, 4.6, 7.4, 3, 1);
    c.fillStyle = lg(c, 1.5, 0, 6.5, 0, '#d0d4e0', '#70748a'); c.fillRect(1.8, 4.2, 4.4, 3.2);
    c.fillStyle = '#e8eaf4'; c.fillRect(1.2, 3.6, 5.6, 0.9);
    ell(c, 4, 0.6, 1.9, 1.9, v ? rg(c, 3.5, 0.1, 2, '#ffffff', '#38a8e8') : rg(c, 3.5, 0.1, 2, '#fff4a0', '#f04818'));
    if (v) {
      c.strokeStyle = '#ffffff'; c.lineWidth = 0.3;
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3;
        c.beginPath(); c.moveTo(4 - Math.cos(a) * 1.2, 0.6 - Math.sin(a) * 1.2);
        c.lineTo(4 + Math.cos(a) * 1.2, 0.6 + Math.sin(a) * 1.2); c.stroke();
      }
    } else {
      poly(c, [4, -0.9, 4.9, 0.9, 4, 1.6, 3.1, 0.9], '#fff0a0');
    }
  },
  shard(c, _v, f, tier) {
    if (tier === 6) {
      // CD-ROM: the sheen swings round with the frame.
      ell(c, 4, 4, 3.5, 3.5, lg(c, 0, 0, 8, 8, '#f4f6ff', '#a0a8c0'));
      const a = f * Math.PI / 4;
      c.lineWidth = 1.5; c.lineCap = 'butt';
      c.strokeStyle = '#ff90e0'; c.beginPath(); c.arc(4, 4, 2.3, a, a + 0.7); c.stroke();
      c.strokeStyle = '#70f0ff'; c.beginPath(); c.arc(4, 4, 2.3, a + Math.PI, a + Math.PI + 0.7); c.stroke();
      c.strokeStyle = '#ffe870'; c.beginPath(); c.arc(4, 4, 2.3, a + 0.7, a + 1.1); c.stroke();
      ell(c, 4, 4, 0.9, 0.9, '#20243a');
    } else {
      // USB stick
      c.save(); c.translate(4, 4); c.rotate(-0.5);
      c.fillStyle = lg(c, -1.6, 0, 1.6, 0, '#e8ecf8', '#8890a8'); c.fillRect(-1.1, -4, 2.2, 2.2);
      c.fillStyle = '#30344a'; c.fillRect(-0.7, -3.5, 0.5, 0.8); c.fillRect(0.2, -3.5, 0.5, 0.8);
      c.fillStyle = lg(c, -1.8, 0, 1.8, 0, '#40c8ff', '#1060c0');
      c.beginPath(); c.roundRect(-1.7, -1.9, 3.4, 5.6, 0.8); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(-1.2, -1.4, 0.6, 4.4);
      ell(c, 0.5, 2.4, 0.45, 0.45, '#b0ffb0');
      c.restore();
    }
  },
};

const objCache = new Map<number, HTMLCanvasElement>();
const OBJ_IDS = Object.keys(PAINT);

function objSprite(tier: number, name: string, v = 0, f = 0): HTMLCanvasElement {
  const key = ((OBJ_IDS.indexOf(name) * 8 + v) * 8 + f) * 2 + (tier - 6);
  let cv = objCache.get(key);
  if (cv) return cv;
  const S = tierScale(tier);
  let k: Ctx;
  [cv, k] = mk(16 * S, 18 * S);
  k.scale(S, S); k.translate(4, 8);
  PAINT[name](k, v, f, tier);
  k.setTransform(1, 0, 0, 1, 0, 0);
  if (tier === 6) quantise(cv, k);
  objCache.set(key, cv);
  return cv;
}

// ---------- the wizard ----------

interface Garb { robe: string; robeHi: string; robeLo: string; hat: string; hatLo: string; trim: string; beard: string }
const GARB_P: Garb = { robe: '#3e5be8', robeHi: '#7c98ff', robeLo: '#1e2f96', hat: '#3148dc', hatLo: '#16227c', trim: '#ffd84a', beard: '#f0f0f8' };
const GARB_R: Garb = { robe: '#c23048', robeHi: '#f4687e', robeLo: '#741226', hat: '#8c1e3c', hatLo: '#4c0c20', trim: '#e8dcc0', beard: '#2c2028' };

// Painted with the origin at the legacy 16x16 sprite's top-left: soles at y≈15.5.
function paintWizard(c: Ctx, rival: boolean, facing: number, ph: number, ice: boolean): void {
  const gb = rival ? GARB_R : GARB_P;
  const sw = Math.sin(ph), bob = Math.abs(sw) * 0.6;
  const side = facing >= 2, dir = facing === 2 ? -1 : 1;
  const staffX = facing === 2 ? 4.2 : facing === 3 ? 11.8 : facing === 1 ? 3.6 : 12.4;
  const staff = (): void => {
    c.strokeStyle = '#7a5230'; c.lineWidth = 0.75; c.lineCap = 'round';
    c.beginPath(); c.moveTo(staffX, 14.8); c.lineTo(staffX + (side ? dir * 0.8 : 0), 2.6 - bob); c.stroke();
    const ox = staffX + (side ? dir * 0.8 : 0), oy = 1.8 - bob;
    ell(c, ox, oy, 1.35, 1.35, ice ? rg(c, ox - 0.3, oy - 0.3, 1.5, '#ffffff', '#30a0e8')
      : rg(c, ox - 0.3, oy - 0.3, 1.5, '#fff6b0', '#f04c18'));
  };
  ell(c, 8.4, 15.4, 5.6, 1.7, 'rgba(0,0,24,0.32)');
  if (facing === 1) staff();
  // boots
  if (side) {
    ell(c, 8 + sw * 1.7, 15 - Math.max(0, sw) * 0.5, 1.7, 0.9, '#2e1c10');
    ell(c, 8 - sw * 1.7, 15 - Math.max(0, -sw) * 0.5, 1.7, 0.9, '#3e2816');
  } else {
    ell(c, 6.5, 15 - Math.max(0, sw) * 0.9, 1.5, 0.9, '#3e2816');
    ell(c, 9.5, 15 - Math.max(0, -sw) * 0.9, 1.5, 0.9, '#3e2816');
  }
  // robe
  const hem = sw * 0.5;
  c.fillStyle = lg(c, 3.5, 0, 12.5, 0, gb.robeHi, gb.robeLo);
  c.beginPath();
  c.moveTo(5.4, 8 - bob); c.lineTo(10.6, 8 - bob);
  c.quadraticCurveTo(11.8, 11, 12.4 + hem, 14.4);
  c.quadraticCurveTo(8, 15.6, 3.6 + hem, 14.4);
  c.quadraticCurveTo(4.2, 11, 5.4, 8 - bob);
  c.fill();
  c.fillStyle = gb.robe;
  c.beginPath(); c.moveTo(6.6, 8 - bob); c.lineTo(9.2, 8 - bob); c.lineTo(9.8 + hem, 14.8); c.lineTo(6 + hem, 14.8); c.closePath(); c.fill();
  c.strokeStyle = gb.trim; c.lineWidth = 0.4;
  c.beginPath(); c.moveTo(3.8 + hem, 14.3); c.quadraticCurveTo(8, 15.5, 12.2 + hem, 14.3); c.stroke();
  c.fillStyle = gb.robeLo; c.fillRect(5.5, 10.8 - bob, 5, 0.7);
  ell(c, 8, 11.15 - bob, 0.5, 0.5, gb.trim);
  // sleeves
  ell(c, 4.8, 10.2 - bob + sw * 0.6, 1.25, 2, gb.robeLo);
  ell(c, 11.2, 10.2 - bob - sw * 0.6, 1.25, 2, gb.robeLo);
  ell(c, 4.8, 11.9 - bob + sw * 0.6, 0.7, 0.6, '#f2c99a');
  ell(c, 11.2, 11.9 - bob - sw * 0.6, 0.7, 0.6, '#f2c99a');
  // head
  const hy = 6.4 - bob;
  if (facing === 1) {
    ell(c, 8, hy + 0.2, 2.5, 2.4, gb.hatLo);
  } else {
    ell(c, 8, hy, 2.4, 2.3, '#f2c99a');
    if (side) {
      ell(c, 8 + dir * 1.2, hy + 1.6, 1.7, 1.5, gb.beard);
      ell(c, 8 + dir * 2.3, hy + 0.2, 0.5, 0.4, '#e0b080');
      ell(c, 8 + dir * 1.1, hy - 0.3, 0.38, 0.45, '#18182a');
    } else {
      ell(c, 8, hy + 1.8, 2, 1.7, gb.beard);
      ell(c, 7.1, hy - 0.2, 0.38, 0.45, '#18182a'); ell(c, 8.9, hy - 0.2, 0.38, 0.45, '#18182a');
    }
  }
  // hat
  const tip = side ? -dir * 1.4 : sw * 0.7;
  ell(c, 8, 4.9 - bob, 4.4, 1.35, gb.hatLo);
  c.fillStyle = lg(c, 5, 0, 11, 0, gb.hat, gb.hatLo);
  c.beginPath(); c.moveTo(5, 4.8 - bob); c.quadraticCurveTo(7.4, 2.4 - bob, 8 + tip, -0.9 - bob);
  c.quadraticCurveTo(9.4, 2.6 - bob, 11, 4.8 - bob); c.quadraticCurveTo(8, 5.9 - bob, 5, 4.8 - bob); c.fill();
  c.strokeStyle = gb.trim; c.lineWidth = 0.55;
  c.beginPath(); c.moveTo(5.5, 4.3 - bob); c.quadraticCurveTo(8, 5.2 - bob, 10.5, 4.3 - bob); c.stroke();
  ell(c, 7.2, 2.6 - bob, 0.35, 0.35, 'rgba(255,255,255,0.5)');
  if (facing !== 1) staff();
}

const wizCache = new Map<number, HTMLCanvasElement>();
let wizScratch: [HTMLCanvasElement, Ctx] | null = null;
const WIZ_S = 4;

function wizSprite(e: Ent): HTMLCanvasElement {
  const ice = e.wand === 'ice', froze = e.stun > 0.6;
  const tint = (k: Ctx, cv: HTMLCanvasElement): void => {
    if (!froze) return;
    k.setTransform(1, 0, 0, 1, 0, 0);
    k.globalCompositeOperation = 'source-atop';
    k.fillStyle = 'rgba(150,228,255,0.62)';
    k.fillRect(0, 0, cv.width, cv.height);
    k.globalCompositeOperation = 'source-over';
  };
  if (e.tier === 6) {
    const frame = Math.floor(e.animDist / 3) % 8;
    const key = ((((e.rival ? 1 : 0) * 4 + e.facing) * 8 + frame) * 2 + (ice ? 1 : 0)) * 2 + (froze ? 1 : 0);
    let cv = wizCache.get(key);
    if (!cv) {
      let k: Ctx;
      [cv, k] = mk(24 * 2.5, 24 * 2.5);
      k.scale(2.5, 2.5); k.translate(4, 6);
      paintWizard(k, e.rival, e.facing, frame / 8 * TAU, ice);
      tint(k, cv);
      k.setTransform(1, 0, 0, 1, 0, 0);
      quantise(cv, k);
      wizCache.set(key, cv);
    }
    return cv;
  }
  if (!wizScratch) wizScratch = mk(24 * WIZ_S, 24 * WIZ_S);
  const [cv, k] = wizScratch;
  k.setTransform(1, 0, 0, 1, 0, 0);
  k.clearRect(0, 0, cv.width, cv.height);
  k.scale(WIZ_S, WIZ_S); k.translate(4, 6);
  paintWizard(k, e.rival, e.facing, e.animDist / 24 * TAU, ice);
  tint(k, cv);
  return cv;
}

// A PC-era wizard, wherever they are standing. In a low-tier world the same
// sprite is squeezed onto the coarse grid with smoothing on — an anti-aliased
// visitor from the future.
export function drawHiAvatar(c: Ctx, e: Ent, sx: number, sy: number): void {
  const keep = c.imageSmoothingEnabled;
  c.imageSmoothingEnabled = e.tier >= 7 || c.getTransform().a < 2;
  c.drawImage(wizSprite(e), sx - 4, sy - 6, 24, 24);
  c.imageSmoothingEnabled = keep;
  if (e.channel > 0) {
    const need = e.tier >= WIN_TIER ? FINAL_CHANNEL_TIME : CHANNEL_TIME;
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.beginPath(); c.arc(sx + 8, sy + 8, 10.5, 0, TAU); c.stroke();
    c.strokeStyle = e.rival ? '#ff8098' : '#70f0ff';
    c.beginPath(); c.arc(sx + 8, sy + 8, 10.5, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(e.channel / need, 0, 1)); c.stroke();
  }
}

// ---------- light ----------

const glowCache = new Map<string, HTMLCanvasElement>();
function glow(c: Ctx, x: number, y: number, r: number, color: string, alpha: number): void {
  let cv = glowCache.get(color);
  if (!cv) {
    let k: Ctx;
    [cv, k] = mk(64, 64);
    const [R, G, B] = rgb(color);
    const g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${R},${G},${B},1)`);
    g.addColorStop(0.35, `rgba(${R},${G},${B},0.42)`);
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    k.fillStyle = g; k.fillRect(0, 0, 64, 64);
    glowCache.set(color, cv);
  }
  c.globalAlpha = clamp(alpha, 0, 1);
  c.drawImage(cv, x - r, y - r, r * 2, r * 2);
}

let bloom: [HTMLCanvasElement, Ctx] | null = null;

// ---------- the frame ----------

export function hiresRender(c: Ctx, g: Game, tier: number, viewW: number): void {
  const S = tierScale(tier), hd = tier >= 7;
  const snap = (v: number): number => Math.round(v * S) / S;
  const camX = snap(g.camX), camY = snap(g.camY);
  const w = g.world, time = g.time;
  c.save();
  c.beginPath(); c.rect(0, 0, viewW, SCR_H); c.clip();
  c.imageSmoothingEnabled = hd;

  const tx0 = Math.floor(camX / 8) - 1, ty0 = Math.floor(camY / 8) - 1;
  const tx1 = Math.floor((camX + viewW) / 8) + 1, ty1 = Math.floor((camY + SCR_H) / 8) + 2;
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  const vis = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) vis[y * cols + x] = tileAt(w, tx0 + x, ty0 + y);

  // --- ground, one class at a time
  const wf = Math.floor(time * (hd ? 7 : 5)) % 4;
  const gs = 12;   // sprite span in logical px: tile + two quarter-tile margins
  for (let cls = 0; cls <= G_GRASS; cls++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (GCLASS[vis[y * cols + x]] !== cls) continue;
        const tx = tx0 + x, ty = ty0 + y;
        c.drawImage(groundSprite(tier, cls, tx & 3, ty & 3, cls === G_WATER ? wf : 0),
          tx * 8 - camX - 2, ty * 8 - camY - 2, gs, gs);
      }
    }
  }

  // --- things that stand up, north to south, with everyone slotted between rows
  const ripe = new Set<number>();
  w.berrySpots.forEach((b, i) => { if (g.berryCd[i] <= 0) ripe.add(b.y * WORLD_TW + b.x); });
  const ents = [g.player, g.rival].filter(e => !(e.inv > 0 && e.stun <= 0.6 && Math.floor(time * 12) % 2 === 0));
  const stations: [number, number, Ent][] = [[w.pStationX, w.pStationY, g.player], [w.rStationX, w.rStationY, g.rival]];
  const blit = (cv: HTMLCanvasElement, x: number, y: number): void => c.drawImage(cv, x - 4, y - 8, 16, 18);

  for (let y = 0; y < rows; y++) {
    const ty = ty0 + y;
    for (let x = 0; x < cols; x++) {
      const t = vis[y * cols + x];
      if (t === Tl.GRASS || t === Tl.PATH || t === Tl.DIRT || t === Tl.WATER || t === Tl.ICE) continue;
      const tx = tx0 + x, px = tx * 8 - camX, py = ty * 8 - camY;
      const hv = Math.floor(h2(tx, ty, 9) * 4);
      switch (t) {
        case Tl.TREE: {
          const cv = objSprite(tier, 'tree', hv);
          if (hd) {
            c.save(); c.translate(px + 4, py + 8);
            c.transform(1, 0, Math.sin(time * 1.3 + tx * 0.7 + ty * 0.4) * 0.035, 1, 0, 0);
            c.drawImage(cv, -8, -16, 16, 18);
            c.restore();
          } else blit(cv, px, py);
          break;
        }
        case Tl.ROCK: blit(objSprite(tier, 'rock', hv & 1), px, py); break;
        case Tl.CLEFT: blit(objSprite(tier, 'cleft'), px, py); break;
        case Tl.STONE: blit(objSprite(tier, 'stone'), px, py); break;
        case Tl.CRACK: blit(objSprite(tier, 'crack'), px, py); break;
        case Tl.WALL: blit(objSprite(tier, 'wall', (tx + ty) & 1), px, py); break;
        case Tl.HUT: blit(objSprite(tier, 'hut', (tx + ty) & 1), px, py); break;
        case Tl.RUIN: blit(objSprite(tier, 'ruin', hv), px, py); break;
        case Tl.WELL: blit(objSprite(tier, 'well'), px, py); break;
        case Tl.SHRINE: blit(objSprite(tier, 'shrine'), px, py); break;
        case Tl.BERRY: blit(objSprite(tier, 'berry', 0, ripe.has(ty * WORLD_TW + tx) ? 1 : 0), px, py); break;
        case Tl.REED: blit(objSprite(tier, 'reed', hv & 1, Math.floor(time * (hd ? 4 : 2) + tx) % 4), px, py); break;
        case Tl.PUSH: blit(objSprite(tier, 'push'), px, py); break;
        case Tl.STUMP: blit(objSprite(tier, 'stump'), px, py); break;
        case Tl.BURN: blit(objSprite(tier, 'burn', 0, Math.floor(time * 10 + tx * 3 + ty) % 4), px, py); break;
        case Tl.ALTAR: blit(objSprite(tier, 'altar'), px, py); break;
        case Tl.PBASE: blit(objSprite(tier, 'base', 0), px, py); break;
        case Tl.RBASE: blit(objSprite(tier, 'base', 1), px, py); break;
      }
    }
    for (const [sx, sy, owner] of stations) {
      if (Math.floor(sy / 8) !== ty) continue;
      blit(objSprite(tier, 'pedestal', owner.wand === 'fire' ? 1 : 0), snap(sx - 4 - camX), snap(sy - 4 - camY));
    }
    for (const s of g.shards) {
      if (Math.floor(s.y / 8) !== ty) continue;
      const bob = Math.sin(time * 3 + s.x * 0.1) * 1.3;
      blit(objSprite(tier, 'shard', 0, hd ? 0 : Math.floor(time * 6 + s.x) % 8), snap(s.x - 4 - camX), snap(s.y - 5 - camY + bob));
    }
    for (const e of ents) {
      if (Math.floor(e.y / 8) !== ty) continue;
      if (e.tier >= 6) drawHiAvatar(c, e, snap(e.x - 8 - camX), snap(e.y - 12 - camY));
      else drawLegacyAvatar(c, e, camX, camY);
    }
  }

  // --- bolts
  for (const b of g.bolts) {
    const bx = b.x - camX, by = b.y - camY;
    if (bx < -8 || by < -8 || bx > viewW + 8 || by > SCR_H + 8) continue;
    const ice = b.kind === 'ice';
    if (b.tier <= 2) {
      c.fillStyle = Math.floor(time * 14) % 2 ? (ice ? '#00ffff' : '#ffe000') : '#ffffff';
      c.fillRect(Math.floor(bx / 4) * 4 - 2, Math.floor(by / 4) * 4 - 2, 5, 5);
    } else if (!hd || b.tier < 6) {
      // flat palette colours: a bright core and a stutter of sparks behind it
      const sp = Math.hypot(b.vx, b.vy) || 1;
      c.fillStyle = ice ? '#99ffff' : '#ffcc33';
      for (let i = 1; i <= 3; i++) {
        c.fillRect(snap(bx - b.vx / sp * i * 2.6 + (h2(i, Math.floor(time * 30), 3) - 0.5) * 3),
          snap(by - b.vy / sp * i * 2.6 + (h2(i, Math.floor(time * 30), 4) - 0.5) * 3), 0.8, 0.8);
      }
      ell(c, snap(bx), snap(by), 2.4, 2.4, ice ? '#66ccff' : '#ff9933');
      ell(c, snap(bx), snap(by), 1.3, 1.3, '#ffffff');
    }
  }

  // --- fx
  for (const f of g.fx) {
    const t = time - f.t0, fx = f.x - camX, fy = f.y - camY;
    if (fx < -60 || fy < -60 || fx > viewW + 60 || fy > SCR_H + 60) continue;
    const th = THEME[tier];
    if (f.kind === 0) {
      for (let i = 0; i < 44; i++) {
        const a = h2(i, 1, 7) * TAU, sp = 12 + h2(i, 2, 7) * 38, sz = hd ? 1.4 * (1 - t) + 0.3 : 0.8;
        c.fillStyle = i % 3 === 0 ? th.shrineGlow : i % 3 === 1 ? '#ffffff' : th.altarGlow;
        const x = fx + Math.cos(a) * sp * t, y = fy + Math.sin(a) * sp * t + t * t * 14;
        if (hd) ell(c, x, y, sz, sz, c.fillStyle as string); else c.fillRect(snap(x), snap(y), sz, sz);
      }
    } else if (f.kind === 1) {
      for (let i = 0; i < 10; i++) {
        c.fillStyle = i % 2 ? '#ffffff' : th.shrineGlow;
        c.fillRect(snap(fx - 6 + i * 1.3 + Math.sin(t * 9 + i) * 1.5), snap(fy - t * (8 + i * 4)), hd ? 0.6 : 0.8, hd ? 0.6 : 0.8);
      }
    } else {
      c.strokeStyle = th.altarGlow; c.lineWidth = hd ? 1.6 * (1 - t) + 0.3 : 0.8;
      for (const k of [46, 30]) {
        c.globalAlpha = Math.max(0, 1 - t);
        c.beginPath(); c.arc(fx, fy, t * k, 0, TAU); c.stroke();
      }
      c.globalAlpha = 1;
    }
  }

  if (hd) postChain(c, g, viewW, camX, camY, vis, cols, rows, tx0, ty0);
  c.restore();
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}

function postChain(
  c: Ctx, g: Game, viewW: number, camX: number, camY: number,
  vis: Uint8Array, cols: number, rows: number, tx0: number, ty0: number,
): void {
  const time = g.time, w = g.world, S = 4;
  // drifting cloud shade, then a cool vignette, both by multiplication
  c.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 3; i++) {
    const cx = ((time * (6 + i * 3) + i * 230) % (viewW + 300)) - 150;
    const g1 = c.createRadialGradient(cx, 30 + i * 60, 10, cx, 30 + i * 60, 110);
    g1.addColorStop(0, 'rgba(120,130,170,0.34)'); g1.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g1; c.fillRect(0, 0, viewW, SCR_H);
  }
  const vg = c.createRadialGradient(viewW / 2, SCR_H / 2, SCR_H * 0.35, viewW / 2, SCR_H / 2, viewW * 0.72);
  vg.addColorStop(0, '#ffffff'); vg.addColorStop(1, '#8e94b8');
  c.fillStyle = vg; c.fillRect(0, 0, viewW, SCR_H);

  // additive light
  c.globalCompositeOperation = 'lighter';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = vis[y * cols + x];
      const tx = tx0 + x, ty = ty0 + y, px = tx * 8 - camX + 4, py = ty * 8 - camY + 4;
      if (t === Tl.WATER) {
        const tw = h2(tx, ty, Math.floor(time * 2.5));
        if (tw > 0.9) glow(c, px + (tw - 0.95) * 60, py + h2(tx, ty, 3) * 6 - 3, 2.2, '#cfe6ff', (tw - 0.9) * 7);
      } else if (t === Tl.BURN) {
        glow(c, px, py - 3, 20 + Math.sin(time * 23 + tx) * 3, '#ff8a30', 0.55);
      } else if (t === Tl.SHRINE) {
        glow(c, px, py - 2.3, 5, '#ffd870', 0.4);
      } else if (t === Tl.ALTAR) {
        glow(c, px, py, 16, '#50e8ff', 0.22 + Math.sin(time * 3) * 0.1);
      } else if (t === Tl.PBASE || t === Tl.RBASE) {
        glow(c, px, py, 9, t === Tl.PBASE ? '#50e0ff' : '#ff5070', 0.3);
      }
    }
  }
  for (const s of g.shards) {
    glow(c, s.x - camX, s.y - camY - 1, 11, '#8fe4ff', 0.42 + Math.sin(time * 4 + s.x) * 0.16);
  }
  for (const [sx, sy, owner] of [[w.pStationX, w.pStationY, g.player], [w.rStationX, w.rStationY, g.rival]] as const) {
    glow(c, sx - camX, sy - camY - 7, 8, owner.wand === 'fire' ? '#60c8ff' : '#ff8840', 0.45);
  }
  for (const e of [g.player, g.rival]) {
    if (e.channel > 0) glow(c, e.x - camX, e.y - camY - 4, 18 + e.channel * 3, e.rival ? '#ff6080' : '#60f0ff', 0.4);
  }
  for (const b of g.bolts) {
    if (b.tier < 6) continue;
    const bx = b.x - camX, by = b.y - camY, sp = Math.hypot(b.vx, b.vy) || 1;
    const col = b.kind === 'ice' ? '#70d8ff' : '#ffa040';
    for (let i = 1; i <= 5; i++) glow(c, bx - b.vx / sp * i * 2.4, by - b.vy / sp * i * 2.4, 5 - i * 0.6, col, 0.5 - i * 0.08);
    glow(c, bx, by, 9, col, 0.9);
    glow(c, bx, by, 3, '#ffffff', 1);
  }
  for (const f of g.fx) {
    const t = time - f.t0;
    if (f.kind === 2) glow(c, f.x - camX, f.y - camY, 30 + t * 60, '#80f0ff', (1 - t) * 0.6);
    if (f.kind === 0) glow(c, f.x - camX, f.y - camY, 14 + t * 30, '#ffffff', (1 - t) * 0.5);
  }
  // pollen and fireflies
  for (let i = 0; i < 30; i++) {
    const sp = 3 + h2(i, 1, 2) * 7;
    const x = mod(h2(i, 2, 2) * viewW + time * sp - camX * 0.6, viewW + 20) - 10;
    const y = mod(h2(i, 3, 2) * SCR_H + Math.sin(time * 0.7 + i) * 9 - camY * 0.6, SCR_H + 20) - 10;
    glow(c, x, y, 1.6 + h2(i, 4, 2) * 1.4, i % 4 ? '#fff4c0' : '#c0ffb0', 0.35 + Math.sin(time * 2.3 + i * 1.7) * 0.3);
  }

  // bloom: squash the frame small, square it to keep only the brights, add it back
  const bw = Math.round(viewW * S / 8), bh = Math.round(SCR_H * S / 8);
  if (!bloom || bloom[0].width !== bw) bloom = mk(bw, bh);
  const [bc, bk] = bloom;
  bk.globalCompositeOperation = 'copy';
  bk.drawImage(c.canvas, 0, 0, viewW * S, SCR_H * S, 0, 0, bw, bh);
  bk.globalCompositeOperation = 'multiply';
  bk.drawImage(bc, 0, 0);
  c.globalAlpha = 0.3;
  c.drawImage(bc, 0, 0, viewW, SCR_H);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}

// ---------- HUD ----------

function bevel(c: Ctx, x: number, y: number, w: number, h: number, raised: boolean, S: number): void {
  const u = 1 / S;
  c.fillStyle = raised ? '#c0c0c0' : '#ffffff';
  c.fillRect(x, y, w, h);
  c.fillStyle = raised ? '#ffffff' : '#808080';
  c.fillRect(x, y, w, u); c.fillRect(x, y, u, h);
  c.fillStyle = raised ? '#808080' : '#dfdfdf';
  c.fillRect(x, y + h - u, w, u); c.fillRect(x + w - u, y, u, h);
  if (raised) { c.fillStyle = '#000000'; c.fillRect(x, y + h, w + u, u); c.fillRect(x + w, y, u, h); }
}

function banner(c: Ctx, text: string, y: number, hd: boolean, VW: number, S: number, col: string): void {
  const wpx = textWidth(text), x = Math.floor((VW - wpx) / 2);
  if (hd) {
    c.fillStyle = 'rgba(8,14,30,0.72)';
    c.beginPath(); c.roundRect(x - 6, y - 2.5, wpx + 12, 10, 5); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1 / S; c.stroke();
    drawText(c, text, x, y, col);
  } else {
    bevel(c, x - 5, y - 3, wpx + 10, 11, true, S);
    c.fillStyle = '#000080'; c.fillRect(x - 4, y - 2, wpx + 8, 9);
    drawText(c, text, x, y, '#ffffff');
  }
}

export function drawHudHi(c: Ctx, g: Game, tier: number, VW: number): void {
  const S = tierScale(tier), hd = tier >= 7, y0 = SCR_H;
  const p = g.player, r = g.rival;
  const fg = hd ? '#f4f8ff' : '#000000';
  if (hd) {
    c.fillStyle = lg(c, 0, y0, 0, y0 + 16, '#222c48', '#080c18'); c.fillRect(0, y0, VW, 16);
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(0, y0, VW, 7);
    c.fillStyle = 'rgba(160,200,255,0.5)'; c.fillRect(0, y0, VW, 1 / S);
  } else {
    c.fillStyle = '#c0c0c0'; c.fillRect(0, y0, VW, 16);
    c.fillStyle = '#ffffff'; c.fillRect(0, y0 + 1 / S, VW, 1 / S);
  }
  const rowsDef: [Ent, string, number][] = [[p, 'YOU', y0 + 1], [r, 'KERNAGH', y0 + 8.4]];
  for (const [e, who, ry] of rowsDef) {
    if (!hd) { bevel(c, 1, ry, 116, 6.6, true, S); bevel(c, 119.5, ry, 48, 6.6, false, S); }
    ell(c, 5, ry + 3.3, 1.8, 1.8, e.rival ? '#c23048' : '#3e5be8');
    drawText(c, `${who} T${e.tier} ${TIERS[e.tier].name}`, 9, ry + 0.8, fg);
    drawText(c, '♥'.repeat(e.hp), 122, ry + 0.8, hd ? '#ff5a70' : '#d00018');
    drawText(c, '◆'.repeat(e.shards), 140, ry + 0.8, hd ? '#7ce8ff' : '#000080');
    ell(c, 160, ry + 3.3, 2, 2, e.wand === 'ice'
      ? rg(c, 159.5, ry + 2.8, 2.2, '#ffffff', '#30a0e8') : rg(c, 159.5, ry + 2.8, 2.2, '#fff6b0', '#f04c18'));
  }
  // minimap
  const cur = screenOf(p.x, p.y), st = screenOf(g.world.altarX, g.world.altarY);
  const MX = VW - 60, MY = y0 + 2;
  if (hd) {
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.roundRect(MX - 2, MY - 1.5, 33, 15, 2); c.fill();
  } else bevel(c, MX - 2, MY - 1.5, 33, 15, false, S), (c.fillStyle = '#000000'), c.fillRect(MX - 1.5, MY - 1, 32, 14);
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 6; sx++) {
      let cc = hd ? '#2c3450' : '#404040';
      if (sx === g.world.pSafe.x && sy === g.world.pSafe.y) cc = hd ? '#58d870' : '#00c000';
      if (sx === g.world.rSafe.x && sy === g.world.rSafe.y) cc = hd ? '#ff5a70' : '#e00000';
      if (sx === st.x && sy === st.y) cc = hd ? '#60e8ff' : '#00e0e0';
      if (sx === cur.x && sy === cur.y && Math.floor(g.time * 4) % 2 === 0) cc = '#ffffff';
      c.fillStyle = cc; c.fillRect(MX + sx * 5, MY + sy * 3, 4, 2);
    }
  }
  // clock
  const mins = Math.floor(g.time / 60), secs = Math.floor(g.time % 60);
  if (!hd) bevel(c, VW - 23, y0 + 4, 21, 8, false, S), (c.fillStyle = '#c0c0c0'), c.fillRect(VW - 22.5, y0 + 4.5, 20, 7);
  drawText(c, `${mins}:${secs < 10 ? '0' : ''}${secs}`, VW - 20, y0 + 5.5, fg);

  if (g.time < g.msgUntil && g.msg) banner(c, g.msg, 4, hd, VW, S, '#ffe470');
  if (g.time < g.escArmUntil) banner(c, 'ESC AGAIN - TITLE SCREEN', 17, hd, VW, S, '#ff7088');
}
