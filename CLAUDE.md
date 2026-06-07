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
    mouse.js                    # Pointer-lock delta → character.yaw / pitch
    gamepad.js                  # navigator.getGamepads()[0]; dead-zone; justPressed
  physics/
    character.js                # Hand-rolled AABB: movement, jump, wall-jump, sprint, head bob
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
  ├── character.update(keyboard, gp)       // physics + AABB collision
  ├── keyboard.clearJustPressed()
  ├── camera sync (position/rotation from character state)
  ├── uniform update (uView, uProjection, uTime, uJitter)
  ├── taa.computeJitter(vel, w, h)         // Halton(2,3), frozen when still
  ├── starSystem uniforms update (uView/uProjection/uJitter — rotation-only view in shader)
  └── taa.render(renderer, scene, camera, vel)
        ├── Pass 1: scene → MSAA target (4× samples)
        ├── Pass 2: TAA resolve → current ping-pong buffer
        └── Pass 3: blit current → screen
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

### Physics (`src/physics/character.js`)

- No Rapier yet — fully hand-rolled
- AABB collision checks against nearest 3×3 grid cells
- Jump strength: `JUMP_STRENGTH 3.1`, gravity `0.08`/frame
- Wall-jump: 4-probe normal detection; horizontal impulse `WALL_JUMP_H 11.25`, decay `0.97`
- Sprint: 4× speed; sprint-jump preserves `1.5×` air speed
- Head bob: sinusoidal, disabled airborne, doubled speed while sprinting

### Input

- **Keyboard:** `keydown/keyup` → `Set`; WASD/arrows, Space (jump), Shift (sprint)
- **Mouse:** pointer-lock only; sensitivity `0.003 rad/px`; pitch clamped `±π/2`
- **Gamepad:** axes 0–3, button 0 (jump), button 4 (sprint); dead-zone `0.15`

### Shaders

- GLSL 3.0 — `in/out` syntax, no `attribute/varying`
- `scene.vert`: jitter as `cp.xy += uJitter * cp.w` (correct perspective-space offset)
- `scene.frag`: branches on `vNormal.y` (floor / wall / roof); animated binary glyph grid with
  LOD blending; Tron-grid floor with minor/major gridlines
- `taa.frag`: `uVelocity`-driven blend; `uHistValid` guards first frame

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
   `character.update` and before the next frame. Moving this call breaks jump detection.
6. **Rapier3D is declared but not initialised.** Do not activate it without replacing or
   disabling the hand-rolled AABB system in `character.js`.
7. **Pixel ratio is fixed at 1.** The TAA jitter offset is designed around this. Changing
   `setPixelRatio` will misalign it.
8. **Camera `rotation.order = 'YXZ'`** (yaw then pitch). Do not change — FPS look depends on it.
