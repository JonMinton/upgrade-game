# UPGRADE — Design Document (draft)

A retro flick-screen exploration game where upgrades don't improve *you* — they improve
*the game itself*. You and an AI rival race up the ladder of audiovisual history, from
late-1970s monochrome blocks to mid-1990s Amiga splendour.

Primary inspirations: **Feud** (Bulldog/Mastertronic, 1987) for the flick-screen overhead
world, the single AI rival, and scavenging-driven rivalry; **Robin of the Wood**
(Odin, 1985) for the lush-for-its-era forest maze and item-gated encounters.

Target playthrough: **5–10 minutes**.

---

## 1. The core conceit

Every entity in the world — you, the rival, and the environment — has a **development
tier**. The tier controls *only* presentation: resolution, palette, colour rules,
animation smoothness, and sound hardware. Movement speed, attack power, and health are
identical at every tier. The game is a race to be the first to *look and sound* like 1995.

Rendering rule: **the environment renders at your tier** (the world is "your game"), but
**each avatar renders at its own tier**. Seeing a silky 16-colour sprite glide through
your attribute-clashing Spectrum forest tells you instantly — and unsettlingly — that the
rival is ahead.

## 2. The tier ladder

| Tier | Era / machine modelled | Graphics | Sound | Notes |
|---|---|---|---|---|
| **T0** | Late-70s / ZX81-ish | 64×48 effective blocks, 1-bit black & white, entities are chunky glyphs, instant screen-flick with no transition | Near-silence: single click per footstep | The "death floor" — you can't fall below this |
| **T1** | ZX Spectrum 48K (1982–84) | 256×192, **8×8 attribute cells, 2 colours per cell, full attribute clash faithfully modelled**, BRIGHT bit, dithered shading | 1-channel beeper: melody *or* SFX, never both (SFX interrupt the tune) | **Player start tier** |
| **T2** | Spectrum 128 / Amstrad-ish (1985–86) | Still attribute-based but clash minimised by smarter cell alignment; 2-frame → 4-frame walk cycles | AY-3-8912: 3 channels, music and SFX coexist | |
| **T3** | C64-style 8-bit with hardware sprites (1987) | 16-colour fixed palette, sprites free of the attribute grid (no clash), smooth sub-cell movement, simple scroll instead of screen-flick | SID-style: 3 channels with filter sweeps, bass | Screen-flick becomes a fast push-scroll |
| **T4** | Atari ST / EGA (1989–91) | 16 colours from a 512-colour palette, 8-frame animation, tile detail doubles | 4-channel sampled drums + FM-ish melody | |
| **T5** | Commodore Amiga (1992–95) | 32+ colours, parallax layers, anti-aliased sprites, ambient animation (swaying trees, rippling water) | 4-channel MOD music, stereo, sampled SFX | **Win tier** — reach it and hold it for 10 s to win |

The tier transition itself is a celebrated moment: a one-second "re-render" ripple sweeps
across the screen redrawing every cell in the new fidelity, with the soundtrack
crossfading from beeper to AY (etc.) mid-note.

## 3. The world

A flick-screen overhead map of **6×4 = 24 screens** (small enough for a 5–10 min game,
big enough to hide things), themed as a British-folklore valley — the shared ancestral
turf of Feud and Robin of the Wood:

- **The Village** (SW corner): cottages, walls, a well. Player's home screen; respawn point.
- **The Greenwood** (centre): maze-like forest paths, Robin-of-the-Wood style; most shrines are here.
- **The Marsh** (NE): open but slow-looking reeds and pools; long sightlines, risky crossings.
- **The Standing Stones** (N edge): a stone circle — the *transcendence altar* where tier upgrades are performed.
- **The Ruined Keep** (SE corner): the rival's home screen; tight corridors, ambush territory.

Each region reads differently at every tier — e.g. the Greenwood at T1 is green/black
dithered trees whose canopies clash horribly with your sprite; at T5 it's a parallax
forest with dappled light.

## 4. Upgrade items — "shards"

Scattered relics of future hardware, drawn as anachronistic tech-fossils half-buried in
the folklore landscape:

- **The Valve** (glowing thermionic tube in the marsh)
- **The Ferrite Ring** (in a cottage)
- **The Transistor** (three-legged idol in the stone circle)
- **The EPROM** (a windowed chip gleaming under quartz)
- **The Floppy** (3.5", stuck in a tree like a sword in a stone)
- **The Chip Fab Sliver** (rainbow silicon wafer fragment, deep in the keep)

Mechanics:

- Carrying **3 shards** lets you perform an upgrade **at the Standing Stones** (a 3-second
  channelling ritual — interruptible if the rival hits you, Feud-style tension).
- Shards spawn at fixed **shrine locations**; the pool is finite at any moment but
  **slowly replenishes** (a new shard sprouts every ~45 s at a random empty shrine),
  so a losing player is never fully locked out but the leader keeps tempo.
- The rival AI seeks shards too, and will beeline to intercept *you* when it's carrying
  none and you're carrying two or more.

## 5. Combat

Feud-flavoured ranged skirmishing, kept simple for the 5–10 min format:

- One projectile type — a **"static bolt"** (crackling interference sparkle) — thrown in
  the facing direction, ~1 s cooldown, screen-limited range.
- 3 hits = **derez**: the victim dissolves in a burst of noise pixels, drops all carried
  shards on the spot, respawns at their home screen, and **loses one tier** (floor T0).
- Your bolt is rendered at *your* tier (a T1 bolt is a flickery 1-bit sparkle with a
  beeper zap; a T4 bolt is a smooth glinting projectile with a sampled *pshoo*).
- No combat on either player's home screen (safe rooms), preventing spawn-camping.

## 6. The rival

A single AI opponent ("**Kernagh**", a rival hedge-wizard — Feud's Leanoric energy),
starting at **T1 like you** but on the far side of the map. Behaviour is a simple
state machine: *forage* (nearest known shard) → *ritual* (go upgrade when holding 3)
→ *intercept* (hunt the player when they're close to upgrading) → *flee* (when at
1 hit remaining and carrying shards).

You mostly *hear* Kernagh before you see him: his footsteps and zaps play at **his**
tier's sound quality, bleeding through from adjacent screens — beeper clicks early on,
increasingly rich stereo samples as he pulls ahead.

## 7. Pacing sketch (target ~7 min)

- 0:00–1:30 — learn the map, gather first 3 shards, first upgrade (T1→T2).
- 1:30–4:00 — contested middle game; first fights; someone gets derezzed.
- 4:00–6:30 — T3→T4 race; shard scarcity bites; interceptions at the Stones.
- 6:30–8:00 — winner channels the final upgrade at T5 and survives the 10 s hold.

---

## 8. Settled decisions (2026-07-21)

- **Platform:** Web — TypeScript + Canvas 2D, WebAudio for per-tier sound synthesis
  (beeper → AY → SID-style → sampled/MOD). No engine; hostable on GitHub Pages.
- **Combat:** single ranged "static bolt", ~1 s cooldown, 3 hits to derez.
- **Economy:** slow replenish — fixed shrines, a new shard sprouts every ~45 s at a
  random empty shrine.
- **Rivals:** one AI nemesis (working name "Kernagh").
