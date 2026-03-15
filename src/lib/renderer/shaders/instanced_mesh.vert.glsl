#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec3 instanceOffset;
uniform mat4 u_viewProj;
uniform float u_radius;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = normal;
  vUv = uv;
  vec3 worldPos = position * u_radius + instanceOffset;
  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
