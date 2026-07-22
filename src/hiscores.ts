// Persistent hi-score table (localStorage; per-browser).

export interface ScoreEntry { name: string; score: number; mode: string }

const KEY = 'upgrade-hiscores';
export const MAX_ENTRIES = 8;

let cache: ScoreEntry[] | null = null;

export function loadScores(): ScoreEntry[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as ScoreEntry[];
    cache = raw.filter(e => typeof e.score === 'number' && typeof e.name === 'string');
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
