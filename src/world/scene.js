import * as THREE from 'three';

export function buildScene(material, buildingGeo, floorGeo, buildingsData) {
  const scene = new THREE.Scene();

  const floor = new THREE.Mesh(floorGeo, material);
  floor.frustumCulled = false;
  floor.renderOrder = -1;
  floor.onBeforeRender = () => {
    material.uniforms.uSeed.value = 0;
    material.uniforms.uModel.value.identity();
    material.uniformsNeedUpdate = true;
  };
  scene.add(floor);

  for (const bld of buildingsData) {
    const mesh = new THREE.Mesh(buildingGeo, material);
    mesh.frustumCulled = false;
    mesh.position.set(bld.x, 0, bld.z);
    mesh.onBeforeRender = () => {
      material.uniforms.uSeed.value = bld.seed;
      material.uniforms.uModel.value.copy(mesh.matrixWorld);
      material.uniformsNeedUpdate = true;
    };
    scene.add(mesh);
  }

  return scene;
}
