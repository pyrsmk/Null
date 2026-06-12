import * as THREE from 'three';
import { CFG } from '../config.js';

const JUMP_HEIGHT          = 3.5;
const JUMP_HEIGHT_SPRINT   = 7.0;
const JUMP_FORWARD_BOOST   = 2.0;
const GRAVITY              = 0.09;
const CAM_BASE_Y           = 75;
const BOB_AMPLITUDE        = 1.75;
const BOB_SPEED            = 0.10;
const TRANSITION_FRAMES    = 20;
const GLITCH_FRAMES        = 10;
const AIR_STEER            = 0.12;
const MIN_FALL_SPEED       = 1;
const PROJECTION_SPEED     = 80;

// Reusable temporaries
const _yAxis = new THREE.Vector3(0, 1, 0);
const _v1    = new THREE.Vector3();
const _v2    = new THREE.Vector3();
const _v3    = new THREE.Vector3();
const _q1    = new THREE.Quaternion();
const _q2    = new THREE.Quaternion();

// Reusable temporaries for landing prediction (isolated from update() temps)
const _predPos  = new THREE.Vector3();
const _predVel  = new THREE.Vector3();
const _predFeet = new THREE.Vector3();
const _predUp   = new THREE.Vector3();
const _predSnap = new THREE.Vector3();

