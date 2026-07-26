// Page wiring for the asset matrix. Builds both variants and offers PNGs.
// Also exposes hooks so the sheet can be captured headlessly for the README.

import { buildSheet } from './assetsheet';

const full = document.getElementById('full') as HTMLCanvasElement;
const compact = document.getElementById('compact') as HTMLCanvasElement;
const status = document.getElementById('status')!;

function download(canvas: HTMLCanvasElement, name: string): void {
  const a = document.createElement('a');
  a.download = name;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

const t0 = performance.now();
buildSheet(full, 'full');
buildSheet(compact, 'compact');
status.textContent = `built in ${Math.round(performance.now() - t0)}ms`;

document.getElementById('dl-full')!.addEventListener('click', () => download(full, 'asset-matrix.png'));
document.getElementById('dl-compact')!.addEventListener('click', () =>
  download(compact, 'asset-matrix-compact.png'));

const hooks = window as unknown as Record<string, unknown>;
hooks['__sheetPNG'] = (variant: string): string =>
  (variant === 'compact' ? compact : full).toDataURL('image/png');
hooks['__sheetReady'] = true;
