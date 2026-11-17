// Tiny 3x5 bitmap font, drawn as 1px rects so it stays authentically chunky.

const F: Record<string, number[]> = {
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b011, 0b100, 0b101, 0b101, 0b011],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b010],
  K: [0b101, 0b110, 0b100, 0b110, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b110, 0b101, 0b101, 0b101, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010],
  P: [0b110, 0b101, 0b110, 0b100, 0b100],
  Q: [0b010, 0b101, 0b101, 0b010, 0b001],
  R: [0b110, 0b101, 0b110, 0b110, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b011, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  ' ': [0, 0, 0, 0, 0],
  '-': [0, 0, 0b111, 0, 0],
  ':': [0, 0b010, 0, 0b010, 0],
  '.': [0, 0, 0, 0, 0b010],
  ',': [0, 0, 0, 0b010, 0b100],
  '!': [0b010, 0b010, 0b010, 0, 0b010],
  '?': [0b110, 0b001, 0b010, 0, 0b010],
  '/': [0b001, 0b001, 0b010, 0b100, 0b100],
  '(': [0b001, 0b010, 0b010, 0b010, 0b001],
  ')': [0b100, 0b010, 0b010, 0b010, 0b100],
  '♥': [0b101, 0b111, 0b111, 0b010, 0],
  '◆': [0b010, 0b111, 0b010, 0, 0],
  '>': [0b100, 0b010, 0b001, 0b010, 0b100],
};

// Font mode: 0 = the 3x5 bitmap (every tier up to the Amiga); 1 = a crisp
// system face with its anti-aliasing thresholded away (T6: bitmap GUI fonts);
// 2 = the same face left smooth (T7: sub-pixel-rendered text). Modes 1-2 fit
// each string into the box the bitmap font would have occupied, so every
// caller's layout arithmetic (textWidth) holds at any mode.
let fontMode = 0;
export function setFontMode(m: number): void { fontMode = m; }

const FACE = 'Tahoma, Verdana, "Trebuchet MS", "Helvetica Neue", Arial, sans-serif';
const crispCache = new Map<string, HTMLCanvasElement>();

function hiText(
  ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale: number,
): void {
  const S = ctx.getTransform().a;
  const str = s.toUpperCase().replace(/♥/g, '♥\uFE0E');
  const boxW = textWidth(s, scale) * S;
  const px = Math.round(6.6 * scale * S);
  const font = `bold ${px}px ${FACE}`;
  if (fontMode === 2) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const cx = x * S + boxW / 2, cy = (y + 2.6 * scale) * S;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(str, cx + S * 0.25, cy + S * 0.3, boxW);
    ctx.fillStyle = color;
    ctx.fillText(str, cx, cy, boxW);
    ctx.restore();
    return;
  }
  const key = `${px}|${color}|${str}`;
  let cv = crispCache.get(key);
  if (!cv) {
    if (crispCache.size > 400) crispCache.clear();
    cv = document.createElement('canvas');
    const m = cv.getContext('2d')!;
    m.font = font;
    const w = Math.max(1, Math.ceil(m.measureText(str).width) + 2);
    cv.width = w; cv.height = px + 6;
    const k = cv.getContext('2d', { willReadFrequently: true })!;
    k.font = font;
    k.textBaseline = 'middle';
    k.fillStyle = color;
    k.fillText(str, 1, cv.height / 2);
    const id = k.getImageData(0, 0, cv.width, cv.height);
    for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] >= 96 ? 255 : 0;
    k.putImageData(id, 0, 0);
    crispCache.set(key, cv);
  }
  const dw = Math.min(cv.width, boxW + 2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cv, Math.round(x * S + (boxW - dw) / 2), Math.round((y + 2.6 * scale) * S - cv.height / 2), dw, cv.height);
  ctx.restore();
}

export function drawText(
  ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale = 1,
): void {
  if (fontMode > 0) { hiText(ctx, s, x, y, color, scale); return; }
  ctx.fillStyle = color;
  let cx = x;
  for (const raw of s.toUpperCase()) {
    const g = F[raw] ?? F[' '];
    for (let r = 0; r < 5; r++) {
      const bits = g[r];
      for (let b = 0; b < 3; b++) {
        if (bits & (0b100 >> b)) ctx.fillRect(cx + b * scale, y + r * scale, scale, scale);
      }
    }
    cx += 4 * scale;
  }
}

export function textWidth(s: string, scale = 1): number {
  return s.length * 4 * scale - scale;
}
