#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
uniform mat4 u_viewProj;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = normal;
  vUv = uv;
  gl_Position = u_viewProj * vec4(position, 1.0);
}
