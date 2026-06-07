in vec3 position;
in vec3 normal;
in vec2 uv;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uJitter;

out vec3 vNormal;
out vec2 vUV;
out vec3 vWorldPos;

void main() {
  vec4 wp     = uModel * vec4(position, 1.0);
  vWorldPos   = wp.xyz;
  vNormal     = normalize(mat3(uModel) * normal);
  vUV         = uv;
  vec4 cp     = uProjection * uView * wp;
  cp.xy      += uJitter * cp.w;
  gl_Position = cp;
}
