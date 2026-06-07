import * as THREE from 'three';
import { CFG, totalW, totalD } from '../config.js';

export function generateBuildings() {
  const buildings = [];
  for (let row = 0; row < CFG.gridRows; row++) {
    for (let col = 0; col < CFG.gridCols; col++) {
      buildings.push({
        x          : col * CFG.spacing - totalW / 2,
        z          : row * CFG.spacing - totalD / 2,
        seed       : (col * 1273 + row * 4937 + (col ^ row) * 131) % 9973,
        penetrable : false,
      });
    }
  }
  return buildings;
}

export function buildBuildingGeometry() {
  const { buildingW: w, buildingH: h } = CFG;
  const hw = w / 2, hd = w / 2;

  const corners = [
    [-hw, 0, -hd], [ hw, 0, -hd], [ hw, 0,  hd], [-hw, 0,  hd],
    [-hw, h, -hd], [ hw, h, -hd], [ hw, h,  hd], [-hw, h,  hd],
  ];
  const Q = [[0,0],[1,0],[1,1],[0,1]];
  const faces = [
    { quad:[0,1,5,4], n:[ 0, 0,-1] },
    { quad:[1,2,6,5], n:[ 1, 0, 0] },
    { quad:[2,3,7,6], n:[ 0, 0, 1] },
    { quad:[3,0,4,7], n:[-1, 0, 0] },
    { quad:[4,5,6,7], n:[ 0, 1, 0] },
  ];

  const positions = [], normals = [], uvs = [];
  for (const { quad: [a,b,c,d], n } of faces) {
    // CCW winding viewed from outside (reversed from inner order)
    for (const [vi, qi] of [[a,0],[c,2],[b,1],[a,0],[d,3],[c,2]]) {
      positions.push(...corners[vi]);
      normals.push(...n);
      uvs.push(...Q[qi]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(normals),   3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs),       2));
  return geo;
}
