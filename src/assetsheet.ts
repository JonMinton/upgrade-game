// One-page asset matrix: every sampled asset (rows) at every development tier
// (columns).
//
// The one rule this file obeys: it never draws an asset itself. Every cell is
// cropped out of a real `renderPlay()` pass over a synthetic world, so the
// sheet cannot drift from what the game actually draws. If a renderer changes,
// regenerate and the sheet changes with it.
//
// The walk-cycle row is derived, not asserted: poses are sampled along the
// animation distance and de-duplicated by pixel content, so the frame count
// per tier is whatever the renderers actually produce.

import {
  Game, World, Ent, Tl, SCR_W, SCR_H, WORLD_TW, WORLD_TH, TIERS, Wand,
} from './defs';
import { renderPlay } from './render';

// ---------- offscreen plumbing ----------

const off = document.createElement('canvas');
off.width = SCR_W;
off.height = SCR_H;
const offCtx = off.getContext('2d', { willReadFrequently: true })!;

const tmp = document.createElement('canvas');
const tmpCtx = tmp.getContext('2d')!;

function blit(c: CanvasRenderingContext2D, img: ImageData, dx: number, dy: number, scale: number): void {
  tmp.width = img.width;
  tmp.height = img.height;
  tmpCtx.putImageData(img, 0, 0);
  c.imageSmoothingEnabled = false;
  c.drawImage(tmp, 0, 0, img.width, img.height, dx, dy, img.width * scale, img.height * scale);
}

