precision mediump float;

uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform vec2      uTexelSize;
uniform float     uBlend;
uniform float     uHistValid;
uniform float     uVelocity;
uniform float     uGlitch;

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec3 curr = texture(uCurrent, vUV).rgb;
  if (uHistValid < 0.5) {
    if (uGlitch > 0.0) {
      float str = uGlitch * 0.02;
      fragColor = vec4(
        texture(uCurrent, vUV + vec2(str, 0.0)).r,
        curr.g,
        texture(uCurrent, vUV - vec2(str, 0.0)).b,
        1.0
      );
    } else {
      fragColor = vec4(curr, 1.0);
    }
    return;
  }

  vec3 hist = texture(uHistory, vUV).rgb;

  if (uVelocity > 0.001) {
    vec2 ts = uTexelSize;
    vec3 s0 = texture(uCurrent, vUV + ts * vec2(-1.,-1.)).rgb;
    vec3 s1 = texture(uCurrent, vUV + ts * vec2( 0.,-1.)).rgb;
    vec3 s2 = texture(uCurrent, vUV + ts * vec2( 1.,-1.)).rgb;
    vec3 s3 = texture(uCurrent, vUV + ts * vec2(-1., 0.)).rgb;
    vec3 s4 = texture(uCurrent, vUV + ts * vec2( 1., 0.)).rgb;
    vec3 s5 = texture(uCurrent, vUV + ts * vec2(-1., 1.)).rgb;
    vec3 s6 = texture(uCurrent, vUV + ts * vec2( 0., 1.)).rgb;
    vec3 s7 = texture(uCurrent, vUV + ts * vec2( 1., 1.)).rgb;
    vec3 minC = min(min(min(s0,s1),min(s2,s3)),min(min(s4,s5),min(s6,s7)));
    vec3 maxC = max(max(max(s0,s1),max(s2,s3)),max(max(s4,s5),max(s6,s7)));
    minC = min(minC, curr);
    maxC = max(maxC, curr);
    hist = clamp(hist, minC, maxC);
  }

  fragColor = vec4(mix(hist, curr, uBlend), 1.0);
}
