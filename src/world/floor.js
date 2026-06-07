import * as THREE from 'three';
import { CFG } from '../config.js';

export function buildFloorGeometry() {
  const size = CFG.far * 2, hs = size / 2, y = -0.05;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -hs,y,-hs,  hs,y,-hs,  hs,y, hs,
    -hs,y,-hs,  hs,y, hs, -hs,y, hs,
  ]), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
    0,1,0, 0,1,0, 0,1,0,
    0,1,0, 0,1,0, 0,1,0,
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0,0, 1,0, 1,1, 0,0, 1,1, 0,1,
  ]), 2));
  return geo;
}