function fingerprint(img: ImageData): string {
  // FNV-1a over the pixel bytes: cheap, and only ever compared for equality.
  let h = 0x811c9dc5;
  const d = img.data;
  for (let i = 0; i < d.length; i++) {
    h ^= d[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ---------- a synthetic world the real renderers accept ----------

// Bare earth everywhere: TILE_ATTR[DIRT] is black-on-black at the attribute
// tiers, so a sampled asset sits on a neutral field at every tier.
function blankWorld(): World {
  const tiles = new Uint8Array(WORLD_TW * WORLD_TH);
  tiles.fill(Tl.DIRT);
  return {
    tiles,
    shrines: [],
    berrySpots: [],
    altarX: -999, altarY: -999,
    pHomeX: -999, pHomeY: -999,
    rHomeX: -999, rHomeY: -999,
    // Off-screen by default; a pedestal sample moves the player's station in.
    pStationX: -999, pStationY: -999,
    rStationX: -999, rStationY: -999,
    pSafe: { x: -9, y: -9 }, rSafe: { x: -9, y: -9 },
  };
}

function offEnt(rival: boolean): Ent {
  return {
    x: -1000, y: -1000, facing: 3, hp: 3, tier: 1, shards: 0,
    cool: 0, channel: 0, inv: 0, regen: 0, stun: 0, wand: 'fire', onStation: false,
    animDist: 0, stepAcc: 0, homeX: -1000, homeY: -1000, rival,
  };
}

// time is pinned: every time-varying effect (water, bolt flicker, shard bob,
// cloud shadows) resolves to the same phase on every pass, so the sheet is
// reproducible and pose de-duplication compares like with like.
function makeGame(): Game {
  const world = blankWorld();
  return {
    mode: 'play', difficulty: 'hard', loadT: 0, time: 0, world,
    player: offEnt(false), rival: offEnt(true),
    bolts: [], shards: [], fx: [], berryCd: [],
    respawn: 99, msg: '', msgUntil: 0, push: null, drag: null, burns: [], dmg: {},
    ripple: -1, rippleFrom: 1,
    ai: {
      state: '', path: [], pathI: 0, repath: 0, lastX: 0, lastY: 0, stuck: 0,
      targetKey: '', interceptT: 0, coolUntil: 0, pauseUntil: 0, nearT: 0,
    },
    camX: 0, camY: 0, hinted3: true, endTime: 0,
    loseWhy: 'race', winWhy: 'transcend', winTier: 5,
    maxTier: 5, kills: 0, score: 0, scored: false, entryActive: false, entryName: '',
    mapName: 'SHEET', chaosSeed: null, seedEntry: null, escArmUntil: 0,
  };
}

// ---------- samples ----------

type Sample =
  | { kind: 'tile'; label: string; note?: string; tile: number }
  | { kind: 'shard'; label: string; note?: string }
  | { kind: 'bolt'; label: string; note?: string; wand: Wand }
  | { kind: 'pedestal'; label: string; note?: string; wand: Wand }
  | { kind: 'scene'; label: string; note?: string }
  | { kind: 'walk'; label: string; note?: string; rival: boolean };

interface Group { title: string; rows: Sample[] }

const FULL: Group[] = [
  {
    title: 'TERRAIN',
    rows: [
      { kind: 'tile', label: 'grass', tile: Tl.GRASS },
      { kind: 'tile', label: 'path', tile: Tl.PATH },
      { kind: 'tile', label: 'tree', tile: Tl.TREE },
      { kind: 'tile', label: 'water', tile: Tl.WATER, note: 'animated from T3' },
      { kind: 'tile', label: 'reed', tile: Tl.REED },
      { kind: 'tile', label: 'rock', tile: Tl.ROCK },
    ],
  },
  {
    title: 'STRUCTURES',
    rows: [
      { kind: 'tile', label: 'wall', tile: Tl.WALL },
      { kind: 'tile', label: 'hut', tile: Tl.HUT },
      { kind: 'tile', label: 'well', tile: Tl.WELL },
      { kind: 'tile', label: 'standing stone', tile: Tl.STONE },
      { kind: 'tile', label: 'altar', tile: Tl.ALTAR, note: 'the upgrade ritual' },
      { kind: 'tile', label: 'shrine', tile: Tl.SHRINE, note: 'not drawn at T0' },
    ],
  },
  {
    title: 'SCARS & PUZZLE',
    rows: [
      { kind: 'tile', label: 'burnt stump', tile: Tl.STUMP },
      { kind: 'tile', label: 'cracked stone', tile: Tl.CRACK },
      { kind: 'tile', label: 'ruin', tile: Tl.RUIN },
      { kind: 'tile', label: 'pushstone', tile: Tl.PUSH, note: 'fords a river' },
    ],
  },
  {
    title: 'OBJECTS',
    rows: [
      { kind: 'shard', label: 'shard', note: 'tape / floppy / CD' },
      { kind: 'bolt', label: 'firebolt', wand: 'fire' },
      { kind: 'bolt', label: 'icebolt', wand: 'ice' },
      { kind: 'pedestal', label: 'wand pedestal', wand: 'ice', note: 'shows the wand you swap to' },
    ],
  },
  {
    title: 'THE ATTRIBUTE RULE',
    rows: [
      {
        kind: 'scene', label: 'wizard on grass, tree behind',
        note: 'to T1 the sprite owns the whole cell; from T2 it does not',
      },
    ],
  },
  {
    title: 'AVATARS — walk cycle, every distinct pose',
    rows: [
      { kind: 'walk', label: 'player', rival: false },
      { kind: 'walk', label: 'Kernagh', rival: true },
    ],
  },
];

// The blog-sized cut: one row per idea rather than per asset.
const COMPACT: Group[] = [
  {
    title: 'WORLD',
    rows: [
      { kind: 'tile', label: 'tree', tile: Tl.TREE },
      { kind: 'tile', label: 'water', tile: Tl.WATER },
      { kind: 'shard', label: 'shard', note: 'tape / floppy / CD' },
      {
        kind: 'scene', label: 'wizard on grass, tree behind',
        note: 'to T1 the sprite owns the whole cell; from T2 it does not',
      },
    ],
  },
  {
    title: 'AVATAR — every distinct walk pose',
    rows: [{ kind: 'walk', label: 'player', rival: false }],
  },
];

// ---------- rendering samples out of real frames ----------

// Samples are laid out on a 4x4-tile pitch so each 2x2 patch keeps a bare-earth
// border: no attribute cell is ever shared between two samples.
const PATCH = 16;
function slotOf(i: number): { px: number; py: number } {
  return { px: (i % 8) * 32 + 8, py: Math.floor(i / 8) * 32 + 8 };
}

function renderStatics(tier: number, samples: Sample[]): ImageData[] {
  const g = makeGame();
  const w = g.world;
  g.player.tier = tier;
  g.rival.tier = tier;

  samples.forEach((s, i) => {
    const { px, py } = slotOf(i);
    if (s.kind === 'tile') {
      const tx = px >> 3, ty = py >> 3;
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) w.tiles[(ty + y) * WORLD_TW + (tx + x)] = s.tile;
      }
    } else if (s.kind === 'shard') {
      g.shards.push({ x: px + 8, y: py + 8 });
    } else if (s.kind === 'bolt') {
      g.bolts.push({
        x: px + 8, y: py + 8, vx: 0, vy: 0, life: 1,
        fromRival: false, tier, kind: s.wand,
      });
    } else if (s.kind === 'pedestal') {
      // Sits low in the patch: the glyph is drawn five pixels above the pad.
      w.pStationX = px + 8;
      w.pStationY = py + 11;
      // The pedestal advertises the wand you'd swap TO, so hold the other one.
      g.player.wand = s.wand === 'ice' ? 'fire' : 'ice';
    }
  });

  renderPlay(offCtx, g, tier);
  return samples.map((_, i) => {
    const { px, py } = slotOf(i);
    return offCtx.getImageData(px, py, PATCH, PATCH);
  });
}

// Avatar poses get their own passes: a Game holds only two entities, and the
// pose set has to be enumerated one animation distance at a time.
const AV_X = 64, AV_Y = 64;      // multiples of 8: no positional jitter from quantPos
const AV_CROP = 24;

// The walk frame and the bob run on different periods, and above T3 the bob is
// a sine — so the pose set only closes after the two drift through each other.
// A short window silently under-counts: sampling to 48 misses two of T4's six
// poses. Sample far past convergence and stop once nothing new has appeared.
const WALK_SAMPLES = 240;
const WALK_PATIENCE = 120;

const poseCache = new Map<string, ImageData[]>();

function walkPoses(tier: number, rival: boolean): ImageData[] {
  const cacheKey = `${tier}:${rival}`;
  const hit = poseCache.get(cacheKey);
  if (hit) return hit;

  const g = makeGame();
  g.player.tier = tier;
  g.rival.tier = tier;
  const e = rival ? g.rival : g.player;
  e.x = AV_X;
  e.y = AV_Y;
  e.facing = 3;   // walking right, so the cycle reads left-to-right

  const seen = new Set<string>();
  const out: ImageData[] = [];
  let sinceNew = 0;
  for (let d = 0; d < WALK_SAMPLES && sinceNew < WALK_PATIENCE; d++, sinceNew++) {
    e.animDist = d;
    renderPlay(offCtx, g, tier);
    const img = offCtx.getImageData(AV_X - 12, AV_Y - 12, AV_CROP, AV_CROP);
    const key = fingerprint(img);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(img);
      sinceNew = 0;
    }
  }
  poseCache.set(cacheKey, out);
  return out;
}

