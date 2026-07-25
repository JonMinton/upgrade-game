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

### Playtest round 5 (2026-07-22)

- **Shard cap confirmed at 3** for both wizards (entry guard + mid-loop break
  in `pickups()`); shard respawn quickened 22 s → 19 s instead.
- **Death drops confirmed working** (they already were): a derezzed wizard's
  carried shards scatter at the kill spot on walkable tiles; the derez message
  now shows the loot ("KERNAGH DEREZZED TO T1 - DROPS ◆◆◆") to make the
  firewand-vs-icewand incentive legible.
- **Scoring + Hall of Signals:** score = 150 × highest tier + 75 × Kernagh
  derezzes + win bonus (500 transcend / 250 elimination) + time bonus
  (600 − seconds, wins only), all ×2 in hard mode. Top-8 table persists in
  localStorage (per-browser; an online table would need a server). Qualifying
  ends open a 3-character arcade initials entry on the end screen; the table
  is the third screen in the title rotation (title → guide → hall).

### Playtest round 6 (2026-07-22)

- **Map-tagged scores:** every hi-score entry records the map it was set on
  (built-in map is "VALE"; custom maps carry the name set in the editor).
  The Hall shows all maps merged by default; **M** cycles a per-map filter.
  The EASY/HARD column was dropped — the ×2 hard multiplier means hard scores
  dominate a merged board anyway (mode is still stored per entry).
- **Multiple maps as first-class content:** `maps/` in the repo holds
  shareable map JSONs (`{name, tiles}`), starting with `maps/vale.json`
  (the built-in map exported from the generator). Playtester contributions
  arrive as PRs into that folder; see `maps/README.md` for the workflow.
- **Editor upgrades:** map-name field (tags scores), "load json" (import a
  contributed map), "blank map" (empty bordered field to build from nothing),
  and an **arena paint mode** — the whole-world view now supports drag
  painting/erasing for coherent large-scale features (rivers, hedgerows),
  while the screen view remains the fine-tuning, player's-eye editor
  (toggle button; shift-click still selects a screen while painting).

### Playtest round 7 (2026-07-22)

- **Editor:** brush width selector (1/2/3/5 — area tiles only; shrines,
  berries, wells and altars always place singly), an explicit eraser palette
  entry plus a "clear screen" button, and a **dirt** tile — a second walkable
  background that renders as pure void black at Spectrum tiers and flat earth
  at T3+.
- **Rule-based feature generator** (`src/rulegen.ts`, editor "generate" +
  seed field). Features grow from rules rather than templates:
  1. *Rivers* flow edge-to-edge with momentum and meander; ~60% fork a
     tributary toward the nearer edge.
  2. *Forests* grow as blob clusters; rocky patches and dirt clearings vary
     the ground; *reeds* colonise river banks.
  3. *Berries* are placed by weighted acceptance: ~10x likelier where ≥2
     trees stand within 2 tiles — so they concentrate in woodland.
  4. *The stone circle repels both bases*: 200 candidate points scored by
     minimum distance to either home; the best wins.
  5. *Shrines* scatter poisson-style (≥17 tiles apart, away from POIs).
  6. *Bridges want to exist where they open the world*: candidate crossings
     (short water runs with walkable banks) are added greedily while any
     walkable region remains unreachable from the player's home.
  7. A final repair pass guarantees every shrine, berry, the altar and the
     keep are walkable (verified across seeds).
  Bases stayed at the canonical corners in the first iteration; see round 8.

### Playtest round 8 (2026-07-22)

