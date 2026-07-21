# UPGRADE

A retro flick-screen exploration game where the upgrades you find don't improve your
character — they improve **the game itself**. Race an AI rival from ZX Spectrum
attribute-clash monochrome-adjacent 1982 up to 32-colour Amiga 1995. Get derezzed and
you fall back toward 1979.

Inspired by *Feud* (1987) and *Robin of the Wood* (1985).

See [DESIGN.md](DESIGN.md) for the full design document.

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
3 seconds at the Standing Stones (north of centre) to upgrade a tier. First to hold
T5 (Amiga) for 10 seconds wins. Get derezzed (3 hits) and you drop a tier, lose your
shards, and respawn at the village. Home screens (your village, Kernagh's keep) are
combat-free. Shards regrow at shrines every ~22 s. A river splits the world in
half, bridged in only two places; hedgerows close many screen borders — watch
the minimap (bottom right): green is home, cyan is the Standing Stones.

## Status

Playable prototype: full tier ladder T0-T5 (attribute-clash Spectrum renderer,
C64/ST/Amiga direct renderers), chip-synth audio arranged per tier, rival AI,
combat, ritual upgrades, win/lose flow. Balance tuning constants live at the top
of `src/game.ts`.
