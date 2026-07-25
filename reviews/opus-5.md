# Opus 5 — performance review

Reviewed at commit `cbed8cf`. All numbers below are **measured**, not estimated:
Chrome on an M-series MacBook, Vite dev server, via the `window.__bench` /
`window.__game` hooks and direct module imports. Timings on a low-end machine
will be perhaps 5–10× worse; the *ratios* are what matter.

---

## What this is

A ~4,000-line TypeScript game, no engine, Canvas 2D + WebAudio, built with Vite.
A 256×192 canvas (176px play area + 16px HUD), CSS-upscaled with
`image-rendering: pixelated`. The world is 192×88 tiles arranged as a 6×4 grid
of flick-screens.

The conceit: upgrades improve *the game itself*, walking a fidelity ladder from
1979 mono (T0) to Amiga (T5). That drives the architecture's one big split:

| Module | Role |
|---|---|
| `src/main.ts` | Bootstrap, input, frame loop, mode transitions, background watchdog |
| `src/game.ts` | Simulation: movement, combat, pickups, rituals, pushstones, fire spread, camera |
| `src/render.ts` | **Two** renderers — an attribute/bitmap pipeline (T0–T2) and a direct Canvas 2D pipeline (T3–T5) |
| `src/ai.ts` | Kernagh: BFS pathfinding + short-horizon target selection |
| `src/map.ts` / `src/rulegen.ts` | World generation, collision, pushstone validation |
| `src/evolve.ts` | Between-game cellular automaton ("the living valley") + persistent combat-scar ledger |
| `src/audio.ts` | Chip-synth score, arranged per tier |
| `src/sprites.ts` / `src/font.ts` | 1-bit patterns, 16×16 avatar masks, 3×5 bitmap font |

The code is clean, well-commented and unusually well-factored for a game this
size. The performance problems are **not** where the design intuition points.

---

## Headline finding

> The T3+ renderer is **not** what makes the game slow.
>
> Two session-cumulative bugs are — one of which degrades the game
> *permanently*, by an unbounded factor, and is triggered by simply switching
> browser tab.

Measured render cost, worst-case screen (163 trees), full `render()`:

| Env tier | Scene | HUD/text | Total | Share of a 16.7 ms frame |
|---|---|---|---|---|
| T0 | 245 µs | 60 µs | 305 µs | 1.8% |
| T1 | 199 µs | 62 µs | 261 µs | 1.6% |
| T2 | 216 µs | 56 µs | 272 µs | 1.6% |
| **T3** | **582 µs** | 149 µs | **731 µs** | 4.4% |
| T4 | 617 µs | 241 µs | 858 µs | 5.1% |
| T5 | 599 µs | 160 µs | 759 µs | 4.5% |

There *is* a real step at T2→T3 (2.7× the scene cost) where the pipeline
switches from bitmap to immediate-mode Canvas 2D. But it is a step, not a
climb — T4 and T5 add almost nothing on top of T3, so the animated extras
(sway, water phase, cloud shadows) are cheap. At **under 1 ms**, the renderer
has ~16 ms of headroom. `update()` including all AI/BFS costs **0.12–0.15 ms**.

So on a healthy frame the game uses about 1 ms of a 16.7 ms budget. If players
report the game getting slow "once you're at T3 and beyond", the cause is
almost certainly Finding 1 — which correlates with T3+ only because reaching
T3+ means *having played for a while*.

---

## Finding 1 — The watchdog permanently multiplies the frame loop (critical)

`src/main.ts:294-297`, `src/main.ts:156`, `src/main.ts:287`

```ts
function frame(now: number): void {
  lastFrameAt = now;
  ...
  render(ctx, g, now / 1000);
  requestAnimationFrame(frame);      // main.ts:287 — every frame() re-arms rAF
}

setInterval(() => {
  const now = performance.now();
  if (now - lastFrameAt > 150) frame(now);   // main.ts:296 — and so does this one
}, 100);
```

The watchdog exists to keep the world simulating when `requestAnimationFrame`
stalls in a hidden tab. But `frame()` **always** schedules another
`requestAnimationFrame` at its tail. So every watchdog-driven call *forks a new
copy of the loop*.

While the tab is hidden, rAF never fires, so nothing consumes those
registrations — they queue. Measured on the real game, tab hidden:

