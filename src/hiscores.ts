// Persistent hi-score table (localStorage today; see DESIGN.md for the
// planned server-backed hall). Entries carry the map they were set on so
// players can compare like with like across contributed maps.

export interface ScoreEntry { name: string; score: number; mode: string; map: string }

const KEY = 'upgrade-hiscores';
export const MAX_ENTRIES = 8;
export const DEFAULT_MAP = 'VALE';

let cache: ScoreEntry[] | null = null;

export function loadScores(): ScoreEntry[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as ScoreEntry[];
    cache = raw
      .filter(e => typeof e.score === 'number' && typeof e.name === 'string')
      .map(e => ({ ...e, map: e.map || DEFAULT_MAP }));
  } catch {
    cache = [];
  }
  return cache;
}

export function qualifies(score: number): boolean {
  if (score <= 0) return false;
  const s = loadScores();
  return s.length < MAX_ENTRIES || score > s[s.length - 1].score;
}

export function addScore(e: ScoreEntry): void {
  cache = [...loadScores(), e].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
}

// --- map filter for the Hall screen: null = all maps, else a specific map.
let filterIdx = 0;

function mapsInTable(): string[] {
  return [...new Set(loadScores().map(e => e.map))].sort();
}

export function activeMapFilter(): string | null {
  const maps = mapsInTable();
  if (filterIdx === 0 || !maps.length) return null;
  return maps[(filterIdx - 1) % maps.length];
}

export function cycleMapFilter(): void {
  filterIdx = (filterIdx + 1) % (mapsInTable().length + 1);
}

export function filteredScores(): ScoreEntry[] {
  const f = activeMapFilter();
  return f ? loadScores().filter(e => e.map === f) : loadScores();
}