export class Player {
  constructor(world, indicator = null, eIndicator = null) {
    this._world      = world;
    this._indicator  = indicator;
    this._eIndicator = eIndicator;

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
    this._airMaxSpeed      = CFG.camSpeed;

    this._bobPhase    = 0;
    this._bobStrength = 0;


    this._pendingTransition   = null;
    this._projecting          = false;
    this._projectTarget       = null;
    this._transitionFrames    = 0;
    this._transitionTotal     = 0;
    this._transitionStartRot  = new THREE.Quaternion();
    this._transitionTargetRot = new THREE.Quaternion();
    this._transitionStartPos  = new THREE.Vector3();
    this._transitionTargetPos = new THREE.Vector3();
    this.glitchFrames         = 0;
    this._bobOffset           = 0;
    this._launchFeetDotUp     = 0;
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
    this._airMaxSpeed      = CFG.camSpeed;
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

    // ── Projection flight (E key grapple) ─────────────────────────
    if (this._projecting) {
      const surf = this._projectTarget.surface;
      const sd   = surf.signedDist(this.pos);

      if (this._eIndicator)
        this._eIndicator.setTarget(this._projectTarget.hitPoint, surf.normal);

      if (sd <= CAM_BASE_Y + CFG.camRadius) {
        // Arrivée : snap perpendiculaire à la surface, puis transition
        this.pos.addScaledVector(surf.normal, (CAM_BASE_Y + CFG.camRadius) - sd);
        this._projecting    = false;
        this._projectTarget = null;
        this._vel.set(0, 0, 0);
        // Réorientation : regard perpendiculaire à la surface (= -normal dans le référentiel local)
        _v1.set(-surf.normal.x, -surf.normal.y, -surf.normal.z)
           .applyQuaternion(_q1.copy(this.worldRotation).conjugate());
        this.pitch = -Math.asin(Math.max(-1, Math.min(1, _v1.y)));
        this.yaw   = Math.atan2(_v1.x, -_v1.z);
        if (this._eIndicator) this._eIndicator.setTarget(null, null);
        this._startTransition({
          nx: surf.normal.x, ny: surf.normal.y, nz: surf.normal.z,
          offset: surf.offset,
        });
        return;
      }

      this.pos.add(this._vel);
      return;
    }

    if (this.glitchFrames > 0) this.glitchFrames--;

    const sprint      = keyboard.has('ShiftLeft') || keyboard.has('ShiftRight')
                     || (gp?.sprint ?? false);
    const jumpPressed = keyboard.wasJustPressed('Space') || (gp?.jump ?? false);

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
    const groundSpeed = CFG.camSpeed * (sprint ? 4.5 : 1.5);
    if (this._grounded) {
      // Direct control: replace plane velocity with input
      planeVel.copy(inputDir).multiplyScalar(groundSpeed);
    } else {
      // Air: small steer nudge, clamp to max speed (preserving jump boost)
      const steer  = CFG.camSpeed * AIR_STEER;
      planeVel.addScaledVector(inputDir, steer);
      const maxSpd = Math.max(CFG.camSpeed * (this._jumpedWithSprint ? 4 : 1), this._airMaxSpeed);
      const spd    = planeVel.length();
      if (spd > maxSpd) planeVel.multiplyScalar(maxSpd / spd);
    }

    // ── Jump ────────────────────────────────────────────────────────
    if (jumpPressed && this._grounded) {
      newNormalComp          += sprint ? JUMP_HEIGHT_SPRINT : JUMP_HEIGHT;
      this._jumpedWithSprint  = sprint;
      if (lx !== 0 || lz !== 0) planeVel.addScaledVector(inputDir, JUMP_FORWARD_BOOST);
      this._airMaxSpeed = planeVel.length();
    }

    // ── Recombine velocity ──────────────────────────────────────────
    this._vel.copy(planeVel).addScaledVector(worldUp, newNormalComp);

    // ── Collision : feet (ground support) ──────────────────────────
    // Expand detection margin by the downward velocity so fast falls
    // never skip over the collision zone (swept check along normal axis).
    const velDown    = Math.max(0, -this._vel.dot(worldUp));
    const feetMargin = CFG.camRadius + velDown;
    const feetPos    = _v2.copy(this.pos).addScaledVector(worldUp, -CAM_BASE_Y);
    const feetHits   = this._world.isCollidingWith(feetPos, this._vel, feetMargin);
    const groundHits        = feetHits.filter(s =>  s.normal.dot(worldUp) > 0.5);
    const lateralHitsAtFeet = feetHits.filter(s =>  s.normal.dot(worldUp) <= 0.5);
    for (const s of groundHits) s.alterVelocity(feetPos, this._vel, CFG.camRadius);
    // Lateral surfaces at feet: snap position only, no velocity change (avoids bounce)
    for (const s of lateralHitsAtFeet) {
      const sd = s.signedDist(feetPos);
      if (sd < CFG.camRadius) {
        const push = CFG.camRadius - sd;
        this.pos.addScaledVector(s.normal, push);
        feetPos.addScaledVector(s.normal, push);
      }
    }
    // Snap to exact standing height when grounded. The swept feetMargin can detect
    // the ground while the player is still above the correct standing height; without
    // this snap, _grounded turns false the very next frame (feetMargin shrinks back
    // to camRadius and sd_feet > camRadius → not approaching → can't jump).
    if (groundHits.length > 0) {
      const sdFeet = groundHits[0].signedDist(feetPos);
      this.pos.addScaledVector(groundHits[0].normal, CFG.camRadius - sdFeet);
    }

    // ── Collision : body (lateral obstacles) ───────────────────────
    for (const s of this._world.isCollidingWith(this.pos, this._vel, CFG.camRadius))
      s.alterVelocity(this.pos, this._vel, CFG.camRadius);

    // ── Move ────────────────────────────────────────────────────────
    const preMoveH = this.pos.dot(worldUp) - CAM_BASE_Y;
    this.pos.add(this._vel);

    // ── Update grounded state (used next frame for input control) ───
    const wasGrounded  = this._grounded;
    this._grounded     = groundHits.length > 0;

    if (wasGrounded && !this._grounded)
      this._launchFeetDotUp = preMoveH;

    // First frame of free-fall (walked off edge, no jump): apply minimum downward speed
    if (wasGrounded && !this._grounded && !jumpPressed) {
      const normalNow = this._vel.dot(worldUp);
      if (normalNow < 0 && normalNow > -MIN_FALL_SPEED)
        this._vel.addScaledVector(worldUp, -MIN_FALL_SPEED - normalNow);
    }
    // Sprint-jump landing flash
    if (!wasGrounded && this._grounded && this._jumpedWithSprint && this._indicator) {
      const wu = this.getWorldUp(_v3);
      _v2.copy(this.pos).addScaledVector(wu, -(CAM_BASE_Y + CFG.camRadius));
      this._indicator.triggerFlash(_v2, wu);
    }

    if (this._grounded) this._jumpedWithSprint = false;


    // ── Head bob ────────────────────────────────────────────────────
    const moving = lx !== 0 || lz !== 0;
    this._bobStrength = (moving && this._grounded)
      ? Math.min(1, this._bobStrength + 0.06)
      : Math.max(0, this._bobStrength - 0.04);
    if (this._bobStrength > 0 && this._grounded) this._bobPhase += BOB_SPEED * (sprint ? 2.5 : 1);
    this._bobOffset = Math.sin(this._bobPhase) * BOB_AMPLITUDE * this._bobStrength;

    // ── Indicator target ────────────────────────────────────────────
    if (this._indicator) {
      if (!this._grounded && this._jumpedWithSprint) {
        const landing = this.predictLanding();
        this._indicator.setTarget(
          landing ? landing.surfacePos : null,
          landing ? landing.normal     : null,
        );
      } else {
        this._indicator.setTarget(null, null);
      }
    }

    // ── E key: surface transition (+ indicator) ────────────────────
    this.getCameraQuaternion(_q2);
    const lookDir   = _v3.set(0, 0, -1).applyQuaternion(_q2);
    this.getWorldUp(_v1); // rafraîchit worldUp/_v1 écrasé par getCameraQuaternion
    const eHeld     = keyboard.has('KeyE');
    const eReleased = keyboard.wasJustReleased('KeyE');

    if (eHeld) {
      const transitionResult = this._world.findTransitionCandidate(
        this.pos, worldUp, lookDir, Infinity,
      );
      this._pendingTransition = transitionResult;
      if (this._eIndicator) {
        if (transitionResult) {
          this._eIndicator.setTarget(transitionResult.hitPoint, transitionResult.surface.normal);
        } else {
          this._eIndicator.setTarget(null, null);
        }
      }
    } else if (eReleased) {
      if (this._pendingTransition) {
        const { hitPoint } = this._pendingTransition;
        _v2.copy(hitPoint).sub(this.pos);
        if (_v2.lengthSq() > 0) _v2.normalize();
        this._vel.copy(_v2).multiplyScalar(PROJECTION_SPEED);
        this._projecting    = true;
        this._projectTarget = this._pendingTransition;
        this._pendingTransition = null;
      } else {
        if (this._eIndicator) this._eIndicator.setTarget(null, null);
      }
    } else {
      this._pendingTransition = null;
      if (this._eIndicator) this._eIndicator.setTarget(null, null);
    }
  }

