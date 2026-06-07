precision highp float;

uniform sampler2D uFont;
uniform float     uCharCols;
uniform float     uCharRows;
uniform float     uSeed;
uniform float     uFloorCharW;
uniform float     uTime;
uniform float     uBldSpacing;
uniform vec2      uGridHalfSize;

in vec3 vNormal;
in vec2 vUV;
in vec3 vWorldPos;

out vec4 fragColor;

float hash(float n) {
  return fract(sin(mod(n, 1013.0) * 127.1 + 311.7) * 43758.5453);
}

float glyphBrightness(float t) {
  return clamp(pow(t, 2.2) + pow(t, 0.45) * 0.55, 0.0, 1.0);
}

float sampleLevel(vec2 gridPos, float seed) {
  vec2  cell  = floor(gridPos);
  vec2  subUV = fract(gridPos);
  float cellN = seed + cell.x * 131.711 + cell.y * 97.413;

  float period   = 3.0 + hash(cellN + 5.1) * 17.0;
  float tNorm    = uTime / period + hash(cellN + 6.2);
  float slot     = mod(floor(tNorm), 128.0);
  float slotPrev = mod(slot - 1.0 + 128.0, 128.0);
  float slotFrac = fract(tNorm);

  vec2  hj  = fwidth(gridPos) * 0.7;
  float cN0 = seed + dot(floor(gridPos + hj*vec2(-1,-1)), vec2(131.711,97.413));
  float cN1 = seed + dot(floor(gridPos + hj*vec2( 1,-1)), vec2(131.711,97.413));
  float cN2 = seed + dot(floor(gridPos + hj*vec2(-1, 1)), vec2(131.711,97.413));
  float cN3 = seed + dot(floor(gridPos + hj*vec2( 1, 1)), vec2(131.711,97.413));

  float bitC = (step(0.5,hash(cN0+slot*0.7+1.3))     + step(0.5,hash(cN1+slot*0.7+1.3)) +
                step(0.5,hash(cN2+slot*0.7+1.3))     + step(0.5,hash(cN3+slot*0.7+1.3))) * 0.25;
  float bitP = (step(0.5,hash(cN0+slotPrev*0.7+1.3)) + step(0.5,hash(cN1+slotPrev*0.7+1.3)) +
                step(0.5,hash(cN2+slotPrev*0.7+1.3)) + step(0.5,hash(cN3+slotPrev*0.7+1.3))) * 0.25;

  float changed = step(0.05, abs(bitC - bitP));
  float fadeW   = clamp(0.4 / period, 0.01, 0.15);
  float halfFW  = fadeW * 0.5;
  float fadeOut = (1.0 - smoothstep(0.0, halfFW, slotFrac)) * changed;
  float fadeIn  = smoothstep(halfFW, fadeW, slotFrac);

  float g0 = texture(uFont, vec2(        subUV.x  * 0.5, 1.0 - subUV.y)).r;
  float g1 = texture(uFont, vec2(0.5 + subUV.x * 0.5, 1.0 - subUV.y)).r;
  float tC = mix(g0, g1, bitC);
  float tP = mix(g0, g1, bitP);
  return mix(tC, tP * fadeOut + tC * fadeIn, changed);
}

float renderChars(vec2 gridPos, float seed) {
  vec2  fw   = fwidth(gridPos);

  float lodX = max(0.0, log2(max(fw.x, 0.001)) + 2.5);
  float lodY = max(0.0, log2(max(fw.y, 0.001)) + 2.5);

  const float AVG_T        = 0.15;
  const float LOD_FADE_IN  = 2.0;
  const float LOD_FADE_OUT = 4.0;
  float termBlend = smoothstep(LOD_FADE_IN, LOD_FADE_OUT, max(lodX, lodY));
  lodX = min(lodX, LOD_FADE_OUT);
  lodY = min(lodY, LOD_FADE_OUT);

  float lod0X = floor(lodX), blendX = fract(lodX);
  float lod0Y = floor(lodY), blendY = fract(lodY);
  float sX0 = pow(2.0, lod0X), sX1 = sX0 * 2.0;
  float sY0 = pow(2.0, lod0Y), sY1 = sY0 * 2.0;

  float s00 = seed + lod0X       * 7919.0 + lod0Y       * 7907.0;
  float s10 = seed + (lod0X+1.0) * 7919.0 + lod0Y       * 7907.0;
  float s01 = seed + lod0X       * 7919.0 + (lod0Y+1.0) * 7907.0;
  float s11 = seed + (lod0X+1.0) * 7919.0 + (lod0Y+1.0) * 7907.0;

  float t00 = sampleLevel(vec2(gridPos.x/sX0, gridPos.y/sY0), s00);
  float t10 = sampleLevel(vec2(gridPos.x/sX1, gridPos.y/sY0), s10);
  float t01 = sampleLevel(vec2(gridPos.x/sX0, gridPos.y/sY1), s01);
  float t11 = sampleLevel(vec2(gridPos.x/sX1, gridPos.y/sY1), s11);

  float tLOD = mix(mix(t00, t10, blendX), mix(t01, t11, blendX), blendY);
  return glyphBrightness(mix(tLOD, AVG_T, termBlend));
}

