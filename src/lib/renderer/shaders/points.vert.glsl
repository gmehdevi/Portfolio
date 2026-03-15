#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 u_viewProj;
uniform float u_pointSize;
void main() {
  gl_Position = u_viewProj * vec4(position, 1.0);
  gl_PointSize = u_pointSize;
}