  // ── Landing prediction ─────────────────────────────────────────────
  // Simulates ballistic trajectory (gravity only, no input) from current state.
  // The indicator always sits on the horizontal plane at the player's feet level
  // (feetDotUp in world space), EXCEPT when a lateral surface above that plane
  // intercepts the arc first.

  predictLanding() {
    if (this._grounded) return null;

    this.getWorldUp(_predUp);
    _predPos.copy(this.pos);
    _predVel.copy(this._vel);

    const feetDotUp = this._launchFeetDotUp;
    let wentAbove = false;

    for (let i = 0; i < 300; i++) {
      _predVel.addScaledVector(_predUp, -GRAVITY);
      _predFeet.copy(_predPos).addScaledVector(_predUp, -CAM_BASE_Y);
      const feetH = _predFeet.dot(_predUp);

      // Lateral surface above the feet plane → show on wall
      if (feetH > feetDotUp) {
        const bodyHits = this._world.isCollidingWith(_predPos, _predVel, CFG.camRadius)
          .filter(s => s.normal.dot(_predUp) <= 0.5);
        if (bodyHits.length > 0) {
          const sd = bodyHits[0].signedDist(_predPos);
          return {
            surfacePos: _predPos.clone().addScaledVector(bodyHits[0].normal, -sd),
            normal: bodyHits[0].normal.clone(),
          };
        }
      }

      // Arc returned to the feet plane after going above it
      if (wentAbove && feetH <= feetDotUp) {
        return {
          surfacePos: _predFeet.clone().addScaledVector(_predUp, feetDotUp - feetH),
          normal: _predUp.clone(),
        };
      }

      if (feetH > feetDotUp) wentAbove = true;
      _predPos.add(_predVel);
      if (i === 59) _predSnap.copy(_predPos);
    }

    // Fallback (e.g. falling off a ledge): step-60 projected to the feet plane
    return {
      surfacePos: _predSnap.clone().addScaledVector(_predUp, feetDotUp - _predSnap.dot(_predUp)),
      normal: _predUp.clone(),
    };
  }
}
