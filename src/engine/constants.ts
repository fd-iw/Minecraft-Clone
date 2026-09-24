/** Horizontal chunk size in blocks (chunks are CHUNK_SIZE x WORLD_HEIGHT x CHUNK_SIZE columns). */
export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;

export const WORLD_HEIGHT = 256;
export const SECTION_COUNT = WORLD_HEIGHT / CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export const SEA_LEVEL = 62;

/** Simulation ticks per second (matches the classic 20 TPS game loop). */
export const TICKS_PER_SECOND = 20;
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;

/** Length of a full day/night cycle in ticks (20 minutes). */
export const DAY_LENGTH_TICKS = 24000;

export const MAX_LIGHT = 15;
