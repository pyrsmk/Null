# CLAUDE.md

> **Mandatory rule:** Update this file on every code change — new files, deletions, renames,
> changed constants in `config.js`, new uniforms, new dependencies, or architectural changes.
> CLAUDE.md is a live document, not a snapshot.

## Project

Núll is a first-person 3D browser parkour game rendered in WebGL. Players navigate a procedural
city of glowing binary-digit towers using keyboard, mouse, or gamepad.

## Stack & Versions

| Tool | Version |
|------|---------|
| Three.js | 0.184.0 |
| Vite | 8.0.16 |
| Rapier3D (`@dimforge/rapier3d-compat`) | 0.19.3 — imported, **not yet active** |
| Node.js | 22.13.1 (`.nvmrc`) |
| Ruby | 3.3.7 (`.ruby-version`, task runner only) |
| GLSL | 3.0 (`THREE.GLSL3`, `RawShaderMaterial` throughout) |

No UI framework — vanilla JS ES modules.

## Directory Structure

```
index.html                      # Entry HTML; French HUD labels; #fps + #hud overlays
vite.config.js                  # Registers .glsl files as raw string imports
Runfile.rb                      # Task runner (run dev / build / preview)
src/
  config.js                     # Single source of truth for all numeric constants (CFG)
  main.js                       # Renderer init + game loop (requestAnimationFrame)
  input/
    keyboard.js                 # Set-based key tracking; clearJustPressed() called once/frame
    mouse.js                    # Pointer-lock delta → player.yaw / pitch
    gamepad.js                  # navigator.getGamepads()[0]; dead-zone; justPressed
  physics/
    player.js                   # Player: worldRotation quaternion, unified collision, surface transitions
  renderer/
    fontTexture.js              # Canvas-drawn glyphs '0'/'1' → THREE.CanvasTexture
    materials.js                # RawShaderMaterial factory (scene shaders + uniforms)
    taaPass.js                  # MSAA render target → TAA resolve (ping-pong) → blit
    shaders/
      scene.vert.glsl           # MVP + TAA jitter applied in clip space
      scene.frag.glsl           # Binary-digit wall rendering + Tron-grid floor
      taa.vert.glsl             # Full-screen quad (NDC)
      taa.frag.glsl             # Temporal blend with velocity-adaptive alpha
      star.vert.glsl            # Rotation-only view (no parallax) + push to far plane for skybox depth trick
      star.frag.glsl            # Simple glow + core disc; additive blending
  world/
    buildings.js                # generateBuildings() (data) + buildBuildingGeometry() (mesh)
    floor.js                    # Single oversized quad at y = -0.05
    scene.js                    # Assembles Three.js Scene; per-mesh onBeforeRender sets uniforms
    stars.js                    # StarSystem: 3 000 static points on full sphere (camera-relative skybox)
```

## Architecture

### Game Loop (`src/main.js`)

```
requestAnimationFrame
  ├── gamepad.read()
  ├── player.update(keyboard, gp)        // physics + collision
  ├── keyboard.clearJustPressed()
  ├── camera sync: position + player.getCameraQuaternion(camera.quaternion)
  ├── uniform update (uView, uProjection, uTime, uJitter)
  ├── taa.computeJitter(vel, w, h)       // Halton(2,3), frozen when still
  ├── starSystem uniforms update
  └── taa.render(renderer, scene, camera, vel, glitchStrength)
        ├── Pass 1: scene → MSAA target (4× samples)
        ├── Pass 2: TAA resolve → current ping-pong buffer
        └── Pass 3: blit current → screen (chromatic aberration if glitchStrength > 0)
```

### Rendering Pipeline

- `renderer.setPixelRatio(1)` — TAA replaces native SSAA
- MSAA target (`samples: 4`) handled by Three.js internally
- TAA blend factor: `0.15` (still) → up to `0.95` (fast motion)
- All geometry has `frustumCulled = false`
- Single shared `RawShaderMaterial`; `onBeforeRender` mutates `uSeed` and `uModel` per mesh

### World

- 40×40 grid; buildings at `col * 560 - totalW/2`, `row * 560 - totalD/2`
- Building dimensions: 300 × 300 × 5000 units; 4 side faces + roof only (no floor face)
- Floor: one large quad at `y = -0.05`, size = `CFG.far * 2`
- Deterministic seed: `(col * 1273 + row * 4937 + (col ^ row) * 131) % 9973`

