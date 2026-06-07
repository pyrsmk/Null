const MOUSE_SENS = 0.003;

export class Mouse {
  constructor(canvas, cam) {
    this._cam    = cam;
    this._locked = false;

    canvas.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', e => {
      if (!this._locked) return;
      this._cam.yaw  += e.movementX * MOUSE_SENS;
      this._cam.pitch = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, this._cam.pitch + e.movementY * MOUSE_SENS)
      );
    });
  }
}