// The clash demo, and the reason the sheet has a scene row at all.
//
// Two identical trees: the left one shares an 8x8 attribute cell with the
// wizard, the right one does not. Up to T1 a sprite forces its ink across every
// cell it touches, so the left tree turns wizard-coloured while its twin stays
// green — the Spectrum's one-colour-per-cell rule, visible as a side-by-side.
// From T2 sprites carry their own colour and both trees are left alone.
const SCENE_CROP = 32;

function sceneCell(tier: number): ImageData {
  const g = makeGame();
  g.player.tier = tier;
  g.rival.tier = tier;
  const w = g.world;
  const atx = AV_X >> 3, aty = AV_Y >> 3;   // cells the 16x16 sprite sits in: atx-1..atx, aty-1..aty
  for (let ty = aty - 3; ty <= aty + 3; ty++) {
    for (let tx = atx - 3; tx <= atx + 3; tx++) w.tiles[ty * WORLD_TW + tx] = Tl.GRASS;
  }
  w.tiles[(aty - 1) * WORLD_TW + (atx - 1)] = Tl.TREE;   // shares a cell with the sprite
  w.tiles[(aty - 1) * WORLD_TW + (atx + 1)] = Tl.TREE;   // control: no cell shared
  g.player.x = AV_X;
  g.player.y = AV_Y;
  g.player.facing = 3;
  renderPlay(offCtx, g, tier);
  return offCtx.getImageData(AV_X - 16, AV_Y - 16, SCENE_CROP, SCENE_CROP);
}

