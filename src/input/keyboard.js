export class Keyboard {
  constructor() {
    this._keys         = new Set();
    this._justPressed  = new Set();
    this._justReleased = new Set();
    window.addEventListener('keydown', e => {
      if (!this._keys.has(e.code)) this._justPressed.add(e.code);
      this._keys.add(e.code);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))
        e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this._justReleased.add(e.code);
      this._keys.delete(e.code);
      this._justPressed.delete(e.code);
    });
  }

  has(code)              { return this._keys.has(code); }
  wasJustPressed(code)   { return this._justPressed.has(code); }
  wasJustReleased(code)  { return this._justReleased.has(code); }
  clearJustPressed()     { this._justPressed.clear(); this._justReleased.clear(); }
}
