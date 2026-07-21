// Shared constants and types.

export const TILE = 8;
export const SCR_TW = 32, SCR_TH = 22;           // tiles per screen (play area)
export const WORLD_SW = 6, WORLD_SH = 4;         // screens in world
export const WORLD_TW = SCR_TW * WORLD_SW;       // 192 tiles
export const WORLD_TH = SCR_TH * WORLD_SH;       // 88 tiles
export const SCR_W = SCR_TW * TILE;              // 256 px
export const SCR_H = SCR_TH * TILE;              // 176 px
export const CANVAS_W = 256, CANVAS_H = 192;     // + 16 px HUD
export const WORLD_W = WORLD_TW * TILE;
export const WORLD_H = WORLD_TH * TILE;

// Tile ids
export const Tl = {
  GRASS: 0, PATH: 1, TREE: 2, WATER: 3, REED: 4, WALL: 5,
  ROCK: 6, STONE: 7, ALTAR: 8, SHRINE: 9, WELL: 10, HUT: 11,
} as const;

export const SOLID = new Set<number>([Tl.TREE, Tl.WATER, Tl.WALL, Tl.ROCK, Tl.STONE, Tl.WELL, Tl.HUT]);

export const START_TIER = 1;
export const WIN_TIER = 5;
export const TIERS = [
  { name: '1979 MONO', quant: 8 },
  { name: 'SPECTRUM 48K', quant: 4 },
  { name: 'SPECTRUM 128', quant: 2 },
  { name: '8-BIT SPRITES', quant: 1 },
  { name: '16-BIT ST', quant: 1 },
  { name: 'AMIGA', quant: 1 },
];

export const SHARDS_PER_UPGRADE = 3;
export const CHANNEL_TIME = 3;
export const FINAL_CHANNEL_TIME = 5;   // the transcendence ritual takes longer

// Spectrum palette: 0-7 normal, 8-15 BRIGHT
export const SPECTRUM = [
  '#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
  '#000000', '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff',
];

// [ink, paper] attribute for each tile type at Spectrum tiers.
// Black paper throughout: the Spectrum didn't advertise its limitations.
export const TILE_ATTR: [number, number][] = [];
TILE_ATTR[Tl.GRASS] = [4, 0];
TILE_ATTR[Tl.PATH] = [6, 0];
TILE_ATTR[Tl.TREE] = [12, 0];
TILE_ATTR[Tl.WATER] = [15, 1];
TILE_ATTR[Tl.REED] = [12, 0];
TILE_ATTR[Tl.WALL] = [7, 0];
TILE_ATTR[Tl.ROCK] = [7, 0];
TILE_ATTR[Tl.STONE] = [15, 0];
TILE_ATTR[Tl.ALTAR] = [13, 0];
TILE_ATTR[Tl.SHRINE] = [14, 0];
TILE_ATTR[Tl.WELL] = [7, 0];
TILE_ATTR[Tl.HUT] = [10, 0];

// Direct-render colour themes for tiers 3..5
export interface Theme {
  grass: string; grass2: string; path: string; path2: string;
  trunk: string; tree1: string; tree2: string; tree3: string;
  water: string; water2: string; water3: string; reed: string;
  wall: string; wallDark: string; hut: string; hutDark: string;
  rock: string; rockHi: string; stone: string; stoneHi: string;
  altarPad: string; altarGlow: string; shrineGlow: string;
  hudBg: string; hudFg: string; hudAccent: string;
}

