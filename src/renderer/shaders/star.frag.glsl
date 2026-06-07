precision highp float;

in float vBrightness;
out vec4 fragColor;

void main() {
  vec2  pc   = gl_PointCoord - 0.5;
  float r    = length(pc) * 2.0;
  if (r > 1.0) discard;

  // Scaled down so center pixel isn't always pure white — brightness variation becomes visible
  float glow = exp(-r * r * 3.0)  * vBrightness * 0.5;
  float core = exp(-r * r * 18.0) * vBrightness * 1.0;

  fragColor = vec4(vec3(0.85, 0.90, 1.0), glow + core);
}
