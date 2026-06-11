import * as THREE from 'three';
import { CFG } from '../config.js';

const JUMP_STRENGTH      = 2.5;
const GRAVITY            = 0.08;
const CAM_BASE_Y         = 75;
const BOB_AMPLITUDE      = 1.75;
const BOB_SPEED          = 0.10;
const TRANSITION_FRAMES  = 30;
const GLITCH_FRAMES      = 10;
const AIR_STEER          = 0.12;

// Reusable temporaries
const _yAxis = new THREE.Vector3(0, 1, 0);
const _v1    = new THREE.Vector3();
const _v2    = new THREE.Vector3();
const _v3    = new THREE.Vector3();
const _q1    = new THREE.Quaternion();
const _q2    = new THREE.Quaternion();

export class Player {
  constructor(world) {
    this._world = world;

    this.pos = new THREE.Vector3(
      0, CAM_BASE_Y + CFG.camRadius,
      (CFG.gridRows - 1) * CFG.spacing / 2 + CFG.buildingW / 2 + 1800
    );

    // Maps player-local axes to world axes. Identity = on floor (local Y = world Y).
    this.worldRotation = new THREE.Quaternion();

    this.yaw   = 0;
    this.pitch = 0;

    // Unified 3D velocity
    this._vel             = new THREE.Vector3();
    this._grounded        = true;
    this._jumpedWithSprint = false;

    this._bobPhase    = 0;
    this._bobStrength = 0;

    this._transitionFrames    = 0;
    this._transitionTotal     = 0;
    this._transitionStartRot  = new THREE.Quaternion();
    this._transitionTargetRot = new THREE.Quaternion();
    this._transitionStartPos  = new THREE.Vector3();
    this._transitionTargetPos = new THREE.Vector3();
    this.glitchFrames         = 0;
    this._bobOffset           = 0;
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

  // ── Surface transition ────────────────────────────────────────────

  _startTransition(surf) {
    const newUp = _v1.set(surf.nx, surf.ny, surf.nz);

    // Compute target position: feet land at CAM_BASE_Y + camRadius from surface
    const currentDist = newUp.dot(this.pos) - surf.offset;
    this._transitionTargetPos.copy(this.pos)
      .addScaledVector(newUp, (CAM_BASE_Y + CFG.camRadius) - currentDist);

    // Compute target worldRotation: local Y → new surface normal
    _q1.setFromUnitVectors(this.getWorldUp(_v2), newUp);
    this._transitionTargetRot.copy(this.worldRotation).premultiply(_q1);

    // Snapshot start state
    this._transitionStartRot.copy(this.worldRotation);
    this._transitionStartPos.copy(this.pos);

    this._vel.set(0, 0, 0);
    this._transitionFrames = TRANSITION_FRAMES;
    this._transitionTotal  = TRANSITION_FRAMES;
  }

  // ── Main update ───────────────────────────────────────────────────

  update(keyboard, gp) {
    // Surface transition animation
    if (this._transitionFrames > 0) {
      this._transitionFrames--;
      const t    = 1 - this._transitionFrames / this._transitionTotal;
      const ease = t * t * (3 - 2 * t); // smoothstep
      this.worldRotation.slerpQuaternions(
        this._transitionStartRot, this._transitionTargetRot, ease);
      this.pos.lerpVectors(
        this._transitionStartPos, this._transitionTargetPos, ease);
      if (this._transitionFrames === 0) {
        this._grounded        = false;
        this._jumpedWithSprint = false;
        this.glitchFrames     = GLITCH_FRAMES;
      }
      return;
    }

    if (this.glitchFrames > 0) this.glitchFrames--;

    const sprint      = keyboard.has('ShiftLeft') || keyboard.has('ShiftRight')
                     || (gp?.sprint ?? false);
    const jumpPressed = keyboard.wasJustPressed('Space') || (gp?.jump ?? false);
    const ePressed    = keyboard.wasJustPressed('KeyE');

    const worldUp = this.getWorldUp(_v1);

    // ── Input direction (local frame → world space) ─────────────────
    let lx = 0, lz = 0;
    if (gp) { lx += gp.ax; lz += gp.az; }
    if (keyboard.has('ArrowUp')    || keyboard.has('KeyW')) lz -= 1;
    if (keyboard.has('ArrowDown')  || keyboard.has('KeyS')) lz += 1;
    if (keyboard.has('ArrowLeft')  || keyboard.has('KeyA')) lx -= 1;
    if (keyboard.has('ArrowRight') || keyboard.has('KeyD')) lx += 1;

    _q1.setFromAxisAngle(_yAxis, -this.yaw);
    const inputDir = _v2.set(lx, 0, lz);
    if (lx !== 0 || lz !== 0) inputDir.normalize();
    inputDir.applyQuaternion(_q1).applyQuaternion(this.worldRotation);

    // ── Decompose velocity into surface-plane + normal components ───
    const normalComp = this._vel.dot(worldUp);
    // planeVel = vel - worldUp * normalComp
    const planeVel = _v3.copy(this._vel).addScaledVector(worldUp, -normalComp);

    // ── Apply gravity to normal component ──────────────────────────
    let newNormalComp = normalComp - GRAVITY;

    // ── Directional control ─────────────────────────────────────────
    const groundSpeed    = CFG.camSpeed * (sprint ? 4 : 1);
    const airSprintBoost = this._jumpedWithSprint ? 1.1 : 1.0;

    if (this._grounded) {
      // Direct control: replace plane velocity with input
      planeVel.copy(inputDir).multiplyScalar(groundSpeed);
    } else {
      // Air: small steer nudge, clamp to max speed
      const steer  = CFG.camSpeed * AIR_STEER * airSprintBoost;
      planeVel.addScaledVector(inputDir, steer);
      const maxSpd = CFG.camSpeed * (this._jumpedWithSprint ? 4 : 1) * airSprintBoost;
      const spd    = planeVel.length();
      if (spd > maxSpd) planeVel.multiplyScalar(maxSpd / spd);
    }

    // ── Jump ────────────────────────────────────────────────────────
    if (jumpPressed && this._grounded) {
      newNormalComp          += JUMP_STRENGTH * (sprint ? 1.6 : 1.0);
      this._jumpedWithSprint  = sprint;
    }

    // ── Recombine velocity ──────────────────────────────────────────
    this._vel.copy(planeVel).addScaledVector(worldUp, newNormalComp);

    // ── Collision : feet (ground support) ──────────────────────────
    // Expand detection margin by the downward velocity so fast falls
    // never skip over the collision zone (swept check along normal axis).
    const velDown    = Math.max(0, -this._vel.dot(worldUp));
    const feetMargin = CFG.camRadius + velDown;
    const feetPos    = _v2.copy(this.pos).addScaledVector(worldUp, -CAM_BASE_Y);
    const groundHits = this._world.isCollidingWith(feetPos, this._vel, feetMargin);
    for (const s of groundHits) s.alterVelocity(feetPos, this._vel, CFG.camRadius);

    // ── Collision : body (lateral obstacles) ───────────────────────
    for (const s of this._world.isCollidingWith(this.pos, this._vel, CFG.camRadius))
      s.alterVelocity(this.pos, this._vel, CFG.camRadius);

    // ── Move ────────────────────────────────────────────────────────
    this.pos.add(this._vel);

    // ── Update grounded state (used next frame for input control) ───
    this._grounded = groundHits.length > 0;
    if (this._grounded) this._jumpedWithSprint = false;

    // ── Head bob ────────────────────────────────────────────────────
    const moving = lx !== 0 || lz !== 0;
    this._bobStrength = (moving && this._grounded)
      ? Math.min(1, this._bobStrength + 0.06)
      : Math.max(0, this._bobStrength - 0.04);
    if (this._bobStrength > 0) this._bobPhase += BOB_SPEED * (sprint ? 2.5 : 1);
    this._bobOffset = Math.sin(this._bobPhase) * BOB_AMPLITUDE * this._bobStrength;

    // ── E key: surface transition ───────────────────────────────────
    if (ePressed) {
      // Compute look direction from camera orientation, then restore _v1 (worldUp)
      this.getCameraQuaternion(_q2);
      const lookDir = _v3.set(0, 0, -1).applyQuaternion(_q2);
      this.getWorldUp(_v1);
      const surface = this._world.findTransitionCandidate(this.pos, worldUp, lookDir, 150);
      if (surface) {
        this._startTransition({
          nx:     surface.normal.x,
          ny:     surface.normal.y,
          nz:     surface.normal.z,
          offset: surface.offset,
        });
      }
    }
  }
}
