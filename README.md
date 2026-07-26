# UPGRADE

**Play it: https://jonminton.github.io/upgrade-game/** (map editor:
[/editor.html](https://jonminton.github.io/upgrade-game/editor.html))

A retro flick-screen exploration game where the upgrades you find don't improve your
character — they improve **the game itself**. Race an AI rival from ZX Spectrum
attribute-clash monochrome-adjacent 1982 up to 32-colour Amiga 1995. Get derezzed and
you fall back toward 1979.

Inspired by *Feud* (1987) and *Robin of the Wood* (1985).

See [DESIGN.md](DESIGN.md) for the full design document.

## Assets by tier

![Every sampled asset in UPGRADE, drawn at each of the six development tiers: columns run
T0 (1979 monochrome) to T5 (Amiga), rows run terrain, structures, battle scars, objects and
avatars. The walk-cycle rows show every distinct pose the renderers produce at that tier —
one at T0, two at T1, four at T2 and T3, six at T4 and T5.](media/asset-matrix.png)

Nothing in that image was drawn for it. Every cell is cropped out of a real
`renderPlay()` pass over a synthetic world, so the sheet can't drift from what the game
actually draws — and the walk-cycle pose counts are *derived*, by sampling along the
animation distance and de-duplicating on pixel content, rather than asserted.

Two rows repay a closer look. **The attribute rule** puts two identical trees either side
of the wizard: up to T1 the one sharing his 8×8 cell is forced to his ink while its twin
stays green, and from T2 the sprite carries its own colours and leaves both alone. And the
**T0 column** is mostly identical white blocks — at 1-bit with 4×4 chunking, most of the
world stops being distinguishable at all. That's the floor working as intended.

Regenerate after changing a renderer: `npm run dev`, open
[/assets.html](http://localhost:5173/assets.html), and use the download buttons
(both PNGs live in [media/](media/)).

## Tech

TypeScript + Canvas 2D + WebAudio, built with Vite. No game engine.

## Development

```sh
npm install
npm run dev      # dev server
npm run build    # production build to dist/
```

## How to play

```sh
npm install && npm run dev   # then open the printed localhost URL
```

Arrows/WASD move, Space (or X) fires, Enter starts. Gather 3 shards, channel for
3 seconds at the Standing Stones (north of centre) to upgrade a tier. Win by
**transcendence** — at T5, complete one final, longer ritual before Kernagh does —
or by **elimination** — derez Kernagh while he's already at rock-bottom T0. Get
derezzed (3 hits) and you drop a tier, lose your shards, and respawn at the
village; get derezzed at T0 and it's game over. Home screens (your village,
Kernagh's keep) are combat-free. Shards regrow at shrines every ~22 s. Berries
heal; the pedestal in your village swaps between firewand (harms) and icewand
(freezes). The default map ("GLEN") is fixed across all games — learn it. Press
C on the title screen for **Chaos Mode**: a freshly generated valley every time
(its seed is shown so you can share it); beating easy mode unlocks hard mode
(H) and seeded chaos (S).

## Map editor

`/editor.html` (same dev server) — paint tiles on any screen, preview it at any
tier T0–T5 through the real renderers, check connectivity, and "apply to game"
(stored in localStorage; reload the game tab to play it, "clear override" to
go back to the built-in map). A river splits the world in
half, bridged in only two places; hedgerows close many screen borders — watch
the minimap (bottom right): green is home, cyan is the Standing Stones.

## Status

Playable prototype: full tier ladder T0-T5 (attribute-clash Spectrum renderer,
C64/ST/Amiga direct renderers), chip-synth audio arranged per tier, rival AI,
combat, ritual upgrades, win/lose flow. Balance tuning constants live at the top
of `src/game.ts`.
