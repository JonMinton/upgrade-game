// UPGRADE — entry point.
// Placeholder scene: proves out the Spectrum-style attribute-cell rendering that
// tier T1 is built around. Real game loop, map, and entities come next.

const TIER_NAMES = [
  "T0 1979 MONO",
  "T1 SPECTRUM 48K",
  "T2 SPECTRUM 128",
  "T3 8-BIT SPRITES",
  "T4 ST/EGA",
  "T5 AMIGA",
] as const;

// Spectrum palette: normal then BRIGHT variants.
const SPECTRUM_INK = [
  "#000000", "#0000d7", "#d70000", "#d700d7",
  "#00d700", "#00d7d7", "#d7d700", "#d7d7d7",
  "#000000", "#0000ff", "#ff0000", "#ff00ff",
  "#00ff00", "#00ffff", "#ffff00", "#ffffff",
];

const CELL = 8; // one attribute cell: 8×8 px, 1 ink + 1 paper colour

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function drawAttributeDemo(t: number): void {
  const cols = canvas.width / CELL;
  const rows = canvas.height / CELL;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      // Each 8×8 cell gets exactly one paper colour — the attribute grid made visible.
      const wave = Math.sin(cx / 4 + t / 600) + Math.cos(cy / 3 + t / 800);
      const paper = SPECTRUM_INK[(Math.abs(Math.round(wave * 3)) % 8) + 8];
      ctx.fillStyle = paper;
      ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
    }
  }
  ctx.fillStyle = "#000000";
  ctx.fillRect(4 * CELL, 10 * CELL, 24 * CELL, 3 * CELL);
  ctx.fillStyle = "#ffffff";
  ctx.font = "8px monospace";
  ctx.textBaseline = "top";
  ctx.fillText("UPGRADE", 13 * CELL, 11 * CELL);
  ctx.fillText(TIER_NAMES[1], 10 * CELL, 12 * CELL);
}

function frame(t: number): void {
  drawAttributeDemo(t);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