float tronFloor(vec2 worldXZ) {
  const float MINOR = 70.0;
  vec2 gpMin = worldXZ / MINOR;
  vec2 fwMin = fwidth(gpMin);
  vec2 dMin  = min(fract(gpMin), 1.0 - fract(gpMin));
  float lineMin = max(
    1.0 - smoothstep(0.0, fwMin.x * 1.5, dMin.x),
    1.0 - smoothstep(0.0, fwMin.y * 1.5, dMin.y));
  float glowMin = max(
    1.0 - smoothstep(fwMin.x * 1.5, fwMin.x * 8.0, dMin.x),
    1.0 - smoothstep(fwMin.y * 1.5, fwMin.y * 8.0, dMin.y)) * 0.1;

  float MAJOR = uBldSpacing;
  vec2 gpMaj = worldXZ / MAJOR;
  vec2 fwMaj = fwidth(gpMaj);
  vec2 dMaj  = min(fract(gpMaj), 1.0 - fract(gpMaj));
  float lineMaj = max(
    1.0 - smoothstep(0.0, fwMaj.x * 1.5, dMaj.x),
    1.0 - smoothstep(0.0, fwMaj.y * 1.5, dMaj.y));
  float glowMaj = max(
    1.0 - smoothstep(fwMaj.x * 1.5, fwMaj.x * 14.0, dMaj.x),
    1.0 - smoothstep(fwMaj.y * 1.5, fwMaj.y * 14.0, dMaj.y)) * 0.4;

  float bldHW   = uFloorCharW * uCharCols * 0.5;
  vec2  aligned = worldXZ + uGridHalfSize;
  vec2  cell    = fract(aligned / uBldSpacing + 0.5) - 0.5;
  vec2  q       = abs(cell) - vec2(bldHW / uBldSpacing);
  float dist    = length(max(q, vec2(0.0))) * uBldSpacing;
  float inBounds = step(abs(worldXZ.x), uGridHalfSize.x + uBldSpacing * 0.5)
                 * step(abs(worldXZ.y), uGridHalfSize.y + uBldSpacing * 0.5);
  float bldGlow = (1.0 - smoothstep(0.0, 22.0, dist)) * 0.9 * inBounds;

  return clamp(lineMin * 0.25 + glowMin + lineMaj * 0.85 + glowMaj + bldGlow, 0.0, 1.0);
}

void main() {
  float brightness;

  if (vNormal.y > 0.5) {
    if (vWorldPos.y < 1.0) {
      brightness = tronFloor(vWorldPos.xz);
    } else {
      vec2 gridPos = vec2(vUV.x * uCharCols, vUV.y * uCharCols);
      brightness   = renderChars(gridPos, uSeed * 1.7321 + 4.0 * 997.113);
      vec2  rDist = min(vUV, 1.0 - vUV);
      vec2  rFW   = fwidth(rDist);
      float rEdge = max(
        1.0 - smoothstep(0.0, max(0.08, rFW.x * 2.0), rDist.x),
        1.0 - smoothstep(0.0, max(0.08, rFW.y * 2.0), rDist.y)
      );
      brightness = clamp(brightness + rEdge * 0.9, 0.0, 1.0);
    }
  } else {
    float fi;
    if      (vNormal.z < -0.5) fi = 0.0;
    else if (vNormal.x >  0.5) fi = 1.0;
    else if (vNormal.z >  0.5) fi = 2.0;
    else                        fi = 3.0;
    vec2 gridPos = vec2(vUV.x * uCharCols, vUV.y * uCharRows);
    brightness   = renderChars(gridPos, uSeed * 1.7321 + fi * 997.113);

    vec2  edgeDist = min(vUV, 1.0 - vUV);
    vec2  edgeFW   = fwidth(edgeDist);
    float edgeV = 1.0 - smoothstep(0.0, max(0.08,  edgeFW.x * 2.0), edgeDist.x);
    float edgeH = 1.0 - smoothstep(0.0, max(0.003, edgeFW.y * 2.0), edgeDist.y);
    float edge = max(edgeV, edgeH);
    brightness = clamp(brightness + edge * 0.9, 0.0, 1.0);
  }

  vec3 bgColor  = vec3(0.02, 0.0,  0.04);
  vec3 litColor = vec3(0.50, 0.08, 1.00);
  fragColor = vec4(mix(bgColor, litColor, brightness), 1.0);
}