- **Movable, mutually-repelling bases.** New walkable marker tiles PBASE and
  RBASE tell `worldFromTiles` where each wizard's base is; homes, wand
  stations (+3 tiles east of the village sigil, −3 west of the keep's), safe
  screens, and the minimap highlights are all derived from the markers.
  Legacy maps without markers fall back to the canonical corners. The rule
  generator now samples ~30 candidate sites (away from edges and water) and
  takes the pair with the greatest separation; the more south-westerly one
  becomes the village. Verified end-to-end: a generated map with the village
  in the north-west corner plays a complete game.
- Markers are paintable in the editor (p-base / r-base), so hand-made maps
  can place bases anywhere too.

### Playtest round 9 (2026-07-22)

- **New default map "GLEN":** the shipped map is now rule-generated from
  hand-picked seed 72, chosen by scanning 80 seeds for the qualities of the
  original hand-authored VALE (SW village, NE keep ~1360px apart, full-width
  meandering mid-river with two natural bridges, 20 shrines, connected).
  `genWorld()` = `ruleGenTiles(72)`; the old authored generator survives as
  `genClassicWorld()` and `maps/vale.json` remains loadable as a classic.
  Idle-easy pacing on GLEN: ~7.9 min.
- **Chaos Mode:** C on the title screen rolls a random seed and starts on a
  freshly generated map (announced as "CHAOS MODE - SEED N"). The seed stays
  fixed through retries and the easy→hard loop, so the map is learnable
  within a session; SPACE (rest) returns to the default map. Chaos scores
  are tagged with map "CHAOS"; the seed also appears on end screens
  ("SCORE 1250 - SEED 575679") so maps can be shared.
- **Seeded chaos:** S on the title screen (unlocked, with hard mode, by the
  first easy win) opens a digit-entry prompt — type a shared seed to play
  that exact valley. Kept behind the unlock so the first-play experience
  stays simple.

### Playtest round 10 (2026-07-22)

- **Fire crosses water:** bolts (and Kernagh's firing sightlines) pass over
  rivers and pools; trees, rock, walls and ruins still block them. Rivers are
  now firing lines as well as barriers.
- **Bridges must earn their keep:** the generator's reconnection pass now
  finds the largest genuinely-unreachable walkable region each iteration and
  only places a bridge whose far bank lands IN that region — measured
  traversability gain, not hoped-for. When the blockage is trees/rock rather
  than water, a minimal **villager clearing** (a short dirt cut) is carved
  through the thinnest point instead, as if the locals opened the way.
- **Bodies collide:** the wizards can no longer walk through each other
  (blocked at an 11px gap, approach-only so overlaps always separate), and an
  **encounter cap** makes Kernagh disengage after ~10-12s glued to the player,
  reverting to collecting or healing (an active ritual is still always worth
  breaking).
- **Ruins:** a new solid terrain type grown by the generator from
  attractor-scored seeds (water strongest, woodland medium, rock weakest) in
  house-and-street dimensions — dirt lanes with broken-walled houses (each
  wall tile ~72% present), interiors of bare earth. Rich both visually and
  as partial-cover mazes. Paintable in the editor.
- **Default map re-picked** after the generator changes: GLEN is now seed 6
  (scanned 100 seeds; best on base separation, mid-river presence, and ruin
  richness — including a riverbank ruin near the village). Idle-easy ~9.4 min.

### Combat scars, stone-hauling & the Void (2026-07-25)

- **The arena deforms under combat.** A firewand bolt that dies on a tree has
  a small chance (7%) of igniting it: the tree burns for ~4.5s (animated at
  every tier), with a low chance per tick of the fire creeping to adjacent
  trees (capped at 12 simultaneous blazes; the safe home screens never burn),
  then falls to a **burnt stump** (solid). An icewand bolt that dies on a
  standing stone has a 6% chance of frost-splitting it into **cracked rock**
  (solid). Tuning knobs live on `window.__dmg`.
- **Scars persist and weather.** Each map keeps a damage ledger
  (`upgrade-dmg-<MAP>` in localStorage, tile index → tile). On every
  completed game the ledger weathers once with seeded rolls: stumps mostly
  remain (70%), decay to earth (23%) or resolve into a **pushstone** (7%);
  cracked rock remains (60%), crumbles to ruin (15%) or earth (20%), or
  becomes a pushstone (5%); ruins — scarred or generator-grown, via a new CA
  rule — slump to earth slowly (3%). Earth and pushstones rest where they
  lie. On load, solid scars are individually skipped if stamping them would
  cut any POI off. Chaos maps neither load nor save the ledger.
- **Stones can be hauled.** Standing next to any stone (pushstone, rock,
  standing stone, cracked rock) and holding FIRE plus the direction directly
  away from it drags it: the wizard trudges at quarter speed (pushstone) or
  a third (ordinary stones), the wand stays holstered, and the stone follows
  a tile at a time. Grass it grinds over is stripped to bare earth; paths
  keep their nature; it will never settle on a shrine, altar or base sigil.
  Weathered-in pushstones can thus be relocated to a useful bank — at
  considerable effort.
- **The Void.** The arena border is only trees, and trees burn. If a border
  stump decays to earth between games, the world has a hole in it; stepping
  onto the outermost tile ring ends the game with the `void` screen: *you
  found The Void — nothing to see, nothing to do, the conflict is over.* No
  score, no hall entry — and the Void consumes the valley's entire history:
  visit ledgers and damage ledgers for every map reset to genesis (the Hall
  of Signals and unlocks are the player's, not the valley's, and survive).
  ESC is the only way back.

## Future work

- **Server-backed Hall of Signals.** localStorage is per-browser; the plan:
  a small API (e.g. a Cloudflare Worker + KV, or any tiny host) with
  `POST /scores {name, score, mode, map, timeSecs}` and
  `GET /scores?map=...&limit=...`; the client falls back to localStorage
  offline and merges on next load. Needs light abuse controls (length/rate
  caps, server-side score sanity bounds — max plausible score per minute)
  and a shared map registry so contributed maps have canonical names
  (likely: the `maps/` folder is the registry; the server validates map
  names against it). Score submissions should eventually carry a map hash
  rather than trust the name alone.
- **Kernagh learns the icewand** (he currently always carries fire).
- Possible 7×5 arena if the 6×4 maze starts feeling small.
- **More generator rules to explore:** paths that grow between POIs along
  near-optimal walking routes (desire lines); clearings around shrines;
  river fords vs bridges; biome-consistent screen naming for the minimap.
