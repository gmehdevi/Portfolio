#version 300 es
precision highp float;
out vec4 outColor;
uniform vec3 u_color;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) {
    discard;
  }
  outColor = vec4(u_color, 1.0);
}
