import * as THREE from 'three';
import { hexToRGB } from '../helpers.js';

const IND_BASE             = 16;
const IND_RING_RADIUS      = 40;
const FLASH_DUR            = 0.5;  // seconds
const IND_FADEIN_DUR       = 0.25; // seconds — fade-in duration when indicator first appears
const IND_ALPHA_RING       = 0.20; // base alpha of the ring cubes
const IND_ALPHA_RING_PULSE = 0.20; // pulse amplitude

// Reusable temporaries
const _tmp   = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd   = new THREE.Vector3();
const _pos   = new THREE.Vector3();
const _s     = new THREE.Vector3();
const _m     = new THREE.Matrix4();
const _q     = new THREE.Quaternion();
const _color = new THREE.Color();

export class LandingIndicator {
  constructor(color = '#FF3F7F') {
    this._colorRGB = hexToRGB(color);
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `
precision highp float;
uniform mat4 uProjection;
uniform mat4 uView;
in vec3 position;
in mat4 instanceMatrix;
in vec3 instanceColor;
out vec3 vColor;
void main() {
  vColor = instanceColor;
  gl_Position = uProjection * uView * instanceMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}`,
      uniforms: {
        uProjection: { value: new THREE.Matrix4() },
        uView:       { value: new THREE.Matrix4() },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
    });

    this._mat  = mat;
    this._mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, IND_BASE);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;

    this._target      = null; // { surfacePos, normal } — set each frame during sprint-jump
    this._flashEnd    = -1;   // performance.now() timestamp when flash expires
    this._fadeInStart = -1;   // performance.now() timestamp when indicator first appeared
    this._flashPos = new THREE.Vector3();
    this._flashN   = new THREE.Vector3();
  }

  get mesh() { return this._mesh; }

  // Called by Player each frame while sprint-jumping airborne. Pass null to clear.
  setTarget(surfacePos, normal) {
    if (surfacePos === null) {
      this._target      = null;
      this._fadeInStart = -1;
    } else {
      if (!this._target) {
        this._target      = { surfacePos: new THREE.Vector3(), normal: new THREE.Vector3() };
        this._fadeInStart = performance.now();
      }
      this._target.surfacePos.copy(surfacePos);
      this._target.normal.copy(normal);
    }
  }

  // Called by Player once on landing from a sprint jump.
  triggerFlash(surfacePos, normal) {
    this._flashPos.copy(surfacePos);
    this._flashN.copy(normal);
    this._flashEnd = performance.now() + FLASH_DUR * 1000;
  }

  // Called from main.js each frame after camera.updateMatrixWorld().
  update(camera, now) {
    const flashFade  = Math.max(0, (this._flashEnd - now) / (FLASH_DUR * 1000));
    const flashActive = flashFade > 0;

    if (!this._target && !flashActive) {
      this._mesh.visible = false;
      return;
    }

    this._mesh.visible = true;
    const t       = now / 1000;
    const surfPos = this._target ? this._target.surfacePos : this._flashPos;
    const N       = this._target ? this._target.normal     : this._flashN;
    const fadeIn  = this._target
      ? Math.min(1, (now - this._fadeInStart) / (IND_FADEIN_DUR * 1000))
      : 1.0;
    const alpha   = this._target ? fadeIn : flashFade;

    // Tangent frame around surface normal
    _tmp.set(Math.abs(N.y) < 0.9 ? 0 : 1, Math.abs(N.y) < 0.9 ? 1 : 0, 0);
    _right.crossVectors(_tmp, N).normalize();
    _fwd.crossVectors(N, _right);

    // Base ring — 10 cubes slowly rotating, pulsing
    for (let i = 0; i < IND_BASE; i++) {
      const angle = (i / IND_BASE) * Math.PI * 2;
      const r = IND_RING_RADIUS, ca = Math.cos(angle), sa = Math.sin(angle);
      _pos.set(
        surfPos.x + (_right.x * ca + _fwd.x * sa) * r + N.x * 2.5,
        surfPos.y + (_right.y * ca + _fwd.y * sa) * r + N.y * 2.5,
        surfPos.z + (_right.z * ca + _fwd.z * sa) * r + N.z * 2.5,
      );
      _q.setFromAxisAngle(N, t * 0.4 + i * 0.628);
      _s.setScalar(6.5 + 1.5 * Math.sin(t * 2.5 + i * 0.7));
      _m.compose(_pos, _q, _s);
      this._mesh.setMatrixAt(i, _m);
      const b = (IND_ALPHA_RING + IND_ALPHA_RING_PULSE * Math.sin(t * 3.0 + i * 0.5)) * alpha;
      this._mesh.setColorAt(i, _color.setRGB(this._colorRGB.r * b, this._colorRGB.g * b, this._colorRGB.b * b));
    }

    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.instanceColor.needsUpdate  = true;

    this._mat.uniforms.uView.value.copy(camera.matrixWorldInverse);
    this._mat.uniforms.uProjection.value.copy(camera.projectionMatrix);
  }
}