// ---------- sheet layout ----------

const SCALE = 3;
const CELL = PATCH * SCALE;        // 48
const POSE = AV_CROP * SCALE;      // 72
const POSE_GAP = 6;
const POSES_PER_ROW = 3;
const COL_W = POSE * POSES_PER_ROW + POSE_GAP * (POSES_PER_ROW - 1) + 20;
const LAB_W = 178;
const TITLE_H = 56;
const HEAD_H = 72;
const GROUP_H = 30;
const ROW_H = CELL + 22;
const WALK_H = POSE * 2 + POSE_GAP + 26;
const FOOT_H = 92;
const PAD = 16;

const BG = '#14141c';
const FG = '#dcdce6';
const DIM = '#8a8a9c';
const RULE = '#2e2e42';
const ACCENT = '#ffd84a';

// Short, code-sourced notes on what each tier's palette rules actually are.
const PALETTE_NOTE = [
  '1-bit, 4x4 blocks',
  '2 inks per 8x8 cell',
  'sprites leave the grid',
  '16 fixed (VIC-II)',
  '16 of 512',
  '32+, parallax',
];

const SCENE_H = SCENE_CROP * SCALE + 22;

// Labels get their own column and must stay in it.
function wrap(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && c.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function isStatic(s: Sample): boolean {
  return s.kind !== 'walk' && s.kind !== 'scene';
}

function rowHeight(s: Sample): number {
  return s.kind === 'walk' ? WALK_H : s.kind === 'scene' ? SCENE_H : ROW_H;
}

export function buildSheet(canvas: HTMLCanvasElement, variant: 'full' | 'compact'): void {
  const groups = variant === 'compact' ? COMPACT : FULL;
  const statics = groups.flatMap(gr => gr.rows).filter(isStatic);

  // Render everything up front: statics in one pass per tier, poses and scenes
  // in their own passes (both are cached across variants).
  const staticCells: ImageData[][] = [];      // [tier][staticIndex]
  const sceneCells: ImageData[] = [];         // [tier]
  const poseCells = new Map<string, ImageData[]>();   // `${tier}:${rival}`
  for (let t = 0; t < TIERS.length; t++) {
    staticCells.push(renderStatics(t, statics));
    sceneCells.push(sceneCell(t));
    for (const gr of groups) {
      for (const r of gr.rows) {
        if (r.kind === 'walk') poseCells.set(`${t}:${r.rival}`, walkPoses(t, r.rival));
      }
    }
  }

  let h = PAD + TITLE_H + HEAD_H;
  for (const gr of groups) {
    h += GROUP_H;
    for (const r of gr.rows) h += rowHeight(r);
  }
  h += FOOT_H + PAD;

  canvas.width = LAB_W + COL_W * TIERS.length + PAD * 2;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;

  c.fillStyle = BG;
  c.fillRect(0, 0, canvas.width, canvas.height);

  const colX = (t: number): number => PAD + LAB_W + t * COL_W;

  // --- title band, then the tier headers on their own row
  c.textBaseline = 'alphabetic';
  c.fillStyle = FG;
  c.font = 'bold 22px ui-monospace, Menlo, monospace';
  c.fillText('UPGRADE — assets by tier', PAD, PAD + 24);
  c.fillStyle = DIM;
  c.font = '12px ui-monospace, Menlo, monospace';
  c.fillText(
    'the upgrades improve the game, not the wizard — every cell here is cropped from a real render',
    PAD, PAD + 44,
  );

  const headY = PAD + TITLE_H;
  for (let t = 0; t < TIERS.length; t++) {
    const x = colX(t);
    c.fillStyle = ACCENT;
    c.font = 'bold 26px ui-monospace, Menlo, monospace';
    c.fillText(`T${t}`, x, headY + 26);
    c.fillStyle = FG;
    c.font = '13px ui-monospace, Menlo, monospace';
    c.fillText(TIERS[t].name, x, headY + 46);
    c.fillStyle = DIM;
    c.font = '11px ui-monospace, Menlo, monospace';
    c.fillText(PALETTE_NOTE[t], x, headY + 62);
  }

  let y = headY + HEAD_H;
  c.strokeStyle = RULE;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(PAD, y - 8);
  c.lineTo(canvas.width - PAD, y - 8);
  c.stroke();

  // --- rows
  let staticI = 0;
  for (const gr of groups) {
    c.fillStyle = ACCENT;
    c.font = 'bold 12px ui-monospace, Menlo, monospace';
    c.fillText(gr.title, PAD, y + 20);
    y += GROUP_H;

    for (const r of gr.rows) {
      const rh = rowHeight(r);

      const labMax = LAB_W - 14;
      c.fillStyle = FG;
      c.font = '13px ui-monospace, Menlo, monospace';
      let ly = y + 18;
      for (const line of wrap(c, r.label, labMax)) {
        c.fillText(line, PAD, ly);
        ly += 16;
      }
      if (r.note) {
        c.fillStyle = DIM;
        c.font = '11px ui-monospace, Menlo, monospace';
        for (const line of wrap(c, r.note, labMax)) {
          c.fillText(line, PAD, ly);
          ly += 14;
        }
      }

      for (let t = 0; t < TIERS.length; t++) {
        const x = colX(t);
        if (r.kind === 'scene') {
          blit(c, sceneCells[t], x, y, SCALE);
        } else if (r.kind === 'walk') {
          const poses = poseCells.get(`${t}:${r.rival}`)!;
          poses.forEach((p, i) => {
            const px = x + (i % POSES_PER_ROW) * (POSE + POSE_GAP);
            const py = y + Math.floor(i / POSES_PER_ROW) * (POSE + POSE_GAP);
            blit(c, p, px, py, SCALE);
          });
          c.fillStyle = poses.length > 1 ? FG : DIM;
          c.font = '11px ui-monospace, Menlo, monospace';
          c.fillText(
            `${poses.length} pose${poses.length === 1 ? '' : 's'}`,
            x, y + POSE * 2 + POSE_GAP + 16,
          );
        } else {
          blit(c, staticCells[t][staticI], x, y, SCALE);
        }
      }

      if (isStatic(r)) staticI++;
      y += rh;

      c.strokeStyle = RULE;
      c.beginPath();
      c.moveTo(PAD, y - 8);
      c.lineTo(canvas.width - PAD, y - 8);
      c.stroke();
    }
  }

  // --- footer: the numbers that make the ladder legible
  c.fillStyle = DIM;
  c.font = '11px ui-monospace, Menlo, monospace';
  c.fillText('movement step', PAD, y + 18);
  c.fillText('avatar renders as', PAD, y + 38);
  c.fillText('pipeline', PAD, y + 58);

  for (let t = 0; t < TIERS.length; t++) {
    const x = colX(t);
    c.fillStyle = FG;
    c.font = '12px ui-monospace, Menlo, monospace';
    c.fillText(`${TIERS[t].quant}px`, x, y + 18);
    c.fillText(t === 0 ? 'mono glyph' : t <= 2 ? '2-colour sprite' : 'full colour', x, y + 38);
    c.fillText(t <= 2 ? 'attribute' : 'direct', x, y + 58);
  }

  c.fillStyle = DIM;
  c.font = '11px ui-monospace, Menlo, monospace';
  c.fillText(
    'Poses are de-duplicated by pixel content, so the counts above are whatever the renderers actually produce.',
    PAD, y + FOOT_H - 12,
  );
}
