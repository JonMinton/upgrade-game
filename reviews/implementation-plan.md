# Performance implementation plan

Synthesized from the three reviews in this directory (Gemini, GPT-5.4, Opus 5),
verified against the code at `bcc54e3`.

## How the reviews compare

- **Gemini** assumed the slowdown is the T3+ renderer and led with the cloud
  gradient. No measurements; its headline fix is worth ~nothing per Opus's
  numbers (T4/T5 add <100 µs over T3). Least useful.
- **GPT-5.4** read the structure correctly and found every real code smell —
  including the watchdog re-entrancy — but ranked the renderer first and the
  watchdog last, inverting the true priority.
- **Opus 5** measured everything: full `render()` is under 1 ms at every tier
  (~6% of a 16.7 ms frame), so the renderer cannot be the cause of sustained
  slowdown. The real causes are two session-cumulative bugs: the watchdog
  forking the rAF loop (permanent Nx multiplication after any hidden-tab period
  or >150 ms stall), and `newGame()` costing up to ~650 ms on a well-played map
  (O(visits) CA replay + O(scars) flood fills + a ledger that never shrinks).
  The two interact: the `newGame()` stall triggers the watchdog, so every
  restart on an aged map permanently adds a loop chain.

Where the reviews disagree, Opus's empirical data wins. The plan below fixes
the loop and session-growth bugs first and treats the renderer as optional.

## Phase 1 — Frame loop / watchdog (critical, ~15 lines)

`src/main.ts:287, 294-297`

- Split `frame()` into `tick(now)` (update + render) and `schedule()`.
- Guard scheduling with a single-in-flight `rafId` (`if (rafId) return;`).
- Watchdog: return early when `document.visibilityState === 'visible'`;
  otherwise call `tick(now)` only — never re-arm rAF from the interval.
- Skip `render()` on the watchdog path (nothing composites while hidden).
- On `visibilitychange` → visible, reset `lastFrameAt` and `schedule()` once.

Acceptance: with the tab hidden 30 s, pending rAF callbacks stay ≤ 1 (Opus's
probe showed 31 before the fix, held forever after).

## Phase 2 — `newGame()` stall and unbounded growth

### 2a. Batch `poisOk()` in `applyDamage()` (`src/evolve.ts:169-179`, ~15 lines)

Stamp all scars, run **one** reachability check; only on failure revert the
solid scars and re-add one-by-one with per-scar checks (the check is monotonic,
so the batch test is sound). 737 ms → ~1.4 ms at 500 scars.

### 2b. Prune the scar ledger in `saveDamage()` (`src/evolve.ts:194-207`, ~10 lines)

- Drop `Tl.DIRT` entries when writing (they encode "nothing here").
- Give `Tl.PUSH` a decay branch so it is not an immortal solid scar —
  **design decision**: "the valley keeps its levers" may be intentional; if so,
  keep PUSH but exclude settled pushstones from the per-scar flood cost via 2a
  and cap the ledger size (evict oldest) as a backstop.

### 2c. Cache evolved generations (`src/game.ts:48, 54`, moderate)

The CA is deterministic per `(mapName, generation)`. Persist the latest evolved
`Uint8Array` (e.g. `upgrade-evocache-<map>` storing `{gen, tiles}`), and on
`newGame()` evolve only the missing steps from the cached snapshot instead of
replaying 1..n from genesis. Invalidate when the base map changes
(`upgrade-map` write) and in `resetWorldState()`. 193 ms → ~5 ms at the 40-visit
cap.

## Phase 3 — Shared allocation-free flood/BFS helper (moderate, 11.7×)

`src/map.ts:87` plus call sites in `ai.ts`, `evolve.ts`, `rulegen.ts`.

- One `flood()` helper: hoisted neighbour offsets (no `[[1,0],...]` per node),
  reused `Int32Array` queue, `Uint8Array` solid lookup table.
- Export `SOLID_LUT` alongside the `SOLID` set and use it in `solidTile()`.
- Verify bit-identical output against the old implementation before swapping.

Multiplies through Phase 2 (evolve, applyDamage, placePushstone, rulegen
bridge passes) and every AI search.

## Phase 4 — Upgrade ripple (~10 lines)

`src/render.ts:1045-1068`

- Render the old-tier scene **once** at ripple start into `offA`; per-frame,
  render only `offB` and composite.
- Cache the two offscreen 2d contexts; create the canvases eagerly at module
  load, not lazily mid-upgrade.

## Phase 5 — Quick wins (each ≤ a few lines)

- `src/ai.ts:158-160` — hoist `berryTarget(g)` so it runs once per decision.
- `src/game.ts:548` — prune `g.fx` in place (reverse loop + splice) like
  `bolts`/`burns` already do.
- `src/render.ts:628` — pre-render one cloud-shadow sprite to a small offscreen
  canvas; `drawImage` at offsets instead of `createRadialGradient` per frame.

## Deferred (do only if targeting weak hardware, after measuring)

- Static terrain cache per screen for T3+ (`render.ts:560-565`): blit one
  offscreen canvas, redraw only animated tiles; invalidate on ignite/crack/
  pushstone events. ~600 µs → <200 µs scene cost.
- CRT mode (`index.html:36-50`): the `blur()` filter over the upscaled canvas is
  compositor-side and invisible to `__bench`; if post-win slowdown is reported,
  drop the blur or bake scanlines into the 256×192 canvas.
- Font/sprite atlas to replace per-pixel `fillRect` (~900 calls/frame for HUD).

## Verification

- Before/after timings via the existing `window.__bench` hook at each tier.
- Time `newGame()` on a synthetic 40-visit + 300-scar ledger (Opus's scenario).
- Hidden-tab probe for pending rAF count (Phase 1 acceptance).
- Play-test a full T0→T5 run plus one hard-mode restart on an aged map.
