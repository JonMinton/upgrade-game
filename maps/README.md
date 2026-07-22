# Maps

Shareable maps for UPGRADE, including playtester contributions.

Each map is a JSON file: `{ "name": "VALE", "tiles": [ ...16896 tile ids... ] }`
(192×88 tiles, row-major; tile ids are the `Tl` enum in `src/defs.ts`).
The `name` (max 6 chars) tags hi-score entries so scores compare like with like.

- `vale.json` — the built-in map (exported from the generator, seed 1337).

## Workflow

1. Open `/editor.html` (dev server). It loads your staged map if one is
   applied, else the built-in map. "blank map" starts from an empty field.
2. Paint. A playable map needs a 2×2 ALTAR block, some SHRINEs and BERRYs,
   and "check connectivity" must pass.
3. Set the map name (the small text box), then:
   - "apply to game" to playtest it (reload the game tab), and/or
   - "download json" to export it.
4. To contribute: commit the downloaded file into this folder via PR.
5. To play someone else's map: "load json" in the editor, then "apply to game".
