import { CFG, totalW, totalD } from '../config.js';

const JUMP_STRENGTH   = 3.1;
const GRAVITY         = 0.08;
const WALL_JUMP_H     = 11.25;
const WALL_JUMP_DECAY = 0.97;
const CAM_BASE_Y      = 75;
const BOB_AMPLITUDE   = 0.75;
const BOB_SPEED       = 0.10;

export class Character {
  constructor(buildings) {
    this._buildings = buildings;

    this.x     = 0;
    this.y     = CAM_BASE_Y;
    this.z     = (CFG.gridRows - 1) * CFG.spacing / 2 + CFG.buildingW / 2 + 1800;
    this.yaw   = 0;
    this.pitch = 0;

    this._jumpVelocity     = 0;
    this._jumpOffset       = 0;
    this._wjVX             = 0;
    this._wjVZ             = 0;
    this._wasAboveRoof     = false;
    this._jumpedWithSprint = false;
    this._bobPhase         = 0;
    this._bobStrength      = 0;
  }

  _checkCollision(x, z) {
    if (this._jumpOffset >= CFG.buildingH) return false;
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

  _getPlatformHeight(x, z) {
    let height = 0;
    const hw  = CFG.buildingW / 2;
    const col = Math.round((x + totalW / 2) / CFG.spacing);
    const row = Math.round((z + totalD / 2) / CFG.spacing);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = col + dc, r = row + dr;
        if (c < 0 || c >= CFG.gridCols || r < 0 || r >= CFG.gridRows) continue;
        const bx = c * CFG.spacing - totalW / 2;
        const bz = r * CFG.spacing - totalD / 2;
        if (Math.abs(x - bx) <= hw && Math.abs(z - bz) <= hw)
          height = Math.max(height, CFG.buildingH);
      }
    }
    return height;
  }

  _getWallNormal() {
    const d = CFG.camRadius / 2;
    let nx = 0, nz = 0;
    if (this._checkCollision(this.x + d, this.z)) nx -= 1;
    if (this._checkCollision(this.x - d, this.z)) nx += 1;
    if (this._checkCollision(this.x, this.z + d)) nz -= 1;
    if (this._checkCollision(this.x, this.z - d)) nz += 1;
    const len = Math.sqrt(nx * nx + nz * nz);
    return len > 0 ? [nx / len, nz / len] : null;
  }

  update(keyboard, gp) {
    const sprint = keyboard.has('ShiftLeft') || keyboard.has('ShiftRight')
                || (gp?.sprint ?? false);
    const jumpPressed = keyboard.wasJustPressed('Space') || (gp?.jump ?? false);
    const airSprintBoost = this._jumpedWithSprint ? 1.5 : 1.0;
    const s  = CFG.camSpeed * (sprint ? 4 : 1) * airSprintBoost;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);

    // Axes manette (strafe/avance) fusionnés avec clavier
    const gpAx = gp ? gp.ax : 0, gpAz = gp ? gp.az : 0;

    let dx = gpAx * cy * s + gpAz * sy * s;
    let dz = gpAx * sy * s - gpAz * cy * s;
    if (keyboard.has('ArrowUp')    || keyboard.has('KeyW')) { dx += sy * s; dz -= cy * s; }
    if (keyboard.has('ArrowDown')  || keyboard.has('KeyS')) { dx -= sy * s; dz += cy * s; }
    if (keyboard.has('ArrowLeft')  || keyboard.has('KeyA')) { dx -= cy * s; dz -= sy * s; }
    if (keyboard.has('ArrowRight') || keyboard.has('KeyD')) { dx += cy * s; dz += sy * s; }

    const platformH = this._getPlatformHeight(this.x, this.z);
    const grounded  = this._jumpOffset <= platformH && this._jumpVelocity <= 0;

    if (jumpPressed) {
      if (grounded) {
        this._jumpVelocity     = JUMP_STRENGTH;
        this._jumpedWithSprint = sprint;
      } else {
        const normal = this._getWallNormal();
        if (normal) {
          this._jumpVelocity = JUMP_STRENGTH;
          this._jumpOffset   = Math.max(this._jumpOffset, platformH + 0.1);
          this._wjVX = normal[0] * WALL_JUMP_H;
          this._wjVZ = normal[1] * WALL_JUMP_H;
        }
      }
    }

    if (!grounded) {
      this._jumpVelocity -= GRAVITY;
      this._jumpOffset   += this._jumpVelocity;
      if (this._jumpOffset <= platformH) {
        this._jumpOffset = platformH; this._jumpVelocity = 0;
        this._wjVX = 0; this._wjVZ = 0;
        this._jumpedWithSprint = false;
      }
    }

    if (this._wjVX !== 0 || this._wjVZ !== 0) {
      if (!this._checkCollision(this.x + this._wjVX, this.z)) this.x += this._wjVX;
      else this._wjVX = 0;
      if (!this._checkCollision(this.x, this.z + this._wjVZ)) this.z += this._wjVZ;
      else this._wjVZ = 0;
      this._wjVX *= WALL_JUMP_DECAY;
      this._wjVZ *= WALL_JUMP_DECAY;
      if (Math.abs(this._wjVX) < 0.001) this._wjVX = 0;
      if (Math.abs(this._wjVZ) < 0.001) this._wjVZ = 0;
    }

    const moving = dx !== 0 || dz !== 0;
    const airborne = !grounded;
    this._bobStrength = (moving && !airborne)
      ? Math.min(1, this._bobStrength + 0.06)
      : Math.max(0, this._bobStrength - 0.04);
    if (this._bobStrength > 0) this._bobPhase += BOB_SPEED * (sprint ? 2.5 : 1);

    this.y = CAM_BASE_Y + this._jumpOffset + Math.sin(this._bobPhase) * BOB_AMPLITUDE * this._bobStrength;

    // Éjection toit → chute
    const aboveRoof = this._jumpOffset >= CFG.buildingH;
    if (this._wasAboveRoof && !aboveRoof) {
      for (let i = 0; i < 10; i++) {
        if (!this._checkCollision(this.x, this.z)) break;
        const n = this._getWallNormal();
        if (!n) break;
        this.x += n[0] * 4;
        this.z += n[1] * 4;
      }
    }
    this._wasAboveRoof = aboveRoof;

    // Déplacement + collision
    if (!this._checkCollision(this.x + dx, this.z)) this.x += dx;
    if (!this._checkCollision(this.x, this.z + dz)) this.z += dz;

    const worldBound = CFG.far;
    this.x = Math.max(-worldBound, Math.min(worldBound, this.x));
    this.z = Math.max(-worldBound, Math.min(worldBound, this.z));

    // Dépénétration AABB
    if (this._jumpOffset < CFG.buildingH) {
      const hw  = CFG.buildingW / 2 + CFG.camRadius;
      const col = Math.round((this.x + totalW / 2) / CFG.spacing);
      const row = Math.round((this.z + totalD / 2) / CFG.spacing);
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const c = col + dc, r = row + dr;
          if (c < 0 || c >= CFG.gridCols || r < 0 || r >= CFG.gridRows) continue;
          const bld = this._buildings[r * CFG.gridCols + c];
          const bx  = bld.x, bz = bld.z;
          const ddx = this.x - bx, ddz = this.z - bz;
          const ox  = hw - Math.abs(ddx), oz = hw - Math.abs(ddz);
          if (ox <= 0 || oz <= 0) continue;
          if (bld.penetrable) {
            if (Math.abs(ddx) >= Math.abs(ddz)) this.x += Math.sign(ddx) * (ox + 0.5);
            else                                 this.z += Math.sign(ddz) * (oz + 0.5);
          } else {
            if (ox < oz) this.x += Math.sign(ddx) * (ox + 0.5);
            else         this.z += Math.sign(ddz) * (oz + 0.5);
          }
        }
      }
    }
  }
}
