/** Block face / direction indices. Order is relied upon by the mesher and texture tables. */
export const enum Face {
  East = 0, // +X
  West = 1, // -X
  Up = 2, // +Y
  Down = 3, // -Y
  South = 4, // +Z
  North = 5, // -Z
}

export const FACE_COUNT = 6;

export const FACE_DX = [1, -1, 0, 0, 0, 0] as const;
export const FACE_DY = [0, 0, 1, -1, 0, 0] as const;
export const FACE_DZ = [0, 0, 0, 0, 1, -1] as const;

export const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4] as const;

export const FACE_NAMES = ['east', 'west', 'up', 'down', 'south', 'north'] as const;

/** Horizontal faces in clockwise order starting from south (matches yaw quadrants). */
export const HORIZONTAL_FACES = [Face.South, Face.West, Face.North, Face.East] as const;

/**
 * Converts a yaw (radians, 0 = looking towards -Z / north, increasing counter-clockwise when seen
 * from above) to the horizontal face the entity is looking towards.
 */
export function faceFromYaw(yaw: number): Face {
  const q = Math.round(yaw / (Math.PI / 2)) & 3;
  // yaw 0 -> north, PI/2 -> west, PI -> south, 3PI/2 -> east
  return [Face.North, Face.West, Face.South, Face.East][q];
}
