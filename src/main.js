import * as THREE from 'three';
import { CFG } from './config.js';
import { createFontTexture } from './renderer/fontTexture.js';
import { createSceneMaterial } from './renderer/materials.js';
import { TAAPass } from './renderer/taaPass.js';
import { generateBuildings, buildBuildingGeometry } from './world/buildings.js';
import { buildFloorGeometry } from './world/floor.js';
import { buildScene } from './world/scene.js';
import { StarSystem } from './world/stars.js';
import { Character } from './physics/character.js';
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
// YXZ : yaw d'abord (monde Y), puis pitch (local X) → vue FPS correcte
camera.rotation.order = 'YXZ';

// ── TAA ───────────────────────────────────────────────────────────
const taa = new TAAPass(window.innerWidth, window.innerHeight);

// ── Physique / personnage ─────────────────────────────────────────
const character = new Character(buildingsData);

// ── Input ────────────────────────────────────────────────────────
const keyboard = new Keyboard();
const mouse    = new Mouse(renderer.domElement, character);
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
    character.yaw   += gp.rx * 0.03;
    character.pitch  = Math.max(
      -Math.PI / 2, Math.min(Math.PI / 2, character.pitch + gp.ry * 0.025)
    );
  }

  character.update(keyboard, gp);
  keyboard.clearJustPressed();

  camera.position.set(character.x, character.y, character.z);
  camera.rotation.y = -character.yaw;
  camera.rotation.x = -character.pitch;
  camera.updateMatrixWorld();

  sceneMaterial.uniforms.uView.value.copy(camera.matrixWorldInverse);
  sceneMaterial.uniforms.uProjection.value.copy(camera.projectionMatrix);
  sceneMaterial.uniforms.uTime.value = now / 1000;

  const vel = Math.abs(character.x   - taa.prevX)
            + Math.abs(character.y   - taa.prevY)
            + Math.abs(character.z   - taa.prevZ)
            + Math.abs(character.yaw   - taa.prevYaw)   * 30
            + Math.abs(character.pitch - taa.prevPitch) * 30;
  taa.prevX     = character.x;
  taa.prevY     = character.y;
  taa.prevZ     = character.z;
  taa.prevYaw   = character.yaw;
  taa.prevPitch = character.pitch;

  const { jx, jy } = taa.computeJitter(vel, renderer.domElement.width, renderer.domElement.height);
  sceneMaterial.uniforms.uJitter.value.set(jx, jy);

  const su = starSystem.material.uniforms;
  su.uView.value.copy(camera.matrixWorldInverse);
  su.uProjection.value.copy(camera.projectionMatrix);
  su.uJitter.value.set(jx, jy);
  su.uTime.value = now / 1000;

  renderer.autoClear = true;
  taa.render(renderer, scene, camera, vel);

  fpsAccum += now - fpsLast;
  fpsLast   = now;
  if (++fpsSamples === 30) {
    fpsEl.textContent = Math.round(30000 / fpsAccum) + ' FPS';
    fpsSamples = 0; fpsAccum = 0;
  }
}

requestAnimationFrame(loop);
