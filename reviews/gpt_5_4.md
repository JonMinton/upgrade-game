# GPT-5.4 Performance Review

## Codebase summary

This is a small TypeScript game built on Canvas 2D and WebAudio with no engine layer.

- `src/main.ts` owns bootstrapping, input, the frame loop, mode transitions, and a watchdog that advances the game when `requestAnimationFrame` stalls.
- `src/game.ts` is the main simulation: movement, combat, pickups, ritual upgrades, damage persistence, camera, and shard respawn.
- `src/render.ts` is the largest hot path. It contains two renderers: an attribute/bitmap pipeline for tiers T0-T2 and a direct Canvas 2D pipeline for T3-T5.
- `src/ai.ts` drives Kernagh with repeated BFS-based pathfinding and short-horizon target selection.
- `src/map.ts` and `src/evolve.ts` build, mutate, and persist the world state between runs.
- `src/audio.ts` provides a procedural chip-synth soundtrack and SFX.

The architectural split is clear, but performance after T3 is dominated by the renderer, with AI searches becoming the next most visible CPU consumer once the render budget tightens.

## Main performance findings

### 1. T3+ redraws the entire scene procedurally every frame

Files:

- `src/render.ts:337`
- `src/render.ts:553`
- `src/render.ts:1027`

At T3 and above, `directRender()` redraws the full visible tile area every frame, and each tile is regenerated from primitives instead of being blitted from cached sprites or a prerendered layer.

Why this matters:

- The viewport loops over every visible tile every frame.
- `drawTileDirect()` performs many `fillRect`, `beginPath`, `arc`, `ellipse`, `strokeRect`, `globalAlpha`, and `Math.sin` operations.
- The work is mostly repeated even when the camera is stationary and the terrain has not changed.
- T4 and T5 add more animated detail, so the cost rises precisely when the player crosses into the direct pipeline.

Why this is the most likely root cause of T3+ slowdown:

- The attribute renderer for T0-T2 writes into fixed buffers and colorizes them in one pass.
- The T3+ renderer moves to immediate-mode Canvas 2D drawing for nearly everything, so CPU overhead per frame rises sharply.

Suggested fixes:

- Cache the static terrain into an offscreen canvas per screen and per tier, then draw dynamic objects on top.
- Split terrain into static and animated layers so only water, burn tiles, altar glow, clouds, and entities need per-frame work.
- Where full-screen caching is too coarse, cache tile variants into offscreen sprite atlases and replace procedural redraws with `drawImage` calls.
- Invalidate the cached terrain only when map state actually changes, such as burning trees, cracked stones, or pushstone movement.

### 2. Upgrade ripple doubles render cost exactly when the game gets expensive

Files:

- `src/render.ts:1045`
- `src/render.ts:1052`
- `src/render.ts:1053`
- `src/render.ts:1054`
- `src/render.ts:1060`

For one second after an upgrade, `render()` draws the old tier and the new tier into two offscreen canvases every frame, then composites them with a wipe.

Why this matters:

- At T3+, the expensive renderer is invoked twice per frame during the transition.
- The hitch will be most visible during the T2->T3 and T3->T4 transitions, exactly where the renderer cost jumps.
- The offscreen canvases are reused, but the scene contents are still regenerated every frame.

Suggested fixes:

- Capture the pre-upgrade scene once at ripple start instead of rerendering it every frame.
- Render only the new scene during the ripple and wipe against a frozen bitmap of the old scene.
- If visual fidelity can bend slightly, shorten the ripple duration or update it at half rate.

### 3. Kernagh's AI does repeated BFS work on the main thread

Files:

- `src/ai.ts:16`
- `src/ai.ts:101`
- `src/ai.ts:158`
- `src/ai.ts:160`
- `src/ai.ts:179`
- `src/ai.ts:197`
- `src/ai.ts:200`

The rival logic repeatedly runs search over a 192x88 tile grid. This is not the main bottleneck on its own, but once T3+ rendering takes most of the frame budget, the AI cost becomes noticeable.

Specific issues:

- `berryTarget(g)` is called twice in the same decision branch, causing duplicate short-range BFS when the rival is injured.
- `nearestPointByPath()` builds a fresh target map and flood-fills on demand.
- `bfs()` can rerun as often as every `0.4s` while intercepting the player.
- All of this happens on the same thread as rendering and input.

Suggested fixes:

- Compute `berryTarget(g)` once per update and reuse the result.
- Only repath when the rival changes tile, the target changes tile, or an obstacle mutates.
- Replace full-grid BFS with A* for moving targets, or precompute more reusable distance fields for shrines/home/altar.
- Consider lowering repath frequency at higher render tiers if the visual step cost is the real bottleneck.

### 4. The watchdog can add extra full frames when performance is already bad

Files:

- `src/main.ts:294`
- `src/main.ts:296`

The watchdog calls `frame(now)` from `setInterval()` whenever more than `150ms` has elapsed since the last frame timestamp.

Why this matters:

- If the game is already slow, this can inject additional update and render work on top of the normal `requestAnimationFrame` loop.
- Because `frame()` itself schedules another `requestAnimationFrame`, the fallback path is not isolated from the main loop.
- The code is intended for hidden/occluded tabs, but the condition is purely timing-based rather than visibility-based.

Suggested fixes:

- Gate the watchdog with `document.visibilityState !== 'visible'`.
- Track an `inFrame` flag so the interval cannot re-enter the main loop while a frame is in progress.
- If the watchdog is only for simulation catch-up, skip rendering on the fallback path.

## Secondary issues

### 5. T4/T5 add per-frame gradient allocation for cloud shadows

File:

- `src/render.ts:628`

`createRadialGradient()` is called every frame for each drifting cloud shadow. There are only two clouds, so this is not the top issue, but it adds allocator churn on top of an already heavy direct renderer.

Suggested fixes:

- Pre-render one or two cloud-shadow sprites to offscreen canvases and scroll them.
- Or cache a small set of gradients if the visual can be discretized.

### 6. Some simulation cleanup paths allocate new arrays during play

Files:

- `src/game.ts:522`
- `src/game.ts:548`

These are smaller issues, but they do add avoidable work:

- Shard respawn rebuilds `empty` with `filter()` and nested `some()` checks.
- FX cleanup replaces the entire `g.fx` array with `filter()` every update.

Suggested fixes:

- Maintain a shrine-occupancy set keyed by tile index instead of nested scans.
- Prune expired FX in place, as is already done elsewhere for bolts and burns.

## Priority order for fixes

1. Cache or prerender the T3+ terrain path in `render.ts`.
2. Stop rerendering both sides of the ripple every frame.
3. Remove duplicate AI searches and reduce repath frequency.
4. Make the watchdog visibility-aware so it cannot amplify bad frame times.

## Expected payoff

If only one area is changed, the T3+ renderer should be the first target. The direct pipeline is doing the most repeated work, it scales with every frame, and the tier transition system currently magnifies it again during upgrades. The AI and watchdog issues are real, but they are secondary multipliers rather than the primary source of sustained slowdown.