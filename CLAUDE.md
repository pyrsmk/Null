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
  main.js                       # Renderer init + game loop; builds World from buildingsData
  input/
    keyboard.js                 # Set-based key tracking; clearJustPressed() called once/frame
    mouse.js                    # Pointer-lock delta → player.yaw / pitch
    gamepad.js                  # navigator.getGamepads()[0]; dead-zone; justPressed
  physics/
    world.js                    # WorldObject → Surface → WallFace; World spatial grid
    player.js                   # Player physics — queries World, no geometry knowledge
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

## Functional Rules

These rules govern how the engine is designed. They take priority over implementation convenience.

### World objects

1. **`WorldObject` is the base of everything in the world.** `Surface` extends it for physical
   boundaries. Future types (`Gas`, etc.) extend `WorldObject` directly — they are not surfaces.

2. **A `Surface` is a 2D physical boundary, not a solid volume.** A wall, a floor, a roof are all
   `Surface` instances. The physics engine does not distinguish between them.

3. **Surfaces block in both directions.** A surface has no "accessible side". The normal is used
   only to decompose velocity and to orient the player during a transition (E key).

4. **`alterVelocity` is the primary mechanism for constraining movement.** Lateral and wall
   collisions only modify `vel`, never `pos` directly. Two controlled exceptions exist where
   `pos` is snapped directly:
   - **Position-correction pass** (pre-collision): iterative snap via `nearbySurfaces` to
     prevent the player from sinking through horizontal surfaces at building-floor borders.
   - **Ground-height snap** (post-`alterVelocity`): after a ground hit detected via swept
     margin, `pos` is adjusted so feet are at exactly `camRadius` from the surface. Without
     this, `_grounded` turns false the next frame (swept `feetMargin` shrinks back to
     `camRadius`, and `sd_feet > camRadius` → not approaching → can't jump).
   Deep lateral penetration is recovered through the depenetration impulse in `alterVelocity`
   (`vel -= sd * normal` when `sd < 0`).

5. **The player's volume is a property of the player, not of surfaces.** `camRadius` is passed
   as `margin` to `isCollidingWith` and `alterVelocity`. Surfaces do not hardcode it.

6. **Adding an obstacle = instantiate a `WallFace`, register it in `World`. Nothing else.**
   Zero changes to `player.js` or any physics logic.

### Collision queries

7. **`World.isCollidingWith(pos, vec, margin)` is the single entry point for collision.**
   It returns only the surfaces that `pos` is approaching (within `margin`, in direction `vec`).
   The player calls it — `World` has no knowledge of feet, body, or camera height.

8. **The player makes two collision queries per frame:**
   - **Feet** `(feetPos = pos - worldUp × CAM_BASE_Y)` — detects ground support.
     Margin is swept: `CFG.camRadius + max(0, -vel·worldUp)` so fast falls never tunnel.
   - **Body** `(pos)` — detects lateral obstacles. Margin = `CFG.camRadius`.
   This separation is the player's responsibility. `World` and surfaces are unaware of it.

9. **`_grounded` is re-derived from collision results every frame and stored for the next frame.**
   `_grounded = isCollidingWith(feetPos, vel, feetMargin).length > 0`.
   It is never assumed — only carried forward one frame for input/control decisions.

10. **The player's volume applies below the feet too.** Feet stop at `camRadius` from any surface,
    consistent with lateral collision. The camera sits at `CAM_BASE_Y + camRadius` above the floor
    when standing.

### Physics model

11. **Single unified velocity `_vel: THREE.Vector3`.** No separate horizontal/vertical components.
    Decomposed each frame into normal (worldUp axis) and plane (surface-tangent) components for
    gravity and input control, then recombined before collision queries.

12. **`worldRotation` is the surface frame.** A single quaternion maps player-local axes to world
    axes. On floor: identity. On a wall: local Y → wall normal. `yaw` and `pitch` are never
    modified by surface transitions.

---

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

### Collision (`src/physics/world.js`)

- **`WorldObject`** — abstract base for all world entities.
- **`Surface extends WorldObject`** — abstract physical boundary. Method `alterVelocity(pos, vel, margin)`.
- **`WallFace extends Surface`** — rectangular face: `(nx,ny,nz, offset, u0,u1, v0,v1)`.
  `offset = dot(anyPointOnFace, normal)`. Tangent axes pre-computed from normal for 2D bounds.
- **`_isApproaching(pos, vec, margin)`** — internal check used by `World.isCollidingWith`.
  Skips if `signedDist < -margin` (deep penetration already handled by depenetration impulse).
- **Floor surface** — `WallFace(0,1,0, 0, -far,far, -far,far)`, registered via `addGlobal`.
  Finite bounds: the player falls into the void beyond the floor edge.
- **`WallFace.signedDist(pos)`** — public wrapper around `_signedDist`; positive = on normal side.
- **`World`** — spatial grid `"col,row"` → 3×3 neighbourhood queries + global list.
- **`World.nearbySurfaces(pos, normalMargin)`** — returns WallFaces within lateral `camRadius`
  and `sd ∈ (-camRadius, normalMargin)` of `pos`; used by position-correction pass (no velocity check).
- **`findTransitionCandidate(pos, worldUp, maxDist)`** — nearest surface with normal diverging
  ≥45° from `worldUp`, on whose normal side the player stands.
- `main.js` builds the world: 4 lateral `WallFace`s + 1 roof per building in their grid cell.

### Physics (`src/physics/player.js`)

- No Rapier yet — fully hand-rolled
- **"World rotates" model:** `worldRotation` quaternion maps local Y → current surface normal.
- **Each frame:** decompose `_vel` → apply gravity to normal component → apply input to plane
  component → recombine → **position-correction pass** → two `isCollidingWith` queries →
  `alterVelocity` on hits → **ground-height snap** → `pos += _vel`.
- **Position-correction pass:** iterative loop (max 5) via `nearbySurfaces(pos, CAM_BASE_Y + camRadius)`.
  For each horizontal surface where `sd ∈ (0, HMARGIN)` (camera above, feet too close):
  snap `pos += (HMARGIN - sd) * normal` so feet land at `camRadius` from surface.
  If 5 iterations don't converge → revert `pos` to pre-pass value (`_posPrev`).
  Lateral surfaces are untouched here; `alterVelocity` handles them.
- **Ground-height snap:** after `alterVelocity` on ground hits (before `pos += _vel`),
  `pos` is snapped so feet are at exactly `camRadius` from `groundHits[0]`.
  Fixes the case where the player lands from a fast fall: swept `feetMargin` detects
  the ground while `pos` is still above standing height; the snap normalises `pos` so
  the next frame's unswept detection (`feetMargin = camRadius`) still finds the surface.
- **Jump:** impulse `JUMP_HEIGHT` (base) or `JUMP_HEIGHT_SPRINT` (sprint) added to normal component when grounded.
  `_jumpedWithSprint` is set at jump time and tracked until landing.
- **Sprint:** 4× ground speed. Airborne: `_jumpedWithSprint` preserves 4× max speed cap and
  `1.1×` steer multiplier; a non-sprint jump caps at base speed with no boost.
- **Head bob:** sinusoidal on `_bobStrength`, disabled airborne, 2.5× speed sprinting.
- **Surface transition (E key):** zero-G freeze → `_activateSurface()` rotates `worldRotation`,
  zeroes `_vel`.
- `glitchStrength` (0–1, `GLITCH_FRAMES = 10`) drives chromatic aberration in TAA blit pass.

### Input

- **Keyboard:** `keydown/keyup` → `Set`; WASD/arrows, Space (jump), Shift (sprint), **E (transition)**
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
   `worldRotation * yawQ * pitchQ`. Yaw always rotates around the **world Y axis** `(0,1,0)`,
   not the surface normal — this is intentional for consistent look control on walls.
   Do not reintroduce manual quaternion assembly in `main.js`.
