// 1-bit tile patterns (8 bytes, bit 7 = leftmost) and 16x16 avatar masks.

import { Tl } from './defs';

export const PATTERNS: number[][] = [];
PATTERNS[Tl.GRASS] = [0x00, 0x10, 0x00, 0x00, 0x02, 0x00, 0x40, 0x00];
PATTERNS[Tl.PATH] = [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55];
PATTERNS[Tl.TREE] = [0x76, 0xff, 0xdb, 0xff, 0xef, 0x7e, 0x18, 0x18];
PATTERNS[Tl.WATER] = [0x00, 0x66, 0x00, 0x00, 0xcc, 0x00, 0x33, 0x00];
PATTERNS[Tl.REED] = [0x24, 0x24, 0xa5, 0x24, 0x2d, 0x24, 0x24, 0x24];
PATTERNS[Tl.WALL] = [0xff, 0x89, 0x89, 0xff, 0x98, 0x98, 0xff, 0x89];
PATTERNS[Tl.ROCK] = [0x00, 0x3c, 0x7e, 0xff, 0xff, 0x7e, 0x3c, 0x00];
PATTERNS[Tl.STONE] = [0x18, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x7e, 0x7e];
PATTERNS[Tl.ALTAR] = [0x3c, 0x42, 0x81, 0x99, 0x99, 0x81, 0x42, 0x3c];
PATTERNS[Tl.SHRINE] = [0x00, 0x18, 0x3c, 0x18, 0x18, 0x3c, 0x7e, 0x00];
PATTERNS[Tl.WELL] = [0x3c, 0x66, 0xc3, 0xc3, 0xc3, 0xc3, 0x66, 0x3c];
PATTERNS[Tl.HUT] = [0xff, 0x92, 0x92, 0xff, 0x24, 0x24, 0xff, 0x92];
PATTERNS[Tl.BERRY] = [0x00, 0x24, 0x5a, 0x3c, 0x5a, 0x24, 0x18, 0x00];
PATTERNS[Tl.DIRT] = [0, 0, 0, 0, 0, 0, 0, 0];
// Home sigils: ringed pads marking each wizard's base.
PATTERNS[Tl.PBASE] = [0x3c, 0x42, 0x99, 0xa5, 0xa5, 0x99, 0x42, 0x3c];
PATTERNS[Tl.RBASE] = [0x3c, 0x5a, 0xbd, 0xdb, 0xdb, 0xbd, 0x5a, 0x3c];

// Overlay stamped on a berry bush while its fruit is available.
export const BERRY_DOTS = [0x00, 0x00, 0x24, 0x00, 0x18, 0x00, 0x24, 0x00];

// Wand glyphs: a diagonal staff with a flame (fire) or star (ice) at the tip.
export const WAND_FIRE = [0x06, 0x0e, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
export const WAND_ICE = [0x0a, 0x04, 0x0e, 0x08, 0x10, 0x20, 0x40, 0x80];

export const GRASS_ALT = [0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x08];

// Shards are storage media of the era you currently perceive:
// cassette tape (T0-T2), 3.5" floppy (T3-T4), CD (T5).
export const SHARD_TAPE = [0xff, 0x81, 0xbd, 0xa5, 0xbd, 0x81, 0xe7, 0xff];
export const SHARD_FLOPPY = [0xfe, 0x99, 0x99, 0x81, 0xbd, 0xbd, 0x81, 0xff];
export const SHARD_CD = [0x3c, 0x7e, 0xe7, 0xdb, 0xdb, 0xe7, 0x7e, 0x3c];

export function shardPat(envTier: number): number[] {
  return envTier <= 2 ? SHARD_TAPE : envTier <= 4 ? SHARD_FLOPPY : SHARD_CD;
}
export const BOLT_PATS = [
  [0x10, 0x54, 0x38, 0xfe, 0x38, 0x54, 0x10, 0x00],
  [0x00, 0x92, 0x54, 0x38, 0x54, 0x92, 0x00, 0x00],
];

const D0 = [
  '................',
  '.......##.......',
  '......####......',
  '......####......',
  '....########....',
  '.....######.....',
  '.....#.##.#.....',
  '.....######.....',
  '....########....',
  '...##########...',
  '...##.####.##...',
  '...##########...',
  '....########....',
  '....########....',
  '....##....##....',
  '...###....###...',
];
const D1 = D0.slice();
D1[13] = '.....######.....';
D1[14] = '......####......';
D1[15] = '.....######.....';

function withRow(src: string[], row: number, val: string): string[] {
  const out = src.slice();
  out[row] = val;
  return out;
}

const U0 = withRow(D0, 6, '.....######.....');
const U1 = withRow(D1, 6, '.....######.....');
const S0 = withRow(D0, 6, '.....####.#.....'); // eye toward facing side (right)
const S1 = withRow(D1, 6, '.....####.#.....');

function parse(rows: string[]): Uint8Array {
  const m = new Uint8Array(256);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) if (rows[r][c] === '#') m[r * 16 + c] = 1;
  }
  return m;
}

function flip(m: Uint8Array): Uint8Array {
  const o = new Uint8Array(256);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) o[r * 16 + c] = m[r * 16 + (15 - c)];
  }
  return o;
}

const MD = [parse(D0), parse(D1)];
const MU = [parse(U0), parse(U1)];
const MR = [parse(S0), parse(S1)];
const ML = [flip(MR[0]), flip(MR[1])];

// facing: 0 down 1 up 2 left 3 right
export function wizMask(facing: number, frame: number): Uint8Array {
  const set = facing === 0 ? MD : facing === 1 ? MU : facing === 2 ? ML : MR;
  return set[frame & 1];
}

// Colour band for a mask row when rendering avatars in full colour.
export function bandOfRow(r: number): 'hat' | 'skin' | 'robe' | 'boots' {
  if (r <= 4) return 'hat';
  if (r <= 7) return 'skin';
  if (r <= 12) return 'robe';
  return 'boots';
}
