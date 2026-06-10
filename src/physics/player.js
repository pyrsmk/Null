import * as THREE from 'three';
import { CFG, totalW, totalD } from '../config.js';

const JUMP_STRENGTH      = 3.1;
const GRAVITY            = 0.08;
const CAM_BASE_Y         = 75;
const BOB_AMPLITUDE      = 1.75;
const BOB_SPEED          = 0.10;
const ZERO_G_FRAMES      = 6;
const GLITCH_FRAMES      = 10;
const SURFACE_THRESHOLD  = Math.PI / 4;
const SURFACE_MARGIN     = 30;
const MIN_JUMP_OFFSET    = -(CAM_BASE_Y - CFG.camRadius - 1);

// Reusable temporaries
const _yAxis = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _mat = new THREE.Matrix4();

export class Player {
  constructor(buildings) {
    this._buildings = buildings;

    this.pos = new THREE.Vector3(
      0, CAM_BASE_Y,
      (CFG.gridRows - 1) * CFG.spacing / 2 + CFG.buildingW / 2 + 1800
    );

    // Maps player-local axes to world axes. Identity = on floor (local Y = world Y).
    this.worldRotation = new THREE.Quaternion();

    this.yaw   = 0;
    this.pitch = 0;

    this._surfaceBaseH       = 0;
    this._jumpOffset         = 0;
    this._velUp              = 0;
    this._jumpedWithSprint   = false;

    this._bobPhase    = 0;
    this._bobStrength = 0;

    this._zeroGFrames   = 0;
    this._pendingSurface = null;
    this.glitchFrames    = 0;
  }

  get x() { return this.pos.x; }
  get y() { return this.pos.y; }
  get z() { return this.pos.z; }
  get glitchStrength() {
    return this.glitchFrames > 0 ? this.glitchFrames / GLITCH_FRAMES : 0;
  }

  getWorldUp(out) {
    return out.set(0, 1, 0).applyQuaternion(this.worldRotation);
  }

  getCameraQuaternion(out) {
    _q1.setFromAxisAngle(_yAxis, -this.yaw);
    out.copy(this.worldRotation).multiply(_q1);
    _q1.setFromAxisAngle(_v1.set(1, 0, 0), -this.pitch);
    out.multiply(_q1);
    return out;
  }

  // ── Collision ─────────────────────────────────────────────────────

