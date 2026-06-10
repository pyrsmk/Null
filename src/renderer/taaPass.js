import * as THREE from 'three';
import taaVertSrc from './shaders/taa.vert.glsl?raw';
import taaFragSrc from './shaders/taa.frag.glsl?raw';

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

function makeTAATarget(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type:       THREE.UnsignedByteType,
    format:     THREE.RGBAFormat,
    minFilter:  THREE.LinearFilter,
    magFilter:  THREE.LinearFilter,
    depthBuffer: false,
  });
}

export class TAAPass {
  constructor(w, h) {
    // MSAA target — Three.js gère le renderbuffer multisamplé + blit automatiquement
    this.msaaTarget = new THREE.WebGLRenderTarget(w, h, {
      samples:    4,
      type:       THREE.UnsignedByteType,
      format:     THREE.RGBAFormat,
      minFilter:  THREE.LinearFilter,
      magFilter:  THREE.LinearFilter,
    });

    this.ping = makeTAATarget(w, h);
    this.pong = makeTAATarget(w, h);
    this.current  = this.ping;
    this.history  = this.pong;
    this.histValid = false;
    this.frame    = 0;
    this.prevX = 0; this.prevY = 0; this.prevZ = 0; this.prevYaw = 0; this.prevPitch = 0;

    // Quad plein-écran (6 vertices, deux triangles couvrant le NDC)
    // setDrawRange requis : sans attribut 'position', Three.js ne peut pas
    // déterminer le count automatiquement → 0 draw calls sans ça.
    const quadGeo = new THREE.BufferGeometry();
    quadGeo.setAttribute('aPos', new THREE.BufferAttribute(
      new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), 2
    ));
    quadGeo.setDrawRange(0, 6);

    this._mat = new THREE.RawShaderMaterial({
      vertexShader:   taaVertSrc,
      fragmentShader: taaFragSrc,
      uniforms: {
        uCurrent:   { value: null },
        uHistory:   { value: null },
        uTexelSize: { value: new THREE.Vector2() },
        uBlend:     { value: 0.04 },
        uHistValid: { value: 0.0 },
        uVelocity:  { value: 0.0 },
        uGlitch:    { value: 0.0 },
      },
      glslVersion: THREE.GLSL3,
      depthTest:   false,
      depthWrite:  false,
    });

    this._quad = new THREE.Mesh(quadGeo, this._mat);
    this._quad.frustumCulled = false;
    this._scene  = new THREE.Scene();
    this._scene.add(this._quad);
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    this.msaaTarget.setSize(w, h);
    this.ping.setSize(w, h);
    this.pong.setSize(w, h);
    this.histValid = false;
  }

  computeJitter(vel, w, h) {
    const moving = vel > 0.002;
    this.frame++;
    const fi = moving ? (this.frame % 32) : 0;
    return {
      jx: moving ? (halton(fi, 2) - 0.5) * 2.0 / w : 0.0,
      jy: moving ? (halton(fi, 3) - 0.5) * 2.0 / h : 0.0,
    };
  }

  render(renderer, mainScene, camera, vel, glitch = 0) {
    const w = this.msaaTarget.width, h = this.msaaTarget.height;
    const moving = vel > 0.002;
    const blend  = moving ? Math.min(0.95, 0.08 + vel * 4.0) : 0.15;

    // Pass 1 : scène → MSAA target
    renderer.setRenderTarget(this.msaaTarget);
    renderer.render(mainScene, camera);

    // Pass 2 : TAA resolve → current
    const u = this._mat.uniforms;
    u.uCurrent.value   = this.msaaTarget.texture;
    u.uHistory.value   = this.history.texture;
    u.uTexelSize.value.set(1 / w, 1 / h);
    u.uBlend.value     = blend;
    u.uHistValid.value = this.histValid ? 1.0 : 0.0;
    u.uVelocity.value  = vel;
    u.uGlitch.value    = glitch;

    renderer.setRenderTarget(this.current);
    renderer.render(this._scene, this._camera);

    // Pass 3 : blit current → écran
    u.uCurrent.value   = this.current.texture;
    u.uHistory.value   = this.current.texture;
    u.uHistValid.value = 0.0;
    renderer.setRenderTarget(null);
    renderer.render(this._scene, this._camera);

    // Swap ping-pong
    [this.current, this.history] = [this.history, this.current];
    this.histValid = true;
  }
}
