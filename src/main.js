import * as THREE from 'three';
import { CFG } from './config.js';
import { createFontTexture } from './renderer/fontTexture.js';
import { createSceneMaterial } from './renderer/materials.js';
import { TAAPass } from './renderer/taaPass.js';
import { generateBuildings, buildBuildingGeometry } from './world/buildings.js';
import { buildFloorGeometry } from './world/floor.js';
import { buildScene } from './world/scene.js';
import { StarSystem } from './world/stars.js';
import { Player } from './physics/player.js';
import { World, WallFace } from './physics/world.js';
import { totalW, totalD } from './config.js';
import { Keyboard } from './input/keyboard.js';
import { Mouse } from './input/mouse.js';
import { Gamepad } from './input/gamepad.js';
import { LandingIndicator } from './renderer/landingIndicator.js';

// ── Three.js renderer ──────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

// ── Assets & scène ────────────────────────────────────────────────
const buildingsData  = generateBuildings();
const buildingGeo    = buildBuildingGeometry();
const floorGeo       = buildFloorGeometry();
const fontTexture    = createFontTexture();
const sceneMaterial  = createSceneMaterial(fontTexture);
const scene          = buildScene(sceneMaterial, buildingGeo, floorGeo, buildingsData);
const starSystem = new StarSystem();
scene.add(starSystem.mesh);

// ── Caméra Three.js ───────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  CFG.fov, window.innerWidth / window.innerHeight, CFG.near, CFG.far
);

// ── TAA ───────────────────────────────────────────────────────────
const taa = new TAAPass(window.innerWidth, window.innerHeight);

// ── World ────────────────────────────────────────────────────────
const world = new World();
const hw = CFG.buildingW / 2, bh = CFG.buildingH;

for (const bld of buildingsData) {
  const { x: bx, z: bz } = bld;
  const col = Math.round((bx + totalW / 2) / CFG.spacing);
  const row = Math.round((bz + totalD / 2) / CFG.spacing);
  // 4 lateral faces
  world.add(new WallFace( 1,0,0,  bx+hw,  bz-hw, bz+hw,  0, bh), col, row);
  world.add(new WallFace(-1,0,0,-(bx-hw), bz-hw, bz+hw,  0, bh), col, row);
  world.add(new WallFace( 0,0, 1,  bz+hw,  bx-hw, bx+hw, 0, bh), col, row);
  world.add(new WallFace( 0,0,-1,-(bz-hw), bx-hw, bx+hw, 0, bh), col, row);
  // Roof
  world.add(new WallFace(0,1,0, bh, bx-hw, bx+hw, bz-hw, bz+hw), col, row);
}
// Finite floor surface matching the floor quad extent
world.addGlobal(new WallFace(0,1,0, 0, -CFG.far, CFG.far, -CFG.far, CFG.far));

// ── Landing indicator ────────────────────────────────────────────
const indicator = new LandingIndicator();
scene.add(indicator.mesh);

// ── Player ──────────────────────────────────────────────────────
const player = new Player(world, indicator);

// ── Input ────────────────────────────────────────────────────────
const keyboard = new Keyboard();
const mouse    = new Mouse(renderer.domElement, player);
const gamepad  = new Gamepad();

// ── Resize ────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  taa.setSize(w, h);
});

// ── Reusable temps for game loop ──────────────────────────────────
const _loopWU = new THREE.Vector3();

// ── FPS counter ───────────────────────────────────────────────────
const fpsEl    = document.getElementById('fps');
let fpsSamples = 0, fpsAccum = 0, fpsLast = performance.now();

// ── Game loop ─────────────────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);

  const gp = gamepad.read();

  if (gp) {
    player.yaw   += gp.rx * 0.03;
    player.pitch  = Math.max(
      -Math.PI / 2, Math.min(Math.PI / 2, player.pitch + gp.ry * 0.025)
    );
  }

  player.update(keyboard, gp);
  keyboard.clearJustPressed();

  camera.position.copy(player.pos).addScaledVector(player.getWorldUp(_loopWU), player._bobOffset);
  player.getCameraQuaternion(camera.quaternion);
  camera.updateMatrixWorld();

  indicator.update(camera, now);

  sceneMaterial.uniforms.uView.value.copy(camera.matrixWorldInverse);
  sceneMaterial.uniforms.uProjection.value.copy(camera.projectionMatrix);
  sceneMaterial.uniforms.uTime.value = now / 1000;

  const vel = Math.abs(player.x   - taa.prevX)
            + Math.abs(player.y   - taa.prevY)
            + Math.abs(player.z   - taa.prevZ)
            + Math.abs(player.yaw   - taa.prevYaw)   * 30
            + Math.abs(player.pitch - taa.prevPitch) * 30;
  taa.prevX     = player.x;
  taa.prevY     = player.y;
  taa.prevZ     = player.z;
  taa.prevYaw   = player.yaw;
  taa.prevPitch = player.pitch;

  const { jx, jy } = taa.computeJitter(vel, renderer.domElement.width, renderer.domElement.height);
  sceneMaterial.uniforms.uJitter.value.set(jx, jy);

  const su = starSystem.material.uniforms;
  su.uView.value.copy(camera.matrixWorldInverse);
  su.uProjection.value.copy(camera.projectionMatrix);
  su.uJitter.value.set(jx, jy);
  su.uTime.value = now / 1000;

  renderer.autoClear = true;
  taa.render(renderer, scene, camera, vel, player.glitchStrength);

  fpsAccum += now - fpsLast;
  fpsLast   = now;
  if (++fpsSamples === 30) {
    fpsEl.textContent = Math.round(30000 / fpsAccum) + ' FPS';
    fpsSamples = 0; fpsAccum = 0;
  }
}

requestAnimationFrame(loop);