```
t= 2s  registered=3   executed=0   PENDING rAF callbacks=3
t= 4s  registered=5   executed=0   PENDING rAF callbacks=5
t= 6s  registered=8   executed=0   PENDING rAF callbacks=8
t= 8s  registered=11  executed=0   PENDING rAF callbacks=11
t=10s  registered=14  executed=0   PENDING rAF callbacks=14
```

Unbounded, linear, nothing consumed. When the tab becomes visible again, the
spec says all queued callbacks run in a single animation frame — and each one
re-arms another rAF. The multiplicity therefore **never decays**. Verified with
a faithful replica of this exact loop driven by a synthetic clock:

```
running normally:      1 frame() per animation frame
hidden  10s ->  11 pending | burst frame:  11 frame() calls | steady state afterwards: 11x forever
hidden  30s ->  31 pending | burst frame:  31 frame() calls | steady state afterwards: 31x forever
hidden  60s ->  61 pending | burst frame:  61 frame() calls | steady state afterwards: 61x forever
hidden 300s -> 301 pending | burst frame: 301 frame() calls | steady state afterwards: 301x forever
```

**Consequences**

- Alt-tab away for one minute, come back: the game runs 61 full update+render
  passes per animation frame, forever. At the measured T5 cost that is
  ~59 ms/frame → ~17 fps, and at T3+ it tips over first because the renderer is
  3× costlier there. This matches the reported symptom exactly.
- It compounds. Each backgrounding adds more chains; nothing ever removes them.
- It does not need a hidden tab. **Any** main-thread stall >150 ms lets the
  watchdog fire while a normal rAF is already pending, permanently doubling the
  loop. Finding 2 supplies a 200–650 ms stall on every single restart.
- Because all N callbacks receive the same timestamp, `dt` is ~0 for all but the
  first, so the *simulation* stays correct — which is why this hides so well.
  It burns pure CPU and battery.

**Fix.** Separate "tick" from "schedule", and make the watchdog visibility-aware
and non-reentrant:

```ts
let rafId = 0;

function frame(now: number): void {
  rafId = 0;
  tick(now);                      // update + render, no scheduling
  schedule();
}

function schedule(): void {
  if (rafId) return;              // never more than one in flight
  rafId = requestAnimationFrame(frame);
}

schedule();

setInterval(() => {
  if (document.visibilityState === 'visible') return;   // rAF owns the visible case
  const now = performance.now();
  if (now - lastFrameAt > 150) tick(now);               // simulate only; do NOT re-arm rAF
}, 100);
```

Cancelling on `visibilitychange` and re-arming once on return is also worth
doing. Consider skipping `render()` entirely on the watchdog path — there is no
compositor to draw to while hidden, so it is pure waste.

This is a ~15-line change and by far the highest-value fix in the codebase.

---

## Finding 2 — `newGame()` stalls for up to two thirds of a second, and grows without bound

`src/game.ts:44-58`, `src/evolve.ts:169-179`, `src/evolve.ts:79`

`newGame()` rebuilds the world from genesis every time: regenerate, then replay
**every** CA generation the map has ever accrued, then stamp the scar ledger.

Measured, clean GLEN:

| State | `newGame()` |
|---|---|
| Fresh map, 0 visits | 31 ms |
| 40 visits (the `EVO_CAP`), 0 scars | **203 ms** |
| 40 visits + 100 scars | **350 ms** |
| 40 visits + 300 scars | **644 ms** |

Component costs:

| Operation | Cost |
|---|---|
| `ruleGenTiles()` | 17 ms |
| `evolveTiles()`, one generation | 5.2 ms |
| `evolveTiles()` × 40 generations | **193 ms** |
| `floodFrom()`, one full flood | 1.37 ms |
| `applyDamage()`, 50 solid scars | 72 ms |
| `applyDamage()`, 200 solid scars | 290 ms |
| `applyDamage()`, 500 solid scars | **737 ms** |

Two separate problems.

**2a. Generation replay is O(visits).** `game.ts:48` and `game.ts:54` replay
generations 1..n from scratch on every new game. Generation 40 is derived by
recomputing 1–39 first, every time. The result is deterministic per
`(mapName, generation)` — so cache it. Store the evolved `Uint8Array` under
`upgrade-evocache-<map>-<gen>` (16.9 KB, base64 or `Array.from`) and evolve
one step from the cached previous generation. That turns 193 ms into 5 ms.

