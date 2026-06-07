import * as THREE from 'three';

export function createFontTexture() {
  const CW = 128, CH = 200;
  const cvs = document.createElement('canvas');
  cvs.width = CW * 2; cvs.height = CH;
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW * 2, CH);

  const GLYPHS = {
    '0': [1, 1, 1, 0, 1, 1, 1],
    '1': [0, 0, 1, 0, 0, 1, 0],
  };

  function drawGlyph(ch, offX) {
    const s  = GLYPHS[ch];
    const m  = 14;
    const sw = 14;
    const x0 = offX + m + sw / 2;
    const x1 = offX + CW - m - sw / 2;
    const y0 = m + sw / 2;
    const ym = CH / 2;
    const y1 = CH - m - sw / 2;

    const hbar = y           => { ctx.beginPath(); ctx.moveTo(x0, y);  ctx.lineTo(x1, y);  ctx.stroke(); };
    const vbar = (x, ya, yb) => { ctx.beginPath(); ctx.moveTo(x, ya); ctx.lineTo(x, yb); ctx.stroke(); };

    function drawSegments() {
      if (s[0]) hbar(y0);
      if (s[1]) vbar(x0, y0 + sw,       ym - sw * 0.6);
      if (s[2]) vbar(x1, y0 + sw,       ym - sw * 0.6);
      if (s[3]) hbar(ym);
      if (s[4]) vbar(x0, ym + sw * 0.6, y1 - sw);
      if (s[5]) vbar(x1, ym + sw * 0.6, y1 - sw);
      if (s[6]) hbar(y1);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(offX, 0, CW, CH);
    ctx.clip();

    ctx.lineCap = 'round';

    ctx.strokeStyle  = '#fff';
    ctx.lineWidth    = sw * 0.5;
    ctx.shadowColor  = '#fff';
    ctx.shadowBlur   = 28;
    drawSegments();

    ctx.lineWidth  = sw * 0.8;
    ctx.shadowBlur = 12;
    drawSegments();

    ctx.lineWidth  = sw;
    ctx.shadowBlur = 0;
    drawSegments();

    ctx.restore();
  }

  drawGlyph('0', 0);
  drawGlyph('1', CW);

  const texture = new THREE.CanvasTexture(cvs);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
