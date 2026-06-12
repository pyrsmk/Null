import * as THREE from 'three';
import taaVertSrc from './shaders/taa.vert.glsl?raw';
import taaFragSrc from './shaders/taa.frag.glsl?raw';

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

function makeTAATarget(w, h) {
  // Half-float obligatoire : l'accumulation statique à blend faible (0.04)
  // se quantifie et stalle en 8 bits (banding, convergence figée).
  return new THREE.WebGLRenderTarget(w, h, {
    type:       THREE.HalfFloatType,
    format:     THREE.RGBAFormat,
    minFilter:  THREE.LinearFilter,
    magFilter:  THREE.LinearFilter,
    depthBuffer: false,
  });
}

function makeMSAATarget(w, h) {
  // MSAA target — Three.js gère le renderbuffer multisamplé + blit automatiquement.
  // La depthTexture est résolue elle aussi (blitFramebuffer DEPTH_BUFFER_BIT) :
  // c'est la source de la reprojection en translation.
  const depthTexture = new THREE.DepthTexture(w, h);
  depthTexture.type  = THREE.UnsignedIntType;
  return new THREE.WebGLRenderTarget(w, h, {
    samples:    4,
    type:       THREE.UnsignedByteType,
    format:     THREE.RGBAFormat,
    minFilter:  THREE.LinearFilter,
    magFilter:  THREE.LinearFilter,
    depthTexture,
  });
}

export class TAAPass {
  constructor(w, h) {
    this.msaaTarget = makeMSAATarget(w, h);

    this.ping = makeTAATarget(w, h);
    this.pong = makeTAATarget(w, h);
    this.current  = this.ping;
    this.history  = this.pong;
    this.histValid = false;
    this.frame    = 0;
    this.prevPos   = new THREE.Vector3();
    this.prevQuat  = new THREE.Quaternion();
    this._prevView = new THREE.Matrix4();
    this._reproj   = new THREE.Matrix4();

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
        uDepth:     { value: null },
        uReproject: { value: new THREE.Matrix4() },
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
    // Recréé plutôt que setSize : la depthTexture attachée ne suit pas
    // toujours le redimensionnement de la cible.
    this.msaaTarget.dispose();
    this.msaaTarget.depthTexture.dispose();
    this.msaaTarget = makeMSAATarget(w, h);
    this.ping.setSize(w, h);
    this.pong.setSize(w, h);
    this.histValid = false;
  }

  // Jitter toujours actif : à l'arrêt, l'accumulation (blend 0.04, sans clamp)
  // converge vers un supersample 32× — c'est l'anti-moiré statique.
  computeJitter(w, h) {
    this.frame++;
    const fi = this.frame % 32;
    return {
      jx: (halton(fi, 2) - 0.5) * 2.0 / w,
      jy: (halton(fi, 3) - 0.5) * 2.0 / h,
    };
  }

  render(renderer, mainScene, camera, glitch = 0) {
    const w = this.msaaTarget.width, h = this.msaaTarget.height;

    // Mouvement mesuré sur la caméra réelle (couvre head bob + transitions).
    const velT   = camera.position.distanceTo(this.prevPos);
    const velR   = camera.quaternion.angleTo(this.prevQuat);
    const motion = velT + velR * 30;
    const moving = motion > 0.002;

    // Rotation et translation sont toutes deux reprojetées → l'historique
    // reste géométriquement valide en mouvement. Le blend ne monte qu'avec
    // la vitesse de translation, pour limiter le flou de resampling et les
    // désocclusions (que le clamp de voisinage contient).
    // Marche ≈ 2.5 u/frame → 0.15 ; sprint ≈ 7.6 → 0.25 ; chute → cap 0.30.
    const blend = moving ? Math.min(0.30, 0.10 + velT * 0.02) : 0.04;

    // Reprojection complète : M = P · V_prev · M_curr · P⁻¹ envoie le NDC
    // courant (xy + depth) sur le NDC de la frame précédente. Les transforms
    // projectifs composent sans w-divide intermédiaire.
    this._reproj.copy(camera.projectionMatrix)
      .multiply(this._prevView)
      .multiply(camera.matrixWorld)
      .multiply(camera.projectionMatrixInverse);

    this.prevPos.copy(camera.position);
    this.prevQuat.copy(camera.quaternion);
    this._prevView.copy(camera.matrixWorldInverse);

    // Pass 1 : scène → MSAA target
    renderer.setRenderTarget(this.msaaTarget);
    renderer.render(mainScene, camera);

    // Pass 2 : TAA resolve → current
    const u = this._mat.uniforms;
    u.uCurrent.value   = this.msaaTarget.texture;
    u.uHistory.value   = this.history.texture;
    u.uDepth.value     = this.msaaTarget.depthTexture;
    u.uReproject.value.copy(this._reproj);
    u.uTexelSize.value.set(1 / w, 1 / h);
    u.uBlend.value     = blend;
    u.uHistValid.value = this.histValid ? 1.0 : 0.0;
    u.uVelocity.value  = motion;
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