export const THEME: Record<number, Theme> = {
  3: {
    grass: '#4f9b3a', grass2: '#448a31', path: '#c2a25a', path2: '#ae9050',
    trunk: '#8a5a2b', tree1: '#2c631f', tree2: '#3d7d2a', tree3: '#3d7d2a',
    water: '#3552a4', water2: '#7d9ce0', water3: '#7d9ce0', reed: '#8fc25e',
    wall: '#9a9a9a', wallDark: '#6e6e6e', hut: '#a8623a', hutDark: '#7c4326',
    rock: '#7d7d7d', rockHi: '#a5a5a5', stone: '#b5b5b5', stoneHi: '#dcdcdc',
    altarPad: '#26262e', altarGlow: '#66d9e8', shrineGlow: '#f0d040',
    hudBg: '#101018', hudFg: '#e8e8e8', hudAccent: '#f0d040',
  },
  4: {
    grass: '#4da03e', grass2: '#3f8c33', path: '#d0ac60', path2: '#b8964e',
    trunk: '#8f5e2e', tree1: '#245c1a', tree2: '#357a24', tree3: '#4d9c36',
    water: '#2e55b8', water2: '#6f96e8', water3: '#a8c4f8', reed: '#96cc60',
    wall: '#a2a2ae', wallDark: '#70707c', hut: '#b0663c', hutDark: '#804828',
    rock: '#82828c', rockHi: '#b0b0ba', stone: '#bcbcc6', stoneHi: '#e6e6ee',
    altarPad: '#20222e', altarGlow: '#5fe0ee', shrineGlow: '#ffd84a',
    hudBg: '#141420', hudFg: '#f0f0f4', hudAccent: '#ffd84a',
  },
  5: {
    grass: '#3f9c44', grass2: '#358a3a', path: '#d8b468', path2: '#c0a058',
    trunk: '#96622f', tree1: '#1d5618', tree2: '#2e7a22', tree3: '#4aa634',
    water: '#2350c0', water2: '#5c8cec', water3: '#9cc0ff', reed: '#8ed05e',
    wall: '#a8aab8', wallDark: '#747684', hut: '#b86c40', hutDark: '#864c2a',
    rock: '#84889a', rockHi: '#b4b8ca', stone: '#c2c4d2', stoneHi: '#f0f2fc',
    altarPad: '#1c2030', altarGlow: '#54e8f8', shrineGlow: '#ffe060',
    hudBg: '#181828', hudFg: '#f6f6fa', hudAccent: '#ffe060',
  },
};

// Avatar colours for direct rendering
export interface Bands { hat: string; skin: string; robe: string; boots: string }
export const PLAYER_BANDS: Bands = { hat: '#2b3fd6', skin: '#f2c99a', robe: '#3e5be8', boots: '#3a2416' };
export const RIVAL_BANDS: Bands = { hat: '#8c1e3c', skin: '#e8b98a', robe: '#c23048', boots: '#2b1a10' };
// Two-colour Spectrum sprites: [head ink, body ink]
export const PLAYER_INKS: [number, number] = [15, 13];  // white head, cyan body
export const RIVAL_INKS: [number, number] = [14, 11];   // yellow head, magenta body
export const BOLT_INK = 14;     // bright yellow
export const SHARD_INK = 13;    // bright cyan

export interface Vec { x: number; y: number }

export interface Ent {
  x: number; y: number; facing: number;   // 0 down 1 up 2 left 3 right
  hp: number; tier: number; shards: number;
  cool: number; channel: number; inv: number; regen: number;
  animDist: number; stepAcc: number;
  homeX: number; homeY: number; rival: boolean;
}

export interface Bolt { x: number; y: number; vx: number; vy: number; life: number; fromRival: boolean; tier: number }
export interface Shard { x: number; y: number }
export interface Fx { x: number; y: number; t0: number; kind: number } // 0 derez, 1 spawn, 2 upgrade

export interface World {
  tiles: Uint8Array;
  shrines: Vec[];              // tile coords
  altarX: number; altarY: number;   // px
  pHomeX: number; pHomeY: number;
  rHomeX: number; rHomeY: number;
}

export interface RivalAI {
  state: string; path: Vec[]; pathI: number; repath: number;
  lastX: number; lastY: number; stuck: number; targetKey: string;
  interceptT: number; coolUntil: number; pauseUntil: number;
}

export interface Game {
  mode: 'loading' | 'title' | 'play' | 'win' | 'lose';
  loadT: number;
  time: number; world: World;
  player: Ent; rival: Ent;
  bolts: Bolt[]; shards: Shard[]; fx: Fx[];
  respawn: number;
  msg: string; msgUntil: number;
  ripple: number; rippleFrom: number;   // ripple start time (-1 off), previous tier
  ai: RivalAI;
  camX: number; camY: number;
  hinted3: boolean;
  endTime: number;
  loseWhy: 'race' | 'derez';
  winWhy: 'transcend' | 'elimination';
  winTier: number;   // player tier at the moment of victory (styles the partial screen)
}

export interface Input { up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean }

export const FACING_VECS: [number, number][] = [[0, 1], [0, -1], [-1, 0], [1, 0]];

export function screenOf(x: number, y: number): Vec {
  return { x: Math.floor(x / SCR_W), y: Math.floor(y / SCR_H) };
}

export function inSafe(x: number, y: number): boolean {
  const s = screenOf(x, y);
  return (s.x === 0 && s.y === 3) || (s.x === 5 && s.y === 3);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
