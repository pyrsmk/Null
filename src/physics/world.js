import * as THREE from 'three';
import { CFG, totalW, totalD } from '../config.js';

// ── Contact ────────────────────────────────────────────────────────
// Result of a sphere-vs-surface query. The normal is a property of the
// CONTACT, not of the surface: facing the interior of a face it equals
// the face normal, but near an edge or corner it tilts toward the player
// (direction from the closest point on the bounded face to the player).
//
// `dist` is the generalized signed distance:
//   - player projects inside the face bounds → plane signed distance
//     (negative = penetration)
//   - player projects outside the bounds → distance to the closest point
//     on the face (always ≥ 0; an edge cannot be penetrated from behind)
//
// Each WallFace owns one reusable Contact: the data is TRANSIENT, valid
// only until that face's next query. Callers must consume it immediately
// (or copy what they need).

export class Contact {
  constructor() {
    this.surface = null;
    this.normal  = new THREE.Vector3();
    this.point   = new THREE.Vector3(); // closest point on the bounded face
    this.dist    = 0;
  }

  // Clamps the inbound velocity component along the contact normal so the
  // caller arrives at `restDist` from the surface and no closer. Without
  // restDist, kills all inbound velocity (stop at the current distance).
  // NEVER adds outbound velocity: penetration recovery is positional and
  // owned by the caller — injecting it as kinetic energy causes trampolines.
  alterVelocity(vel, restDist = this.dist) {
    const gap  = Math.max(0, this.dist - restDist);
    const perp = vel.dot(this.normal);
    if (perp >= -gap) return; // not approaching beyond the allowed gap
    vel.addScaledVector(this.normal, -(perp + gap));
  }
}

// ── Base classes ───────────────────────────────────────────────────

export class WorldObject {}

export class Surface extends WorldObject {
  // Returns a transient Contact if the sphere (pos, margin) moving along
  // vec collides with this surface, null otherwise.
  contactWith(_pos, _vec, _margin) { return null; }

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

    this._contact = new Contact();
  }

  get normal() { return this._normal; }
  get offset() { return this._offset; }

  // Signed distance from pos to face plane (+ = on normal side)
  _signedDist(pos) {
    return pos.dot(this._normal) - this._offset;
  }

  // Is pos within the face's 2D bounds?
  _inBounds(pos) {
    const u = pos.dot(this._tU);
    const v = pos.dot(this._tV);
    return u >= this._u0 && u <= this._u1
        && v >= this._v0 && v <= this._v1;
  }

  // Fills `out` with closest-feature data for pos (no approach/margin check):
  // generalized signed distance, contact normal, closest point on the face.
  measure(pos, out) {
    const sd = this._signedDist(pos);
    const u  = pos.dot(this._tU);
    const v  = pos.dot(this._tV);
    const du = u - Math.min(Math.max(u, this._u0), this._u1);
    const dv = v - Math.min(Math.max(v, this._v0), this._v1);

    out.surface = this;
    out.point.copy(pos)
      .addScaledVector(this._normal, -sd)
      .addScaledVector(this._tU, -du)
      .addScaledVector(this._tV, -dv);

    if (du === 0 && dv === 0) {
      // Inside bounds: plane contact (dist may be negative = penetration)
      out.dist = sd;
      out.normal.copy(this._normal);
    } else {
      // Edge/corner region: contact normal points from the closest point
      // on the face toward the player
      out.dist = Math.sqrt(sd * sd + du * du + dv * dv);
      if (out.dist > 1e-6) {
        out.normal.copy(this._normal).multiplyScalar(sd / out.dist)
          .addScaledVector(this._tU, du / out.dist)
          .addScaledVector(this._tV, dv / out.dist);
      } else {
        out.normal.copy(this._normal);
      }
    }
    return out;
  }

  // Returns the face's transient Contact if the sphere (pos, margin) moving
  // along vec collides with it, null otherwise. Penetration (inside bounds,
  // dist < 0) collides unconditionally; otherwise vec must approach the
  // contact. Deep penetration (dist < -margin) is skipped.
  contactWith(pos, vec, margin) {
    const sd = this._signedDist(pos);
    if (sd > margin || sd < -margin) return null; // quick plane rejection
    const c = this.measure(pos, this._contact);
    if (c.dist > margin) return null; // outside bounds, too far from the edge
    if (c.dist >= 0 && vec.dot(c.normal) >= 0) return null; // not approaching
    return c;
  }

  // Public signed distance (positive = on normal side).
  signedDist(pos) { return this._signedDist(pos); }
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

  // Returns the Contacts of all surfaces the sphere (pos, margin) moving along
  // vec collides with. The caller (player) decides what position to use:
  // camera pos for body, feet for ground. Contacts are transient — valid only
  // until the owning surface's next query.
  isCollidingWith(pos, vec, margin) {
    const result = [];
    for (const obj of this._nearby(pos.x, pos.z)) {
      if (obj instanceof WallFace) {
        const c = obj.contactWith(pos, vec, margin);
        if (c) result.push(c);
      }
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