### Physics (`src/physics/player.js`)

- No Rapier yet — fully hand-rolled
- **"World rotates" model:** a single `worldRotation` quaternion maps player-local axes
  to world axes. On the floor `worldRotation = identity` (local Y = world Y).
  On a wall, `worldRotation` maps local Y → wall normal.
- **Movement:** always computed in player-local frame (XZ + yaw), then converted to
  world space via `worldRotation`. Collision is per-axis in world space using
  `_isInsideBuilding(x, y, z)` — same check for all surfaces.
- **Camera:** `getCameraQuaternion()` = `worldRotation * yawQ(Y, -yaw) * pitchQ(X, -pitch)`.
  Called from `main.js` — no manual quaternion assembly.
- **Ground detection:** floor mode checks platform heights (0 or buildingH);
  wall mode checks if feet are over a building face. Both return a ground height;
  physics code is identical (`grounded = jumpOffset ≤ groundH`).
- **Surface transition (E key):** detects the closest surface (wall face, roof, or floor)
  within 100 units whose normal differs ≥45° from current `worldUp`. All surfaces use the
  same distance metric (perpendicular distance to the face; for floor, `pos.y`). Transition:
  zero-G freeze → `_activateSurface()` computes new `worldRotation` preserving the player's
  forward direction (projected onto new surface plane). `yaw` and `pitch` are **never
  modified** by transitions.
- Jump strength: `JUMP_STRENGTH 3.1`, gravity `0.08`/frame
- Sprint: 4× speed; sprint-jump preserves `1.5×` air speed
- Head bob: sinusoidal, disabled airborne, 2.5× speed while sprinting
- `glitchStrength` (0–1, decays over `GLITCH_FRAMES = 10` frames) drives chromatic
  aberration in the TAA blit pass.
- `MIN_JUMP_OFFSET = -(CAM_BASE_Y - camRadius - 1)` prevents drifting through walls
  when no ground is detected (wall edge case).

### Input

- **Keyboard:** `keydown/keyup` → `Set`; WASD/arrows, Space (jump), Shift (sprint), **E (surface activation)**
- **Mouse:** pointer-lock only; sensitivity `0.003 rad/px`; pitch clamped `±π/2`
- **Gamepad:** axes 0–3, button 0 (jump), button 4 (sprint); dead-zone `0.15`

### Shaders

- GLSL 3.0 — `in/out` syntax, no `attribute/varying`
- `scene.vert`: jitter as `cp.xy += uJitter * cp.w` (correct perspective-space offset)
- `scene.frag`: branches on `vNormal.y` (floor / wall / roof); animated binary glyph grid with
  LOD blending; Tron-grid floor with minor/major gridlines
- `taa.frag`: `uVelocity`-driven blend; `uHistValid` guards first frame;
  `uGlitch` (0–1) adds chromatic aberration during the blit pass (Pass 3 only)

## Dev Commands

```bash
run dev        # npx vite dev — hot reload on localhost
run build      # npx vite build — output to dist/
run preview    # npx vite preview — serve dist/
```

GLSL files are imported as raw strings via `?raw` (configured in `vite.config.js`).

## Key Invariants

1. **`CFG` is the single source of truth.** Never hard-code world dimensions (building size,
   spacing, grid counts, far plane) outside `src/config.js`.
2. **Shared material, per-draw uniforms.** `uSeed` and `uModel` are mutated in `onBeforeRender`.
   Do not deduplicate materials per building — the scene depends on this pattern.
3. **GLSL 3.0 only.** Use `in/out` syntax. Do not mix GLSL 1.0 conventions.
4. **No frustum culling.** All meshes set `frustumCulled = false`. Do not enable it without
   profiling — the grid is large and the camera is inside it.
5. **`keyboard.clearJustPressed()` must be called exactly once per frame**, after
   `player.update` and before the next frame. Moving this call breaks jump detection.
6. **Rapier3D is declared but not initialised.** Do not activate it without replacing or
   disabling the hand-rolled system in `player.js`.
7. **Pixel ratio is fixed at 1.** The TAA jitter offset is designed around this. Changing
   `setPixelRatio` will misalign it.
8. **Camera orientation is quaternion-based.** `player.getCameraQuaternion()` computes
   `worldRotation * yawQ * pitchQ` in local frame. Do not reintroduce manual quaternion
   assembly in `main.js`.
