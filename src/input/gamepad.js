const DEAD_ZONE = 0.15;

export class Gamepad {
  constructor() {
    this._prevButtons = [];
  }

  read() {
    const gp = navigator.getGamepads()[0];
    if (!gp) return null;

    const dead    = v => Math.abs(v) > DEAD_ZONE ? v : 0;
    const justBtn = i => gp.buttons[i].pressed && !this._prevButtons[i];

    const result = {
      ax:     dead(gp.axes[0]),
      az:     dead(gp.axes[1]),
      rx:     dead(gp.axes[2]),
      ry:     dead(gp.axes[3]),
      jump:   justBtn(0),
      sprint: gp.buttons[4].pressed,
    };

    this._prevButtons = Array.from(gp.buttons, b => b.pressed);
    return result;
  }
}
