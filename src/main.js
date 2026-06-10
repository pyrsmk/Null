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
import { Keyboard } from './input/keyboard.js';
import { Mouse } from './input/mouse.js';
import { Gamepad } from './input/gamepad.js';

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

// ── Player ──────────────────────────────────────────────────────
const player = new Player(buildingsData);

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

  camera.position.copy(player.pos);
  player.getCameraQuaternion(camera.quaternion);
  camera.updateMatrixWorld();

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
