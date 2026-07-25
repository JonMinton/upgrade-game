# Performance Review: Upgrade

**Version:** As of 2026-07-25

**Reviewer:** Gemini

## Overall Assessment

The codebase is well-structured and thoughtfully designed. The core concept of "upgrading the game" by simulating different hardware eras is a creative and well-executed idea. The performance degradation observed at higher tiers (T3+) is largely an intentional part of this design, meant to reflect the more demanding graphical features of later hardware.

This review focuses on identifying the specific sources of these performance costs and suggesting potential optimizations that could be applied if desired, without fundamentally altering the game's unique aesthetic progression.

## Key Performance Hotspots

The primary performance bottlenecks are located in the rendering pipeline, specifically within the `directRender` function in `src/render.ts`. The game logic (`src/game.ts`) and AI (`src/ai.ts`) are efficient and do not appear to be significant contributors to the slowdowns.

### Tier 3: The Switch to `directRender`

At Tier 3, the rendering pipeline switches from the highly optimized `attrRender` (attribute-clashing, single-screen draws) to `directRender` (full-color, direct-to-canvas).

*   **Issue:** To achieve smooth scrolling, `directRender` must redraw every visible tile on the screen, for every single frame. This is inherently more expensive than the "flick-screen" approach of the lower tiers.
*   **Analysis:** The main loop in `directRender` iterates through every on-screen tile (`SCR_TW` x `SCR_TH`) and calls `drawTileDirect`.
*   **Suggestion:** This is a core part of the T3+ experience. While it's a performance cost, it's necessary for the intended "C64-era" feel. No change is recommended here, as it would compromise the design.

### Tier 4: Expensive Cloud Shadows

Tier 4 introduces a significant new graphical feature that is a major source of slowdown.

*   **Issue:** On every frame, the game creates two large, semi-transparent cloud shadows using `c.createRadialGradient`. This is a notoriously slow and CPU-intensive operation in the Canvas 2D API.

    ```typescript
    // src/render.ts

    if (envTier >= 4) {
      for (let i = 0; i < 2; i++) {
        const cxp = ((g.time * (7 + i * 4) + i * 700) % (SCR_W + 260)) - 130;
        const cyp = 40 + i * 70;
        const grad = c.createRadialGradient(cxp, cyp, 8, cxp, cyp, 80); // SLOW
        const a = envTier >= 5 ? 0.1 : 0.06;
        grad.addColorStop(0, `rgba(0,0,32,${a})`);
        grad.addColorStop(1, 'rgba(0,0,32,0)');
        c.fillStyle = grad;
        c.fillRect(cxp - 80, cyp - 80, 160, 160);
      }
    }
    ```

*   **Suggestion (High Impact):** Avoid recreating the gradient on every frame. The gradient itself doesn't change, only its position. A significant optimization would be to pre-render the radial gradient to an off-screen canvas once. Then, on each frame, simply draw the pre-rendered shadow canvas at the new calculated position (`cxp`, `cyp`). This would replace an expensive `createRadialGradient` and multiple `addColorStop` calls with a single, fast `drawImage` call per shadow.

### Tier 5: Ambient Animation Overload

Tier 5 builds on the previous tiers and adds further CPU load through ambient animations.

*   **Issue:** For every `TREE` and `REED` tile on screen, the game calculates a "sway" or "swish" effect using `Math.sin()`. On screens with dense foliage, this adds up to a large number of trigonometric calculations per frame.

    ```typescript
    // src/render.ts -> drawTileDirect()

    // For Tl.TREE
    const sway = tier >= 5 ? Math.sin(time * 1.5 + wtx * 0.9) * 0.7 : 0;

    // For Tl.REED
    const sw = tier >= 5 ? Math.round(Math.sin(time * 2 + wtx)) : 0;
    ```

*   **Suggestion (Medium Impact):**
    1.  **Approximation/Lookup:** For a less CPU-intensive approach, the sine wave could be approximated (e.g., using a parabolic function) or pre-calculated into a small lookup table.
    2.  **Animation Bucketing:** Instead of calculating a unique sway for every single tree, group them. For example, all trees in a 4x4 tile area could share the same sway value. This would drastically reduce the number of `sin()` calls.
    3.  **Cache Calculations:** The sway is a function of `time` and `wtx`. It's possible that some of these calculations are redundant across frames or tiles. Caching these results might offer a small performance boost.

## Conclusion

The performance slowdowns are a clever and integral part of the game's design. However, if the goal were to smooth out the frame rate at higher tiers for a different gameplay feel, the suggestions above would provide significant performance improvements. The **cloud shadow optimization** is the most critical and would have the largest positive impact.
