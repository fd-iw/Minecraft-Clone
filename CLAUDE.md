# Stratavale: notes for contributors and agents

## Commands

- `npm run check`: typecheck, lint and unit tests. Run it before every commit.
- `npm run test:e2e`: Playwright against the production build.
  - Chromium comes from `/opt/pw-browsers`; never run `playwright install`.
  - `@playwright/test` is pinned to 1.56.1 to match that Chromium build.
- `npm run format`: Prettier.

## Module boundaries

- `src/shared` and `src/engine` are pure simulation code. They must not import `three`, `render/`,
  `client/` or use DOM APIs. ESLint enforces the imports.
- `render/meshing` and `render/textures/layout.ts` run inside workers too, so keep them DOM-free.
- Player actions go through the pure rules in `engine/actions.ts`, so a server can reuse them later.

## Data rules

- Block and item IDs are part of the save format. Append new blocks; never renumber.
- Block value = `(type << 4) | meta`. Adding textures to a block changes texture-array layers but
  not saves.
- World generation must stay deterministic: no `Math.random()` in `engine/`. Use `shared/rng.ts`.

## Hot paths

- Meshing, lighting and generation loops use flat typed arrays and integer maths.
  - Avoid per-block allocations and closures inside these loops.
- The chunk renderer shares one quad index buffer. Call `setIndex(null)` before `dispose()` on a
  chunk geometry.

## Originality policy

- All textures are procedural recipes in `render/textures/painters.ts`, and all sounds are
  synthesized in `client/audio.ts`. Don't add third-party game assets.
- Use the project's own names for creatures, items and places. `tests/unit/ipguard.test.ts`
  fails if trademarked names from other games appear in `src/`.
- Planned names:
  - Bloatcap: the exploding fungus mob
  - Veilwalker: the tall teleporting mob
  - Arcdust: the logic-circuit dust
  - Cinderdeep: the fire dimension
  - Farvoid: the void dimension, whose boss is the Eclipse Ray
  - Blast Keg: the explosive block
