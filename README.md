# Stratavale

A voxel sandbox survival game for the browser, written in TypeScript with Three.js. It aims for
faithful block-game gameplay: infinite procedurally generated worlds, digging and building, smooth
lighting, day/night, and (as the roadmap progresses) survival, mobs, logic circuits and other
dimensions.

**All assets are original.** Every block texture is painted procedurally at startup from palettes and
seeded noise, sounds are synthesized with WebAudio, and the names of creatures, items and places are
the project's own. No third-party game assets are used or needed.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (static, host anywhere)
npm run preview    # serve the production build
```

Requires a browser with WebGL2 (any current Chrome, Firefox, Safari or Edge).

## Controls

| Action                       | Key                                               |
| ---------------------------- | ------------------------------------------------- |
| Move                         | W A S D (or arrow keys)                           |
| Jump / swim up               | Space                                             |
| Fly (creative)               | double-tap Space; Space / Shift to rise / descend |
| Sprint                       | Ctrl, or double-tap W                             |
| Sneak (won't fall off edges) | Shift                                             |
| Break block                  | Left mouse                                        |
| Place block                  | Right mouse                                       |
| Pick block                   | Middle mouse                                      |
| Select hotbar slot           | 1-9 or mouse wheel                                |
| Inventory (creative palette) | E                                                 |
| Debug screen                 | F3                                                |
| Pause                        | Esc                                               |

## Development

```bash
npm run check      # typecheck + lint + unit tests
npm test           # unit tests (Vitest)
npm run test:e2e   # browser smoke tests (Playwright, runs against the production build)
npm run format     # Prettier
```

Handy URL parameters:

- `?autostart=1&seed=hello&rd=6` skips the menus and opens a world.
- `?test=1` disables pointer lock and audio, and exposes `window.__stratavale` for tests.

## Architecture

```
src/
  shared/    math, seeded RNG, simplex noise, events       (no DOM, no Three.js)
  engine/    the simulation: blocks, chunks, world, light,
             world generation, physics, items, player, rules (no DOM, no Three.js)
  render/    Three.js renderer: texture painters, texture array, mesher, chunk meshes, sky
  workers/   worker pool + one worker for generation, lighting and meshing
  client/    game loop, input, chunk streaming, IndexedDB saves, audio, DOM UI
```

- **The simulation is headless.** `engine/` and `shared/` must not import Three.js or DOM code,
  and ESLint enforces this. A future dedicated server can run the same code.
- **World storage.** Chunks are 16×256×16 columns. Block values are `uint16 (type << 4 | meta)`.
  Light is packed sky and block nibbles.
- **Deterministic generation.** Generation is a pure function of `(seed, chunk)`, and features
  such as trees and ore veins that cross chunk borders come out identical from both sides. Only
  modified chunks are saved.
- **Lighting.** Light is a flood fill. Workers light each new chunk on its own, then the main
  thread stitches light across chunk borders and applies incremental updates when blocks change.
- **Meshing.** Workers build culled faces with per-vertex ambient occlusion and smooth lighting,
  packed into 12-byte vertices and drawn with a shared quad index buffer.
- **Game loop.** Fixed 20 ticks per second, with interpolated rendering. Player movement follows
  classic block-game physics:
  - walking 4.317 m/s
  - sprinting 5.612 m/s
  - jumps about 1.25 blocks high

## Roadmap

| Phase | Scope                                                                                                                         | Status  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0     | Scaffold: Vite, strict TS, lint, unit + e2e tests                                                                             | done    |
| 1     | Engine core: infinite terrain, biomes, caves, trees, lighting, physics, place/break, hotbar, creative inventory, menus, saves | done    |
| 2     | World fidelity: flowing water/lava, block ticks, falling sand, clouds, ravines, more structures                               | next    |
| 3     | Survival: health, hunger, break times and tools, drops, crafting, smelting, chests, beds                                      | planned |
| 4     | Entities: animals and hostile creatures with pathfinding, combat, spawning rules                                              | planned |
| 5     | Arcdust logic circuits: wire, torches, relays, comparators, pistons                                                           | planned |
| 6     | Dimensions: the Cinderdeep and the Farvoid, portals, a boss                                                                   | planned |
| 7     | Extras: enchanting, brewing, villages, farming, weather, settings                                                             | planned |
| 8     | Multiplayer: Node server reusing `engine/`                                                                                    | planned |
