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
- **Era-appropriate shards:** the storage-media shard renders at the *viewer's* tier —
  cassette tape at T0–T2, 3.5" floppy at T3–T4, CD at T5.
- **Animation frames scale with tier:** T0 static glyph, T1 2-frame walk, T2 4 frames
  (bob variants), T3 pixel-smooth movement, T4–T5 ~8 effective frames plus drop shadow.

### Playtest round 1 (2026-07-21)

- **Maze geography:** a river crosses the world between screen rows 1 and 2,
  bridged only at two path crossings; hand-picked hedgerows close ten screen
  edges. All 24 screens remain connected but the village→stones run is now a
  real journey. Arena stays 6×4 — the maze roughly doubles effective distances,
  and a larger world would dilute rival encounters (revisit after more play).
- **Black paper everywhere** at Spectrum tiers; avatars are two-colour sprites
  (head/body attribute split): player white/cyan, Kernagh yellow/magenta.
- **Minimap** in the HUD (village green, stones cyan, keep red, current screen
  blinking) plus compass bearings in shard messages.
- **Boot sequence:** 3 s simulated tape-load (pilot bars → data bursts), then a
  minimal title with the credit "JON FABLETON (C) <year>" cycling T0–T5 years
  at 1 fps through Spectrum ink/paper pairs.
- **Kernagh's brain:** shard-seeking is nearest-by-walking-distance (BFS flood),
  not nearest-by-euclid — the straight-line version orbits forever between two
  equidistant shards on opposite sides of a hedge. Perception capped at 32 tiles
  of walking; he dawdles ~5 s after each pickup; intercept gives up after 9 s.
- **Pacing:** vs an idle player Kernagh wins in ~5 min (one tier/min); shard
  economy trimmed to 4 starting shards + 22 s respawn.

### Playtest round 2 (2026-07-21)

- **No more crossroads:** the wall-to-wall cross paths are gone. Every open
  screen edge has a single randomly-placed doorway; screens carry internal
  barrier lines (tree runs, rock ridges, stream spurs off the river) partway
  through. A flood-fill repair pass proves every shrine, the altar, and both
  homes reachable at generation time and carves an emergency path if not.
  The map is FIXED — one hard-coded seed, identical world every game, so
  familiarity pays off as in Feud.
- **Two victory types (and their mirrors):**
  - *Transcendence* (true victory): at T5, gather 3 more shards and complete a
    longer (5 s) final ritual at the stones. Amiga-style win screen. Kernagh
    doing it first is the race loss.
  - *Elimination* (partial victory): derez the opponent while they are already
    at T0. The partial-victory screen renders at the tier the player actually
    reached. Mirror: the player derezzed at T0 is "SIGNAL LOST" — game over.
  This replaces the old passive hold-T5-for-10s win.
- **Fair fire:** Kernagh now shoots only in the four cardinal directions,
  like the player, and only when roughly aligned.
- **T0 shard signalling:** with no colour available, shards blink at ~1.5 Hz.

### Playtest round 3 (2026-07-22)

- **T0 shard flash actually reads now:** the shrine pedestal (which rendered as
  a permanently-lit block, masking the blink) is hidden at T0, and the on-phase
  shard carries a large pulsing diamond burst.
- **Berries:** bushes scattered across the map (densest in the Greenwood) heal
  1 ♥ when walked over below full health; each bush regrows after ~30 s.
  Kernagh seeks nearby berries when hurt. Berries are a paintable tile type.
- **Two wands:** a swap pedestal in each wizard's home village toggles
  firewand (1 damage + 0.4 s stagger — the default) and icewand (no damage,
  3.5 s freeze). The pedestal icon always shows the wand you'd swap TO.
  Offensive vs defensive playstyles; Kernagh keeps firewand for now.
- **14 shrines** (up from 10); still 4 starting shards.
- **Title flow:** title and a "HOW TO PLAY" icon guide alternate every 6 s
  (shards, stone circle, berries, wands, Kernagh, river).
- **Music:** in-game tune now runs A-A-B-A with a higher-contour bridge.
- **Map tile editor** (`/editor.html`): whole-arena schematic + live per-screen
  preview through the real T0–T5 renderers; paint tiles, check connectivity,
  download JSON, and "apply to game" via localStorage (the game loads the
  override on new game; "clear override" restores the built-in map).
- Pacing after all of the above: idle-player loss at ~6.2 min.

### Playtest round 4 (2026-07-22)

- **Wand toggle fixed:** the station's latch hysteresis was inverted — walking
  in crossed the 10–14px "on-station" band before the 10px trigger, arming the
  latch and suppressing the swap forever (teleport tests jumped the band, which
  is why they falsely passed). Trigger at 10px, release at 16px. Station tiles
  are also now kept clear of scenery at generation.
- **Race-loss screen** reports the tier the player actually reached.
- **20 shrines** (up from 14).
- **Difficulty loop:** games start in EASY mode — Kernagh is degraded at the
  decision level only (18-tile perception, 2.2x slower repathing, 9s pickup
  dawdle, 45% held shots + 1.8s fire cooldown, intercepts only near-altar
  rituals and the endgame; movement speed and rules stay identical). Winning
  easy shows the victory plus "BUT THIS WAS THE EASY SIGNAL..." — ENTER
  continues into HARD mode (the current full AI), SPACE rests on your laurels.
  Winning easy permanently unlocks "H FOR HARD MODE" on the title screen.
  Idle-player loss: ~7.9 min easy, ~6 min hard.
