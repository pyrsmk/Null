import * as THREE from 'three';
import vertSrc from './shaders/scene.vert.glsl?raw';
import fragSrc from './shaders/scene.frag.glsl?raw';
import { CFG, totalW, totalD } from '../config.js';

export function createSceneMaterial(fontTexture) {
  return new THREE.RawShaderMaterial({
    vertexShader:   vertSrc,
    fragmentShader: fragSrc,
    uniforms: {
      uModel:        { value: new THREE.Matrix4() },
      uView:         { value: new THREE.Matrix4() },
      uProjection:   { value: new THREE.Matrix4() },
      uJitter:       { value: new THREE.Vector2() },
      uFont:         { value: fontTexture },
      uCharCols:     { value: CFG.charCols },
      uCharRows:     { value: CFG.charRows },
      uSeed:         { value: 0.0 },
      uFloorCharW:   { value: CFG.buildingW / CFG.charCols },
      uTime:         { value: 0.0 },
      uBldSpacing:   { value: CFG.spacing },
      uGridHalfSize: { value: new THREE.Vector2(totalW / 2, totalD / 2) },
    },
    glslVersion: THREE.GLSL3,
    depthTest:   true,
    depthWrite:  true,
    side:        THREE.DoubleSide,
  });
}
