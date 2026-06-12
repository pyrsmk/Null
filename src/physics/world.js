import * as THREE from 'three';
import { CFG, totalW, totalD } from '../config.js';

// ── Base classes ───────────────────────────────────────────────────

export class WorldObject {}

export class Surface extends WorldObject {
  // Modifies vel in-place to prevent penetration.
  // Only called on surfaces returned by World.isCollidingWith().
  alterVelocity(_pos, _vel, _margin) {}

  // Returns the surface normal (used for transition orientation only).
  get normal() { return null; }

  // Returns dot(anyPointOnFace, normal) — plane equation offset.
  get offset() { return 0; }
}

// ── WallFace ───────────────────────────────────────────────────────
// Rectangular face defined by:
//   normal  : unit vector perpendicular to the face
//   offset  : dot(anyPointOnFace, normal)
//   u0,u1   : bounds along first tangent axis
//   v0,v1   : bounds along second tangent axis

export class WallFace extends Surface {
  constructor(nx, ny, nz, planeOffset, u0, u1, v0, v1) {
    super();
    this._normal = new THREE.Vector3(nx, ny, nz);
    this._offset = planeOffset;
    this._u0 = u0; this._u1 = u1;
    this._v0 = v0; this._v1 = v1;

    // Pre-compute tangent axes for 2D bounds checks
    if (Math.abs(ny) > 0.9) {
      this._tU = new THREE.Vector3(1, 0, 0);
      this._tV = new THREE.Vector3(0, 0, 1);
    } else if (Math.abs(nx) > 0.9) {
      this._tU = new THREE.Vector3(0, 0, 1);
      this._tV = new THREE.Vector3(0, 1, 0);
    } else {
      this._tU = new THREE.Vector3(1, 0, 0);
      this._tV = new THREE.Vector3(0, 1, 0);
    }
  }

  get normal() { return this._normal; }
  get offset() { return this._offset; }

  // Signed distance from pos to face plane (+ = on normal side)
  _signedDist(pos) {
    return pos.dot(this._normal) - this._offset;
  }

  // Is pos within the face's 2D bounds (with optional margin)?
  _inBounds(pos, margin = 0) {
    const u = pos.dot(this._tU);
    const v = pos.dot(this._tV);
    return u >= this._u0 - margin && u <= this._u1 + margin
        && v >= this._v0 - margin && v <= this._v1 + margin;
  }

  // Returns true if pos is within margin of this face AND vec is approaching it,
  // OR if pos has already penetrated (sd < 0) and is still going inward.
  _isApproaching(pos, vec, margin) {
    const sd = this._signedDist(pos);
    if (sd > margin) return false;
    if (sd < -margin) return false; // deep penetration, skip
    if (!this._inBounds(pos, margin)) return false;
    if (sd < 0) return true; // already penetrating → eject unconditionally
    return vec.dot(this._normal) < 0;
  }

  alterVelocity(pos, vel, _margin) {
    const perp = vel.dot(this._normal);
    if (perp >= 0) return; // not approaching (safety check after multi-surface resolution)
    vel.x -= perp * this._normal.x;
    vel.y -= perp * this._normal.y;
    vel.z -= perp * this._normal.z;
    // If already penetrating, add a depenetration impulse to recover position
    const sd = this._signedDist(pos);
    if (sd < 0) {
      vel.x -= sd * this._normal.x; // sd negative → pushes outward
      vel.y -= sd * this._normal.y;
      vel.z -= sd * this._normal.z;
    }
  }

  // Public signed distance (positive = on normal side).
  signedDist(pos) { return this._signedDist(pos); }

  // Perpendicular distance from pos to face plane — used for transition ranking.
  distanceTo(pos) {
    return Math.abs(this._signedDist(pos));
  }
}

// ── World ──────────────────────────────────────────────────────────

const _wup = new THREE.Vector3();
const _ray = new THREE.Vector3();

export class World {
  constructor() {
    // Spatial grid: "col,row" → WorldObject[]
    this._grid   = new Map();
    // Global objects checked for every query (e.g. floor surface)
    this._global = [];
  }

  // Register an object in a specific grid cell
  add(obj, col, row) {
    const key = `${col},${row}`;
    if (!this._grid.has(key)) this._grid.set(key, []);
    this._grid.get(key).push(obj);
  }

  // Register an object that is always checked regardless of position
  addGlobal(obj) {
    this._global.push(obj);
  }

  // Returns WorldObjects in the 3×3 grid neighbourhood around (px, pz) + globals
  _nearby(px, pz) {
    const col = Math.round((px + totalW / 2) / CFG.spacing);
    const row = Math.round((pz + totalD / 2) / CFG.spacing);
    const result = this._global.slice();
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const cell = this._grid.get(`${col + dc},${row + dr}`);
        if (cell) for (const obj of cell) result.push(obj);
      }
    }
    return result;
  }

  // Returns Surface instances that pos is approaching (within margin, in direction vec).
  // The caller (player) decides what position to use: camera pos for body, feet for ground.
  isCollidingWith(pos, vec, margin) {
    const result = [];
    for (const obj of this._nearby(pos.x, pos.z)) {
      if (obj instanceof WallFace && obj._isApproaching(pos, vec, margin))
        result.push(obj);
    }
    return result;
  }

  // Returns all registered surfaces (all grid cells + globals).
  _all() {
    const result = this._global.slice();
    for (const cell of this._grid.values())
      for (const obj of cell) result.push(obj);
    return result;
  }

  // Returns the surface the player is looking at (ray from pos along lookDir),
  // whose normal diverges ≥ 45° from worldUp and that the player stands in front of.
  findTransitionCandidate(pos, worldUp, lookDir, maxDist) {
    let best = null, bestT = maxDist;
    for (const obj of this._all()) {
      if (!(obj instanceof WallFace)) continue;
      const dot = _wup.copy(obj.normal).dot(worldUp);
      if (Math.acos(Math.max(-1, Math.min(1, dot))) < Math.PI / 4) continue;
      if (obj._signedDist(pos) < 0) continue; // player must be on normal side
      // Ray-plane intersection: t = (offset - dot(pos, normal)) / dot(lookDir, normal)
      const denom = lookDir.dot(obj._normal);
      if (denom >= 0) continue; // ray pointing away from or parallel to surface
      const t = (obj._offset - pos.dot(obj._normal)) / denom;
      if (t <= 0 || t >= bestT) continue;
      // Check if the ray hits within the face bounds
      _ray.copy(pos).addScaledVector(lookDir, t);
      if (!obj._inBounds(_ray)) continue;
      bestT = t;
      best = obj;
    }
    if (!best) return null;
    return { surface: best, hitPoint: _ray.copy(pos).addScaledVector(lookDir, bestT).clone() };
  }
}
