#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 u_viewProj;
out vec3 vPos;
void main() {
  vPos = position;
  gl_Position = u_viewProj * vec4(position, 1.0);
}