  _isInsideBuilding(x, y, z) {
    if (y < 0 || y > CFG.buildingH) return false;
    const hw  = CFG.buildingW / 2 + CFG.camRadius;
    const col = Math.round((x + totalW / 2) / CFG.spacing);
    const row = Math.round((z + totalD / 2) / CFG.spacing);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = col + dc, r = row + dr;
        if (c < 0 || c >= CFG.gridCols || r < 0 || r >= CFG.gridRows) continue;
        const bx = c * CFG.spacing - totalW / 2;
        const bz = r * CFG.spacing - totalD / 2;
        if (Math.abs(x - bx) < hw && Math.abs(z - bz) < hw) return true;
      }
    }
    return false;
  }

  _depenetrate() {
    const hw  = CFG.buildingW / 2 + CFG.camRadius;
    const col = Math.round((this.pos.x + totalW / 2) / CFG.spacing);
    const row = Math.round((this.pos.z + totalD / 2) / CFG.spacing);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = col + dc, r = row + dr;
        if (c < 0 || c >= CFG.gridCols || r < 0 || r >= CFG.gridRows) continue;
        const bx = c * CFG.spacing - totalW / 2;
        const bz = r * CFG.spacing - totalD / 2;
        if (this.pos.y < 0 || this.pos.y > CFG.buildingH) continue;
        const ddx = this.pos.x - bx, ddz = this.pos.z - bz;
        const ox = hw - Math.abs(ddx), oz = hw - Math.abs(ddz);
        if (ox <= 0 || oz <= 0) continue;
        if (ox < oz) this.pos.x += Math.sign(ddx) * (ox + 0.5);
        else         this.pos.z += Math.sign(ddz) * (oz + 0.5);
      }
    }
  }

  // ── Ground detection ──────────────────────────────────────────────

  _getGroundHeight() {
    const worldUp = this.getWorldUp(_v1);

    if (worldUp.y > 0.9) {
      // Floor: ground is at y=0, building roofs provide elevated platforms
      const hw = CFG.buildingW / 2;
      let height = 0;
      const col = Math.round((this.pos.x + totalW / 2) / CFG.spacing);
      const row = Math.round((this.pos.z + totalD / 2) / CFG.spacing);
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const c = col + dc, r = row + dr;
          if (c < 0 || c >= CFG.gridCols || r < 0 || r >= CFG.gridRows) continue;
          const bx = c * CFG.spacing - totalW / 2;
          const bz = r * CFG.spacing - totalD / 2;
          if (Math.abs(this.pos.x - bx) <= hw && Math.abs(this.pos.z - bz) <= hw)
            height = CFG.buildingH;
        }
      }
      return height;
    }

    // Wall: ground exists only where a building face is under the player's feet
    const feetX = this.pos.x - worldUp.x * CAM_BASE_Y;
    const feetY = this.pos.y - worldUp.y * CAM_BASE_Y;
    const feetZ = this.pos.z - worldUp.z * CAM_BASE_Y;
    if (feetY < 0 || feetY > CFG.buildingH) return -Infinity;

    const hw  = CFG.buildingW / 2;
    const tol = CFG.camRadius + 2;
    const bcx = feetX - worldUp.x * hw;
    const bcz = feetZ - worldUp.z * hw;
    const col = Math.round((bcx + totalW / 2) / CFG.spacing);
    const row = Math.round((bcz + totalD / 2) / CFG.spacing);

    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = col + dc, r = row + dr;
        if (c < 0 || c >= CFG.gridCols || r < 0 || r >= CFG.gridRows) continue;
        const bx = c * CFG.spacing - totalW / 2;
        const bz = r * CFG.spacing - totalD / 2;
        if (Math.abs(worldUp.x) > 0.9) {
          if (Math.abs(feetX - (bx + worldUp.x * hw)) < tol && Math.abs(feetZ - bz) <= hw)
            return 0;
        } else if (Math.abs(worldUp.z) > 0.9) {
          if (Math.abs(feetZ - (bz + worldUp.z * hw)) < tol && Math.abs(feetX - bx) <= hw)
            return 0;
        }
      }
    }
    return -Infinity;
  }

  // ── Surface transition detection ──────────────────────────────────

  _findTransitionCandidate() {
    const worldUp = this.getWorldUp(_v1);
    const hw      = CFG.buildingW / 2;
    const maxDist = 100;
    const px = this.pos.x, py = this.pos.y, pz = this.pos.z;

    let best     = null;
    let bestDist = maxDist;

    const col = Math.round((px + totalW / 2) / CFG.spacing);
    const row = Math.round((pz + totalD / 2) / CFG.spacing);

    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = col + dc, r = row + dr;
        if (c < 0 || c >= CFG.gridCols || r < 0 || r >= CFG.gridRows) continue;
        const bx = c * CFG.spacing - totalW / 2;
        const bz = r * CFG.spacing - totalD / 2;

        // Wall faces: [nx, nz, faceCoord, otherAxisDist, dist]
        const faces = [
          [  1, 0, bx + hw, Math.abs(pz - bz), px - (bx + hw) ],
          [ -1, 0, bx - hw, Math.abs(pz - bz), (bx - hw) - px ],
          [ 0,  1, bz + hw, Math.abs(px - bx), pz - (bz + hw) ],
          [ 0, -1, bz - hw, Math.abs(px - bx), (bz - hw) - pz ],
        ];

        for (const [nx, nz, , otherDist, dist] of faces) {
          if (dist <= 0 || dist >= bestDist) continue;
          if (otherDist > hw + maxDist) continue;
          if (py < -maxDist || py > CFG.buildingH + maxDist) continue;
          const dot = worldUp.x * nx + worldUp.z * nz;
          if (Math.acos(Math.max(-1, Math.min(1, dot))) < SURFACE_THRESHOLD) continue;
          bestDist = dist;
          best = { nx, ny: 0, nz, baseH: bx * nx + bz * nz + hw };
        }

        // Roof face (+Y)
        const roofDist = Math.abs(py - CFG.buildingH);
        if (roofDist < bestDist
          && Math.abs(px - bx) <= hw + maxDist
          && Math.abs(pz - bz) <= hw + maxDist) {
          const angle = Math.acos(Math.max(-1, Math.min(1, worldUp.y)));
          if (angle >= SURFACE_THRESHOLD) {
            bestDist = roofDist;
            best = { nx: 0, ny: 1, nz: 0, baseH: 0 };
          }
        }
      }
    }

    // Floor surface: dist = py (camera height above y=0, consistent with wall dist)
    if (py >= 0 && py < bestDist) {
      const angle = Math.acos(Math.max(-1, Math.min(1, worldUp.y)));
      if (angle >= SURFACE_THRESHOLD) {
        best = { nx: 0, ny: 1, nz: 0, baseH: 0 };
      }
    }

    return best;
  }

  // ── Surface activation ────────────────────────────────────────────

  _activateSurface(surf) {
    const newUp = _v1.set(surf.nx, surf.ny, surf.nz);

    // Minimal rotation from current world-up to new surface normal.
    // Pre-multiplying worldRotation preserves the camera orientation as much
    // as possible: yaw/pitch values stay unchanged and the view direction only
    // rotates by exactly the amount needed to plant the player on the surface.
    _q1.setFromUnitVectors(this.getWorldUp(_v2), newUp);
    this.worldRotation.premultiply(_q1);

    // Position: keep player in place, compute jumpOffset from current distance to surface
    const posAlongUp = this.pos.dot(newUp);
    this._surfaceBaseH     = surf.baseH;
    this._jumpOffset       = Math.max(0, posAlongUp - surf.baseH - CAM_BASE_Y);
    this._velUp            = 0;
    this._jumpedWithSprint = false;
  }

  // ── Main update ───────────────────────────────────────────────────

  update(keyboard, gp) {
    // Zero-G transition
    if (this._zeroGFrames > 0) {
      this._zeroGFrames--;
      if (this._zeroGFrames === 0 && this._pendingSurface) {
        this._activateSurface(this._pendingSurface);
        this._pendingSurface = null;
        this.glitchFrames    = GLITCH_FRAMES;
      }
      return;
    }

    if (this.glitchFrames > 0) this.glitchFrames--;

    const sprint      = keyboard.has('ShiftLeft') || keyboard.has('ShiftRight')
                     || (gp?.sprint ?? false);
    const jumpPressed = keyboard.wasJustPressed('Space') || (gp?.jump ?? false);
    const ePressed    = keyboard.wasJustPressed('KeyE');

    const airSprintBoost = this._jumpedWithSprint ? 1.1 : 1.0;
    const s = CFG.camSpeed * (sprint ? 4 : 1) * airSprintBoost;

    // ── Movement in local frame ─────────────────────────────────────
    let lx = 0, lz = 0;
    if (gp) { lx += gp.ax; lz += gp.az; }
    if (keyboard.has('ArrowUp')    || keyboard.has('KeyW')) lz -= 1;
    if (keyboard.has('ArrowDown')  || keyboard.has('KeyS')) lz += 1;
    if (keyboard.has('ArrowLeft')  || keyboard.has('KeyA')) lx -= 1;
    if (keyboard.has('ArrowRight') || keyboard.has('KeyD')) lx += 1;

    // Apply yaw, scale by speed, convert to world space
    _q1.setFromAxisAngle(_yAxis, -this.yaw);
    _v1.set(lx, 0, lz).applyQuaternion(_q1).multiplyScalar(s);
    _v1.applyQuaternion(this.worldRotation);
    const wmx = _v1.x, wmy = _v1.y, wmz = _v1.z;

    // ── Collision per world axis ────────────────────────────────────
    if (!this._isInsideBuilding(this.pos.x + wmx, this.pos.y, this.pos.z)) this.pos.x += wmx;
    if (!this._isInsideBuilding(this.pos.x, this.pos.y + wmy, this.pos.z)) this.pos.y += wmy;
    if (!this._isInsideBuilding(this.pos.x, this.pos.y, this.pos.z + wmz)) this.pos.z += wmz;

    this._depenetrate();

    // ── World bounds ────────────────────────────────────────────────
    const wb = CFG.far;
    this.pos.x = Math.max(-wb, Math.min(wb, this.pos.x));
    this.pos.z = Math.max(-wb, Math.min(wb, this.pos.z));
    // Prevent camera from clipping through horizontal surfaces in wall mode
    if (this.getWorldUp(_v1).y < 0.9) {
      this.pos.y = Math.max(SURFACE_MARGIN, Math.min(CFG.buildingH - SURFACE_MARGIN, this.pos.y));
    }

    // ── Gravity & jump ──────────────────────────────────────────────
    const groundH = this._getGroundHeight();
    const grounded = this._jumpOffset <= groundH && this._velUp <= 0;

    if (jumpPressed && grounded) {
      this._velUp            = JUMP_STRENGTH * (sprint ? 1.6 : 1.0);
      this._jumpedWithSprint = sprint;
    }

    if (!grounded) {
      this._velUp      -= GRAVITY;
      this._jumpOffset += this._velUp;
      if (this._jumpOffset <= groundH && groundH > -Infinity) {
        this._jumpOffset       = groundH;
        this._velUp            = 0;
        this._jumpedWithSprint = false;
      }
      // Clamp to prevent drifting through walls when near a surface
      if (groundH !== -Infinity && this._jumpOffset < MIN_JUMP_OFFSET) {
        this._jumpOffset = MIN_JUMP_OFFSET;
        this._velUp      = 0;
      }
    }

    // ── Head bob ────────────────────────────────────────────────────
    const moving   = lx !== 0 || lz !== 0;
    const airborne = !grounded;
    this._bobStrength = (moving && !airborne)
      ? Math.min(1, this._bobStrength + 0.06)
      : Math.max(0, this._bobStrength - 0.04);
    if (this._bobStrength > 0) this._bobPhase += BOB_SPEED * (sprint ? 2.5 : 1);
    const bobOff = Math.sin(this._bobPhase) * BOB_AMPLITUDE * this._bobStrength;

    // ── Apply surface height along world up ─────────────────────────
    const worldUp = this.getWorldUp(_v1);
    const targetH = this._surfaceBaseH + CAM_BASE_Y + this._jumpOffset + bobOff;
    const curH    = this.pos.dot(worldUp);
    this.pos.addScaledVector(worldUp, targetH - curH);

    // ── E key: surface transition ───────────────────────────────────
    if (ePressed) {
      const candidate = this._findTransitionCandidate();
      if (candidate) {
        this._zeroGFrames   = ZERO_G_FRAMES;
        this._pendingSurface = candidate;
      }
    }
  }
}
