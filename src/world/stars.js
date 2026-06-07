import * as THREE from 'three';
import starVertSrc from '../renderer/shaders/star.vert.glsl?raw';
import starFragSrc from '../renderer/shaders/star.frag.glsl?raw';

const STAR_COUNT  = 3000;
const STAR_RADIUS = 20000;

export class StarSystem {
  constructor() {
    const positions    = new Float32Array(STAR_COUNT * 3);
    const brightnesses = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform distribution on full sphere (Archimedes' hat-box theorem)
      const cosTheta = 2.0 * Math.random() - 1.0;
      const sinTheta = Math.sqrt(1.0 - cosTheta * cosTheta);
      const phi      = Math.random() * Math.PI * 2.0;
      positions[i * 3]     = STAR_RADIUS * sinTheta * Math.cos(phi);
      positions[i * 3 + 1] = STAR_RADIUS * cosTheta;
      positions[i * 3 + 2] = STAR_RADIUS * sinTheta * Math.sin(phi);
      brightnesses[i] = 0.3 + Math.random() * 0.7;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',    new THREE.BufferAttribute(positions,    3));
    geo.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));

    this.material = new THREE.RawShaderMaterial({
      vertexShader:   starVertSrc,
      fragmentShader: starFragSrc,
      uniforms: {
        uView:       { value: new THREE.Matrix4() },
        uProjection: { value: new THREE.Matrix4() },
        uJitter:     { value: new THREE.Vector2() },
        uTime:       { value: 0.0 },
      },
      glslVersion:  THREE.GLSL3,
      transparent:  true,
      blending:     THREE.AdditiveBlending,
      depthTest:    true,
      depthWrite:   false,
    });

    this.mesh = new THREE.Points(geo, this.material);
    this.mesh.frustumCulled = false;
  }
}