**2b. `applyDamage()` is O(scars × full-map-flood).** `evolve.ts:169-179` calls
`poisOk()` once *per solid scar*, and each `poisOk()` scans all 16,896 tiles to
collect POIs and then runs a complete flood fill — ~1.45 ms apiece.

The batching fix is straightforward, because the check is monotonic (adding
solid tiles can only ever remove reachability):

```ts
export function applyDamage(tiles: Uint8Array, mapName: string): void {
  const dmg = loadDamage(mapName);
  const solid: Array<[number, number]> = [];      // [index, previousTile]
  for (const [k, t] of Object.entries(dmg)) {
    const i = +k;
    if (!(i >= 0 && i < tiles.length)) continue;
    if (!DMG_SOLID.has(t)) { tiles[i] = t; continue; }
    solid.push([i, tiles[i]]);
    tiles[i] = t;
  }
  if (solid.length && poisOk(tiles) === false) {   // ONE check for the common case
    for (const [i, keep] of solid) tiles[i] = keep; // revert all, then re-add
    for (const [i] of solid) {                      // one-by-one only on the rare failure
      const keep = tiles[i];
      tiles[i] = dmg[i];
      if (poisOk(tiles) === false) tiles[i] = keep;
    }
  }
}
```

In the overwhelmingly common case (scars don't break the map) this is **one**
flood instead of N: 737 ms → ~1.4 ms.

**2c. The ledger never shrinks — this is unbounded growth.** In
`saveDamage()` (`evolve.ts:194-207`), every key in the ledger is written
straight back out via `next[k] = nt`. Entries are never deleted. Worse, the
weathering table has two absorbing states:

- `Tl.DIRT` — no branch matches, so `nt = t` forever. Harmless but permanent
  (walkable, so it skips `poisOk`).
- `Tl.PUSH` — likewise no branch matches, so a pushstone entry is immortal
  **and** it is in `DMG_SOLID`, so it costs a full flood at every `newGame()`
  from then on.

Stumps convert to `PUSH` with p=0.07 and cracks with p=0.05 per completed game,
so the count of immortal solid entries only ever ratchets upward. There is no
equilibrium. A heavily-played map's `newGame()` degrades forever.

Fix: prune the ledger when writing. Drop `DIRT` entries entirely (they encode
"nothing happened here" — `applyDamage` stamping earth over earth is a no-op
unless the CA regrew it, which is arguably the wrong behaviour anyway), give
`PUSH` a decay branch, and cap the ledger at some sane size, evicting oldest.

**Note the interaction with Finding 1:** a 200–650 ms synchronous stall on
every restart is exactly the >150 ms trigger the watchdog is waiting for. So on
a well-played map, *every single restart* permanently adds another loop chain,
even if the player never switches tab. Fixing 1 defuses the compounding;
fixing 2 removes the trigger and the freeze. Both are worth doing.

---

## Finding 3 — Every graph search allocates an array-of-arrays per node (11.7× available)

`src/map.ts:87`, `src/ai.ts:35`, `src/ai.ts:71`, `src/evolve.ts:242`,
`src/evolve.ts:309`, `src/rulegen.ts:278`, `src/rulegen.ts:337`,
`src/rulegen.ts:365`

The same idiom appears in every flood fill and BFS in the codebase:

```ts
for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
```

`as const` is a *type-level* assertion with no runtime effect. This allocates
one outer array plus four inner arrays, plus an iterator, **per node visited** —
roughly 85,000 allocations per full-map flood. Combined with `SOLID.has()`
(a `Set` lookup on a hot path) and `q.pop()` on a growing JS array.

Measured on the real GLEN tiles, `floodFrom` as written vs. the same algorithm
with hoisted offsets, a reused `Int32Array` queue, and a `Uint8Array` lookup
table instead of the `Set` — verified to produce bit-identical output:

```
as written: 1.4 ms
hoisted:    0.12 ms
speedup:    11.7x
identicalResult: true
```

This multiplies through everything in Finding 2 (`evolveTiles`, `applyDamage`,
`placePushstone`, `ruleGenTiles`'s bridge passes) and through the AI. A single
shared, allocation-free `flood()` helper in `map.ts` would pay for itself
several times over.

Also worth exporting a module-level `SOLID_LUT = new Uint8Array(32)` alongside
the existing `SOLID` set — `SOLID.has(t)` is called from `solidTile()`, which is
in the movement path *and* every BFS neighbour test.

---

## Finding 4 — The upgrade ripple renders the scene twice per frame

`src/render.ts:1045-1068`

For one second after every upgrade, `render()` builds *both* the old-tier and
new-tier scenes into offscreen canvases every frame and composites them behind
a wipe. Measured at ~947 µs vs 858 µs for a plain T4 frame — less than the
feared 2× because the offscreen path skips the HUD, but it is still the most
expensive frame in the game, and it lands precisely at the moment of an upgrade
(when the FX system is also firing a 26-particle burst).

Two cheap improvements:

1. **The old-tier scene is static.** The world barely changes in one second and
   it is behind a shrinking sliver anyway. Render `offA` **once** at ripple
   start, then only `offB` per frame. Halves the cost.
2. `offA.getContext('2d')` and `offB.getContext('2d')` are called on
   `render.ts:1051` every frame. Cache both alongside the canvases.

Also note `render.ts:1047` creates the offscreen canvases lazily on the first
ripple — i.e. mid-play, at the exact moment of maximum work. Create them
eagerly at module load.

---

## Finding 5 — CRT mode is a full-screen GPU filter, unlocked exactly when you're at T5

`index.html:36-50`

```css
body.crt canvas { filter: blur(0.3px) saturate(1.2) contrast(1.05) brightness(1.05); }
body.crt #crt  { background-size: 100% 100%, 100% calc(100% / 192); }
```

This is a composited blur + colour-matrix over the *upscaled* canvas, plus a
1-device-pixel-period repeating gradient, every frame. On a Retina display the
canvas is upscaled to several million device pixels; a `blur()` filter at that
size is far more expensive than the entire 256×192 game render, and it does not
show up in `__bench` at all because it happens in the compositor.

The trap is the unlock condition: CRT is granted by a hard-mode win
(`main.ts:171-173`), which requires reaching T5. So the players most likely to
have it enabled are exactly the players in the most expensive renderer — and
the preference persists across reloads (`main.ts:42-46`). If anyone reports
"it got slow after I won", this is the first thing to check.

Cheaper alternatives: bake the scanlines into a `repeating-linear-gradient` on a
`::after` with `will-change: transform`, drop the `blur()` (it fights
`image-rendering: pixelated` anyway), or render the scanlines into the 256×192
canvas itself where they cost ~45k pixels instead of millions.

---

## Finding 6 — Smaller items, roughly in order

**`berryTarget()` is called twice** — `ai.ts:158` then `ai.ts:160`:

```ts
} else if (r.hp <= 2 && berryTarget(g)) {
  ai.state = 'berry';
  const b = berryTarget(g)!;        // second identical bounded BFS
```

Two bounded flood fills where one would do, plus two `Vec[]` builds and two
`Map` allocations. Hoist it: `const berry = r.hp <= 2 ? berryTarget(g) : null;`

**Per-frame gradient allocation** — `render.ts:628`. `createRadialGradient()` is
constructed for each cloud shadow every frame at T4+, then used for a
160×160 alpha-blended fill. Only two clouds, so it is not dominant, but both the
gradient objects and the two large blended fills are avoidable: pre-render one
cloud sprite to a small offscreen canvas once and `drawImage` it at an offset.

**`g.fx` reallocated every tick** — `game.ts:548`:
`g.fx = g.fx.filter(f => g.time - f.t0 < 1);` allocates a fresh array 60×/sec
even when empty. Prune in place with a reverse loop and `splice`, as `bolts`
(`game.ts:481`) and `burns` (`evolve`-adjacent, `game.ts:178`) already do.

**Shard-respawn scan** — `game.ts:522-523`: `filter` + nested `some` with
`Math.hypot` over every shrine × every ground shard. Only runs every 19 s, so
it is minor, but a tile-index `Set` would make it O(shrines).

**Per-pixel `fillRect` for all sprites and text** — `render.ts:97-111`
(`drawMaskPixels`), `render.ts:114-123` (`drawPat`), `font.ts:55-70`
(`drawText`). Each glyph pixel and each avatar pixel is its own 1×1 `fillRect`.
The HUD alone is ~900 `fillRect` calls per frame, which is why HUD/text measures
150–240 µs at T3+ — comparable to a third of the scene. Pre-rendering the font
to an offscreen atlas once and blitting glyphs would largely erase it. Worth
doing only after Findings 1–3; on current hardware it is not hurting anyone.

**Allocation in per-frame paths** — `screenOf()` (`defs.ts:261`) returns a fresh
`Vec` and is called ~4× per `relSfx()`; `for (const e of [p, r])` allocates an
array per tick (`game.ts:472`); `render.ts:231` and `render.ts:587` build a
nested array of fresh object literals every frame in both pipelines. Individually
trivial, collectively a steady trickle of GC pressure that shows up as
occasional frame hitches rather than as average cost.

---

## If the target is genuinely weak hardware

Everything above assumes the current ~1 ms budget is fine, which it is on
anything modern. If the goal is a comfortable 60 fps on a low-end Chromebook
(call it 10× slower → ~7.6 ms/frame at T5, over half the budget), then the
T3+ scene cost does become worth attacking. The single best lever:

**Cache static terrain per screen.** `directRender()` (`render.ts:560-565`)
redraws all 759 visible tiles from primitives every frame, and most tiles never
change. Render each screen's static tiles once into an offscreen canvas, blit it
with one `drawImage`, and draw only the genuinely animated tiles on top
(`WATER`, `BURN`, `ALTAR`, and at T5 `TREE`/`REED` sway). Invalidate on the
events that actually mutate tiles — ignite, crack, pushstone settle, stone drag.
That should take the ~600 µs scene cost to well under 200 µs.

Secondary: `drawTileDirect()` sets `fillStyle` 2–8 times per tile (~3,000
assignments/frame) and uses `arc()`/`ellipse()` for trees, rocks and wells —
antialiased path fills are markedly more expensive than `fillRect`. Batching by
colour, or pre-rendering the 21 tile types × 3 tiers into a sprite atlas, would
help. But cache the terrain first; it subsumes most of this.

---

## Priority

| # | Fix | Effort | Payoff |
|---|---|---|---|
| 1 | Watchdog / rAF loop multiplication (`main.ts`) | ~15 lines | **Removes an unbounded, permanent slowdown.** Do this first. |
| 2 | Batch `poisOk()` in `applyDamage()` (`evolve.ts`) | ~15 lines | 737 ms → ~1.4 ms at 500 scars |
| 3 | Prune/decay the scar ledger (`evolve.ts:194`) | ~10 lines | Removes unbounded growth in restart cost |
| 4 | Cache evolved generations instead of replaying (`game.ts:48,54`) | moderate | 193 ms → ~5 ms |
| 5 | Shared allocation-free flood/BFS helper | moderate | 11.7× on every graph search |
| 6 | Render ripple's old tier once, cache offscreen contexts | ~10 lines | Removes the worst frame in the game |
| 7 | De-duplicate `berryTarget()` (`ai.ts:158`) | 2 lines | Free |
| 8 | Static terrain caching for T3+ | larger | Only matters on weak hardware |

Items 1–3 are small, surgical, and between them account for essentially all of
the real-world degradation. The renderer — the intuitive suspect, and the focus
of the previous review in `reviews/gpt_5_4.md` — measures at under 6% of frame
budget and should be the *last* thing touched.

---

## Correctness observations noticed in passing

Not performance, but found while reading:

- `main.ts:130` — `__ff()` steps `update()` with a fixed `0.05` dt but reads
  `g.mode === 'play'` only in the loop condition, so a game that ends mid-loop
  still runs one extra tick. Harmless for a debug hook.
- `evolve.ts:198-206` — as noted, `Tl.PUSH` and `Tl.DIRT` have no weathering
  branch, making them absorbing states. `PUSH` in particular means a scarred
  tile can become a permanent pushstone that the valley can never reclaim. That
  may well be intentional ("the valley keeps its levers"), but it is worth
  confirming, because it is also the mechanism behind the unbounded ledger.
- `game.ts:517` — `berryCd` is decremented for every spot every tick regardless
  of whether any are on cooldown. Trivially cheap, just noted for completeness.
