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

3. **Surfaces block in both directions.** A surface has no "accessible side". The face normal is
   used only to orient the player during a transition (E key).

4. **Collision is sphere-vs-bounded-rectangle, expressed as a `Contact`.** The contact normal is
   a property of the *contact*, not of the surface: facing the interior of a face it equals the
   face normal; near an edge or corner it tilts toward the player (direction from the closest
   point on the bounded face to the player). `Contact.dist` is the generalized signed distance:
   plane signed distance when the player projects inside the face bounds (negative =
   penetration), distance to the closest point on the face otherwise (always ≥ 0 — an edge
   cannot be penetrated from behind). Bounds are **never** expanded by the margin: a face claims
   no space beyond its physical edges. This is what makes roof edges and building corners walkable.

5. **`Contact.alterVelocity(vel, restDist = dist)` is the primary mechanism for constraining
   movement.** It clamps the inbound velocity component along the contact normal so the caller
   arrives at `restDist` from the surface and no closer (default: stop at the current distance =
   kill all inbound velocity). It **never adds outbound velocity** — there is no depenetration
   impulse; converting penetration depth into kinetic energy is forbidden (trampoline effect).
   Penetration recovery is always positional. Collisions modify `vel`, never `pos` directly.
   Three controlled exceptions snap `pos` along the **contact normal**:
   - **Lateral-at-feet snap**: lateral contacts at the feet push `pos` out to `camRadius`
     (position only, no velocity change — avoids bounce).
   - **Ground-height snap** (post-`alterVelocity`): `pos` is adjusted so feet sit at exactly
     `camRadius` from the ground contact (re-measured via `surface.measure()` after lateral
     snaps). On an edge contact the normal is tilted → the camera lowers when overhanging.
     Without this snap, `_grounded` turns false the next frame (swept `feetMargin` shrinks back
     to `camRadius` → not approaching → can't jump).
   - **Body invariant guard**: body contacts closer than `camRadius` push `pos` out to
     `camRadius` (position only). Must never fire in normal motion — it covers paths that move
     `pos` without collision checks (transition lerp, projection flight) and multi-contact
     corner residue. If it fires regularly, the bug is upstream.

6. **The player's volume is a property of the player, not of surfaces.** `camRadius` is passed
   as `margin` to `isCollidingWith`. Surfaces do not hardcode it.

7. **Adding an obstacle = instantiate a `WallFace`, register it in `World`. Nothing else.**
   Zero changes to `player.js` or any physics logic.

### Collision queries

8. **`World.isCollidingWith(pos, vec, margin)` is the single entry point for collision.**
   It returns the `Contact`s of all surfaces the sphere `(pos, margin)` moving along `vec`
   collides with. The player calls it — `World` has no knowledge of feet, body, or camera height.
   **Contacts are transient**: each `WallFace` owns one reusable `Contact`, valid only until that
   face's next query. Consume immediately or copy.

9. **The player makes two collision queries per frame:**
   - **Feet** `(feetPos = pos - worldUp × CAM_BASE_Y)` — detects ground support.
     Margin is swept: `CFG.camRadius + max(0, -vel·worldUp)` so fast falls never tunnel.
   - **Body** `(pos)` — detects lateral obstacles. Margin is swept: `CFG.camRadius + |vel|`
     so a fast approach is detected before crossing; `alterVelocity(vel, camRadius)` then clamps
     the approach to land flush at `camRadius` — penetration never happens in normal motion.
   This separation is the player's responsibility. `World` and surfaces are unaware of it.
   Feet contacts are classified by the **contact** normal: ground if `normal·worldUp > 0.5`,
   lateral otherwise. An edge contact migrates from ground to lateral as it tilts.

10. **`_grounded` is re-derived from collision results every frame and stored for the next frame.**
    `_grounded = groundContacts.length > 0`.
    It is never assumed — only carried forward one frame for input/control decisions.

11. **The player's volume applies below the feet too.** Feet stop at `camRadius` from any surface,
    consistent with lateral collision. The camera sits at `CAM_BASE_Y + camRadius` above the floor
    when standing. On a roof edge the feet sphere can rest in partial overhang (held by the edge
    contact, camera slightly lowered).

### Physics model

12. **Single unified velocity `_vel: THREE.Vector3`.** No separate horizontal/vertical components.
    Decomposed each frame into normal (worldUp axis) and plane (surface-tangent) components for
    gravity and input control, then recombined before collision queries.

13. **`worldRotation` is the surface frame.** A single quaternion maps player-local axes to world
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

- **`Contact`** — result of a sphere-vs-surface query: `{surface, normal, point, dist}`.
  `normal` = face normal inside the bounds, tilted toward the player near an edge/corner.
  `point` = closest point on the bounded face. `dist` = generalized signed distance (plane sd
  inside bounds, may be < 0 = penetration; distance to closest point outside, always ≥ 0).
  Method `alterVelocity(vel, restDist = dist)` — clamps the inbound component so the caller
  arrives flush at `restDist` (default: kills all inbound velocity); never adds outbound velocity.
- **`WorldObject`** — abstract base for all world entities.
- **`Surface extends WorldObject`** — abstract physical boundary.
  Method `contactWith(pos, vec, margin)` → transient `Contact` or `null`.
- **`WallFace extends Surface`** — rectangular face: `(nx,ny,nz, offset, u0,u1, v0,v1)`.
  `offset = dot(anyPointOnFace, normal)`. Tangent axes pre-computed from normal for 2D bounds.
  Owns **one reusable `Contact`** — query results are transient (valid until the face's next query).
- **`WallFace.measure(pos, out)`** — fills `out` with closest-feature data (dist, normal, point),
  no approach/margin check. Used by `contactWith` and by the player's ground-height snap.
- **`WallFace.contactWith(pos, vec, margin)`** — quick plane rejection (`|sd| > margin`), then
  `measure`; collides if `dist ≤ margin` and (penetrating, or `vec` approaches the contact normal).
  Bounds are strict — no margin expansion along the tangents.
- **Floor surface** — `WallFace(0,1,0, 0, -far,far, -far,far)`, registered via `addGlobal`.
  Finite bounds: the player falls into the void beyond the floor edge.
- **`WallFace.signedDist(pos)`** — public wrapper around `_signedDist`; positive = on normal side.
- **`World`** — spatial grid `"col,row"` → 3×3 neighbourhood queries + global list.
- **`findTransitionCandidate(pos, worldUp, maxDist)`** — nearest surface with normal diverging
  ≥45° from `worldUp`, on whose normal side the player stands.
- `main.js` builds the world: 4 lateral `WallFace`s + 1 roof per building in their grid cell.

### Physics (`src/physics/player.js`)

- No Rapier yet — fully hand-rolled
- **"World rotates" model:** `worldRotation` quaternion maps local Y → current surface normal.
- **Each frame:** decompose `_vel` → apply gravity to normal component → apply input to plane
  component → recombine → feet query → ground contacts `alterVelocity` → **lateral-at-feet
  snap** → **ground-height snap** → body query (swept margin `camRadius + |vel|`) →
  `alterVelocity(vel, camRadius)` clamp + positional invariant guard on body contacts →
  `pos += _vel`.
- **Feet contact classification:** ground if `contact.normal·worldUp > 0.5`, lateral otherwise.
  Edge contacts have tilted normals, so a roof-edge contact stays "ground" up to ~60° of tilt.
- **Lateral-at-feet snap:** lateral contacts with `dist < camRadius` push `pos` out along the
  contact normal (position only, no velocity change — avoids bounce).
- **Ground-height snap:** after `alterVelocity` on ground contacts (before `pos += _vel`),
  `pos` is snapped so feet are at exactly `camRadius` from the ground contact, along the
  **contact normal** — re-measured via `surface.measure()` because the lateral snaps may have
  moved `feetPos`. Fixes the case where the player lands from a fast fall: swept `feetMargin`
  detects the ground while `pos` is still above standing height; the snap normalises `pos` so
  the next frame's unswept detection (`feetMargin = camRadius`) still finds the surface.
  On an edge contact the tilted normal makes the camera lower smoothly in partial overhang.
- **Jump:** impulse `JUMP_HEIGHT` (base) or `JUMP_HEIGHT_SPRINT` (sprint) added to normal component when grounded.
  `_jumpedWithSprint` is set at jump time and tracked until landing.
- **Sprint:** 4× ground speed. Airborne: `_jumpedWithSprint` preserves 4× max speed cap and
  `1.1×` steer multiplier; a non-sprint jump caps at base speed with no boost.
- **Walk-off inertia:** leaving the ground without a jump (walked off an edge) transfers the
  current plane speed into `_airMaxSpeed`, so ground momentum (incl. sprint) carries into the
  fall arc. Without this the air cap crushes plane speed back to base and the arc dies at
  the edge.
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
