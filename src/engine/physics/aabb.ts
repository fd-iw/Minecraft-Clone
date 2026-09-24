/** Mutable axis-aligned bounding box. */
export class AABB {
  constructor(
    public minX = 0,
    public minY = 0,
    public minZ = 0,
    public maxX = 0,
    public maxY = 0,
    public maxZ = 0,
  ) {}

  set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): this {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    return this;
  }

  copy(o: AABB): this {
    return this.set(o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ);
  }

  clone(): AABB {
    return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
  }

  offset(dx: number, dy: number, dz: number): this {
    this.minX += dx;
    this.minY += dy;
    this.minZ += dz;
    this.maxX += dx;
    this.maxY += dy;
    this.maxZ += dz;
    return this;
  }

  /** Returns a new box grown in the direction of motion (covers the whole swept volume). */
  expandTowards(dx: number, dy: number, dz: number): AABB {
    return new AABB(
      dx < 0 ? this.minX + dx : this.minX,
      dy < 0 ? this.minY + dy : this.minY,
      dz < 0 ? this.minZ + dz : this.minZ,
      dx > 0 ? this.maxX + dx : this.maxX,
      dy > 0 ? this.maxY + dy : this.maxY,
      dz > 0 ? this.maxZ + dz : this.maxZ,
    );
  }

  intersects(o: AABB): boolean {
    return (
      this.minX < o.maxX &&
      this.maxX > o.minX &&
      this.minY < o.maxY &&
      this.maxY > o.minY &&
      this.minZ < o.maxZ &&
      this.maxZ > o.minZ
    );
  }

  /** Clips movement `dx` of box `mover` against this box along X. */
  clipX(mover: AABB, dx: number): number {
    if (mover.maxY <= this.minY || mover.minY >= this.maxY) return dx;
    if (mover.maxZ <= this.minZ || mover.minZ >= this.maxZ) return dx;
    if (dx > 0 && mover.maxX <= this.minX) {
      const d = this.minX - mover.maxX;
      if (d < dx) return d;
    } else if (dx < 0 && mover.minX >= this.maxX) {
      const d = this.maxX - mover.minX;
      if (d > dx) return d;
    }
    return dx;
  }

  clipY(mover: AABB, dy: number): number {
    if (mover.maxX <= this.minX || mover.minX >= this.maxX) return dy;
    if (mover.maxZ <= this.minZ || mover.minZ >= this.maxZ) return dy;
    if (dy > 0 && mover.maxY <= this.minY) {
      const d = this.minY - mover.maxY;
      if (d < dy) return d;
    } else if (dy < 0 && mover.minY >= this.maxY) {
      const d = this.maxY - mover.minY;
      if (d > dy) return d;
    }
    return dy;
  }

  clipZ(mover: AABB, dz: number): number {
    if (mover.maxX <= this.minX || mover.minX >= this.maxX) return dz;
    if (mover.maxY <= this.minY || mover.minY >= this.maxY) return dz;
    if (dz > 0 && mover.maxZ <= this.minZ) {
      const d = this.minZ - mover.maxZ;
      if (d < dz) return d;
    } else if (dz < 0 && mover.minZ >= this.maxZ) {
      const d = this.maxZ - mover.minZ;
      if (d > dz) return d;
    }
    return dz;
  }

  /**
   * Ray/box intersection (slab method). Returns entry distance and entry face, or null.
   * Face uses the Face enum ordering (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z).
   */
  rayIntersect(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ): { t: number; face: number } | null {
    let tmin = -Infinity;
    let tmax = Infinity;
    let face = -1;
    const axes: [number, number, number, number, number, number][] = [
      [ox, dx, this.minX, this.maxX, 1, 0],
      [oy, dy, this.minY, this.maxY, 3, 2],
      [oz, dz, this.minZ, this.maxZ, 5, 4],
    ];
    for (const [o, d, lo, hi, faceLo, faceHi] of axes) {
      if (Math.abs(d) < 1e-12) {
        if (o < lo || o > hi) return null;
        continue;
      }
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      let f = faceLo;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        f = faceHi;
      }
      if (t1 > tmin) {
        tmin = t1;
        face = f;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    return { t: Math.max(0, tmin), face };
  }
}
