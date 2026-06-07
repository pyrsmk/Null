in vec3  position;
in float aBrightness;

uniform mat4  uView;
uniform mat4  uProjection;
uniform vec2  uJitter;
uniform float uTime;

out float vBrightness;

void main() {
  // Per-star seeds from normalized direction (world coords ~20000 lose fract precision)
  vec3  dir   = normalize(position);
  float seed  = fract(sin(dot(dir.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float seed2 = fract(sin(dot(dir.yz, vec2(39.3468, 11.135))) * 43758.5453);

  // Per-star flicker amplitude: how much this star scintillates (0.05..0.85)
  float amp  = 0.05 + seed2 * 0.80;

  // Per-star update rate: 8..22 Hz — discrete random threshold each tick
  float rate = 8.0 + seed * 14.0;
  float t    = floor(uTime * rate);

  // Hash → uniform [0,1]; then (1 - r²) skews the distribution toward 1:
  // star is usually at or near full brightness, rarely very dim
  float r     = fract(sin(seed * 127.1 + t * 311.7) * 43758.5453);
  float noise = 1.0 - r * r;

  // flicker in [1-amp, 1]: star dimness is bounded by its own amplitude
  vBrightness = aBrightness * (1.0 - amp * (1.0 - noise));

  // Rotation only — strip translation so stars have no parallax (true skybox behaviour)
  vec4 vp = mat4(mat3(uView)) * vec4(position, 1.0);
  vec4 cp = uProjection * vp;

  // Push to far plane - ε: passes depth test against clear depth (1.0) but fails against
  // any rendered geometry (buildings, floor), giving free occlusion without extra work.
  cp.z   = cp.w * (1.0 - 1e-7);
  cp.xy += uJitter * cp.w;

  gl_PointSize = 1.0 + aBrightness * 2.0;
  gl_Position  = cp;
}
